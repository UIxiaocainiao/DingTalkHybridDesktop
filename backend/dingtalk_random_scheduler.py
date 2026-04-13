#!/usr/bin/env python3
"""Persistent Android device manager driven by adb.

Features:
1. Schedules DingTalk launches in randomized morning and evening windows
2. Persists the next planned run times so restarts do not reshuffle the day
3. Exposes `run`, `debug`, `status`, `schedule`, and `doctor` commands
4. Keeps scrcpy behind explicit config instead of a production dependency
5. Cleans up MIUI recent-task cards after the app is force-stopped
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import random
import re
import shlex
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime, time as dt_time, timedelta
from pathlib import Path
from typing import Iterable


DEFAULT_PACKAGE = "com.alibaba.android.rimet"
DEFAULT_APP_LABEL = "钉钉"
DEFAULT_DELAY_AFTER_LAUNCH = 5
DEFAULT_POLL_INTERVAL = 5
DEFAULT_SCRCPY_LAUNCH_COOLDOWN = 15
BASE_DIR = Path(__file__).resolve().parent
DEFAULT_PLATFORM_TOOLS_DIR = BASE_DIR / "vendor/platform-tools"
PLATFORM_TOOLS_DIR = Path(
    os.environ.get("DINGTALK_PLATFORM_TOOLS_DIR", str(DEFAULT_PLATFORM_TOOLS_DIR))
).expanduser()
DEFAULT_STATE_FILE = str(BASE_DIR / "logs/dingtalk-random-scheduler.state.json")
DEFAULT_CONFIG_FILE = str(BASE_DIR / "runtime/console-config.json")
DEFAULT_WORKDAY_API_URL = "https://holiday.dreace.top?date={date}"
DEFAULT_WORKDAY_API_TIMEOUT = 5.0
OSASCRIPT_BIN = "/usr/bin/osascript"
ADB_BIN = "adb"
SCRCPY_BIN = "scrcpy"


def host_platform_key() -> str:
    system = sys.platform
    if system == "darwin":
        os_name = "darwin"
    elif system.startswith("linux"):
        os_name = "linux"
    elif system.startswith(("win32", "cygwin", "msys")):
        os_name = "windows"
    else:
        os_name = system

    machine = platform.machine().lower()
    if machine in {"arm64", "aarch64"}:
        arch = "arm64"
    elif machine in {"x86_64", "amd64"}:
        arch = "x64"
    else:
        arch = machine or "unknown"
    return f"{os_name}-{arch}"


def bundled_binary_candidates(binary_name: str) -> tuple[str, ...]:
    executable_name = f"{binary_name}.exe" if os.name == "nt" else binary_name
    platform_key = host_platform_key()
    return (
        str(PLATFORM_TOOLS_DIR / platform_key / "platform-tools" / executable_name),
        str(PLATFORM_TOOLS_DIR / platform_key / executable_name),
        str(PLATFORM_TOOLS_DIR / "platform-tools" / executable_name),
        str(PLATFORM_TOOLS_DIR / executable_name),
    )


ADB_CANDIDATES = (
    os.environ.get("DINGTALK_ADB_BIN", ""),
    *bundled_binary_candidates("adb"),
    "adb",
    "/opt/homebrew/bin/adb",
    "/usr/local/bin/adb",
    "/usr/bin/adb",
)
SCRCPY_CANDIDATES = (
    os.environ.get("DINGTALK_SCRCPY_BIN", ""),
    "scrcpy",
    "/opt/homebrew/bin/scrcpy",
    "/usr/local/bin/scrcpy",
)


@dataclass(frozen=True)
class TimeWindow:
    name: str
    start: dt_time
    end: dt_time


@dataclass(frozen=True)
class Config:
    serial: str
    package: str
    app_label: str
    delay_after_launch: int
    poll_interval: int
    enable_scrcpy_watch: bool
    scrcpy_launch_cooldown: int
    state_file: Path
    notify_on_success: bool
    enable_workday_check: bool
    workday_api_url: str
    workday_api_timeout: float


@dataclass(frozen=True)
class DeviceStatus:
    serial: str
    state: str
    usb_connected: bool
    raw_line: str


@dataclass(frozen=True)
class RecentTask:
    task_id: int
    package: str
    raw_line: str


@dataclass(frozen=True)
class NavigationState:
    navigation_mode: str
    force_fsg_nav_bar: str


@dataclass(frozen=True)
class WorkdayCheckResult:
    checked_date: date
    is_workday: bool
    note: str
    source: str
    checked_at: datetime


@dataclass
class SchedulerState:
    next_runs: dict[str, datetime]
    last_completed_dates: dict[str, date | None]
    last_workday_check: WorkdayCheckResult | None


WINDOWS: tuple[TimeWindow, ...] = (
    TimeWindow("morning", dt_time(9, 5), dt_time(9, 10)),
    TimeWindow("evening", dt_time(18, 5), dt_time(18, 15)),
)

ARG_DEFAULTS = {
    "serial": None,
    "package": DEFAULT_PACKAGE,
    "app_label": DEFAULT_APP_LABEL,
    "delay_after_launch": DEFAULT_DELAY_AFTER_LAUNCH,
    "adb_bin": None,
    "scrcpy_bin": None,
    "enable_scrcpy_watch": False,
    "poll_interval": DEFAULT_POLL_INTERVAL,
    "scrcpy_launch_cooldown": DEFAULT_SCRCPY_LAUNCH_COOLDOWN,
    "state_file": DEFAULT_STATE_FILE,
    "disable_workday_check": False,
    "workday_api_url": DEFAULT_WORKDAY_API_URL,
    "workday_api_timeout": DEFAULT_WORKDAY_API_TIMEOUT,
    "notify_on_success": False,
}

MORNING_MESSAGES: tuple[str, ...] = (
    "打卡上班，像个不折不扣的牛，努力向前，但总是慢半拍。",
    "今天上班的目标：打卡！剩下的事交给未来的我。",
    "早上打卡前，我是一匹蓄势待发的马，打卡后，我变成了懒牛。",
    "上班就像骑在马背上，风光无限，可就是累得不行。",
    "打卡是上班前的“程序”，而我就是那台自动运行的牛马。",
    "看着同事们像马一样飞奔，我只能像牛一样慢慢走。",
    "我的上班节奏就像牛一样，慢而稳；只不过工作堆积得像山一样。",
    "每次打卡，我都觉得自己是那头无休止工作的牛。",
    "上班就像无止境的马拉松，跑不完的工作，停不下的脚步。",
    "上班是为了生存，打卡是为了证明：我还是在努力做牛马。",
    "上班第一件事：打卡！第二件事：假装自己不想睡觉。",
    "我的工作效率堪比牛的步伐，慢吞吞，但一天都在忙。",
)

EVENING_MESSAGES: tuple[str, ...] = (
    "你看，今天下班，他的步伐像牛一样缓慢，心里却想着：我真该像马一样飞奔！",
    "你瞅瞅，他下班的时候，看起来像牛，拖着沉重的步伐，结果心里却在偷偷羡慕马的速度。",
    "你看，每次下班，他总是拖着疲惫的身躯，步伐慢得像牛，但他心里在想着：要是我能像马一样，飞快回家就好了！",
    "你瞅，他走出办公室，像头疲倦的牛，但心里却幻想着自己是一匹奔跑的马，飞奔回家。",
    "你看，每次下班，他都不急，脚步慢得像牛，内心却偷偷期待，哪天能像马一样，冲出公司。",
    "你瞅，他下班了，步伐慢得像牛，心情却轻松，仿佛在告诉自己：今天的工作终于结束了，终于可以休息了！",
    "你看，每次下班，他的步伐慢得像牛，但他却希望自己能像马一样飞奔回家去，快点享受自由。",
    "你瞅瞅，他下班的时候，慢吞吞地像牛走着，心里却在想：今天我就当个飞奔的马！",
    "你瞅，他走出公司，眼里充满了放松的光芒，但脚步还是像牛一样缓慢，一点也不急。",
    "你看，下班后的他，心情放松得像马，步伐却像牛一样稳重，缓慢前进。",
    "你看，每次下班，他都渴望像马一样快速，结果却像牛一样慢慢走。",
    "你瞅，他下班了，心情轻松，步伐却还是像牛一样慢。",
)


def log(message: str) -> None:
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {message}", flush=True)


def format_timestamp(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M:%S")


def format_window(window: TimeWindow) -> str:
    return f"{window.start.strftime('%H:%M')}-{window.end.strftime('%H:%M')}"


def is_executable_file(path: Path) -> bool:
    if not path.is_file():
        return False
    if os.name == "nt":
        return True
    return os.access(path, os.X_OK)


def resolve_binary_candidate(candidate: str) -> str | None:
    expanded = os.path.expandvars(os.path.expanduser(candidate.strip()))
    if not expanded:
        return None

    if "/" in expanded or "\\" in expanded:
        path = Path(expanded)
        return str(path) if is_executable_file(path) else None

    return shutil.which(expanded)


def resolve_binary(binary_name: str, configured_path: str | None, candidates: tuple[str, ...]) -> str:
    if configured_path:
        resolved = resolve_binary_candidate(configured_path)
        if resolved:
            return resolved
        raise RuntimeError(f"{binary_name} configured at {configured_path}, but it is not executable.")

    for candidate in candidates:
        resolved = resolve_binary_candidate(candidate)
        if resolved:
            return resolved

    if binary_name == "adb":
        hint = "Run scripts/install_platform_tools.py or pass the explicit path."
    else:
        hint = f"Install {binary_name} or pass the explicit path."
    raise RuntimeError(f"{binary_name} not found. {hint}")


def is_under(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def describe_binary_source(binary_path: str | None, configured_path: str | None = None) -> str:
    if not binary_path:
        return "missing"

    path = Path(binary_path).expanduser()
    if configured_path:
        return "front-end config"
    if is_under(path, PLATFORM_TOOLS_DIR):
        return f"bundled platform-tools ({host_platform_key()})"

    env_path = os.environ.get("DINGTALK_ADB_BIN") or os.environ.get("DINGTALK_SCRCPY_BIN")
    if env_path and Path(env_path).expanduser() == path:
        return "environment"

    return "system PATH"


def run_adb(adb_bin: str, serial: str | None, args: Iterable[str]) -> subprocess.CompletedProcess[str]:
    command = [adb_bin]
    if serial:
        command.extend(["-s", serial])
    command.extend(args)
    return subprocess.run(command, capture_output=True, text=True, check=True)


def restart_adb_server(adb_bin: str) -> str:
    def run_cmd(args: Iterable[str], check: bool) -> subprocess.CompletedProcess[str]:
        return subprocess.run([adb_bin, *args], capture_output=True, text=True, check=check)

    kill_result = run_cmd(["kill-server"], check=False)
    start_result = run_cmd(["start-server"], check=True)

    output = "\n".join(
        part.strip()
        for part in [kill_result.stdout, kill_result.stderr, start_result.stdout, start_result.stderr]
        if part and part.strip()
    )
    return output


def describe_process_error(exc: subprocess.CalledProcessError) -> str:
    stderr = (exc.stderr or "").strip()
    stdout = (exc.stdout or "").strip()
    return stderr or stdout or str(exc)


def get_setting(serial: str, namespace: str, key: str) -> str:
    result = run_adb(ADB_BIN, serial, ["shell", "settings", "get", namespace, key])
    return result.stdout.strip()


def put_setting(serial: str, namespace: str, key: str, value: str) -> None:
    run_adb(ADB_BIN, serial, ["shell", "settings", "put", namespace, key, value])


def parse_device_statuses(output: str) -> list[DeviceStatus]:
    statuses: list[DeviceStatus] = []
    for raw_line in output.splitlines()[1:]:
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        serial = parts[0]
        state = parts[1]
        usb_connected = any(part.startswith("usb:") for part in parts[2:])
        statuses.append(DeviceStatus(serial=serial, state=state, usb_connected=usb_connected, raw_line=line))
    return statuses


def list_device_statuses() -> list[DeviceStatus]:
    result = run_adb(ADB_BIN, None, ["devices", "-l"])
    return parse_device_statuses(result.stdout)


def get_device_status(serial: str) -> DeviceStatus | None:
    for status in list_device_statuses():
        if status.serial == serial:
            return status
    return None


def detect_single_device() -> str:
    devices = [status.serial for status in list_device_statuses() if status.state == "device"]

    if not devices:
        raise RuntimeError("No online adb device found. Check USB debugging and adb authorization.")
    if len(devices) > 1:
        raise RuntimeError(
            "Multiple adb devices found. Pass --serial to select one explicitly: "
            + ", ".join(devices)
        )
    return devices[0]


def apple_string(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def notify_user(title: str, message: str) -> None:
    try:
        subprocess.run(
            [
                OSASCRIPT_BIN,
                "-e",
                f"display notification {apple_string(message)} with title {apple_string(title)}",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
    except Exception as exc:
        log(f"Notification failed: {exc}")


def launch_app(serial: str, package: str) -> None:
    run_adb(
        ADB_BIN,
        serial,
        ["shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1"],
    )
    log(f"Launched {package} on device {serial}.")


def stop_app(serial: str, package: str) -> None:
    run_adb(ADB_BIN, serial, ["shell", "am", "force-stop", package])
    log(f"Force-stopped {package} on device {serial}.")


def get_navigation_state(serial: str) -> NavigationState:
    return NavigationState(
        navigation_mode=get_setting(serial, "secure", "navigation_mode"),
        force_fsg_nav_bar=get_setting(serial, "global", "force_fsg_nav_bar"),
    )


def switch_to_button_navigation_for_miui(serial: str) -> NavigationState:
    original_state = get_navigation_state(serial)
    changed = False

    if original_state.force_fsg_nav_bar != "0":
        put_setting(serial, "global", "force_fsg_nav_bar", "0")
        changed = True
    if original_state.navigation_mode != "0":
        put_setting(serial, "secure", "navigation_mode", "0")
        changed = True

    if changed:
        time.sleep(1)
    return original_state


def restore_navigation_state(serial: str, state: NavigationState) -> None:
    current_state = get_navigation_state(serial)
    if current_state.force_fsg_nav_bar != state.force_fsg_nav_bar:
        put_setting(serial, "global", "force_fsg_nav_bar", state.force_fsg_nav_bar)
    if current_state.navigation_mode != state.navigation_mode:
        put_setting(serial, "secure", "navigation_mode", state.navigation_mode)


def dump_ui_xml(serial: str) -> str:
    run_adb(ADB_BIN, serial, ["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"])
    return run_adb(ADB_BIN, serial, ["shell", "cat", "/sdcard/window_dump.xml"]).stdout


def parse_bounds(bounds: str) -> tuple[int, int, int, int]:
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
    if not match:
        raise ValueError(f"Unsupported bounds: {bounds}")
    return tuple(int(value) for value in match.groups())


def is_miui_recents_ui(xml_text: str) -> bool:
    return "com.miui.home:id/recents_container" in xml_text


def is_miui_recents_empty(xml_text: str) -> bool:
    return "近期没有任何内容" in xml_text


def find_miui_recent_card_bounds(xml_text: str, app_label: str) -> tuple[int, int, int, int] | None:
    root = ET.fromstring(xml_text)
    parent_map = {child: parent for parent in root.iter() for child in parent}

    for node in root.iter("node"):
        package = node.attrib.get("package", "")
        if package != "com.miui.home":
            continue

        content_desc = node.attrib.get("content-desc", "")
        text = node.attrib.get("text", "")
        if app_label not in content_desc and text != app_label:
            continue

        current = node
        while current is not None:
            clickable = current.attrib.get("clickable") == "true"
            bounds = current.attrib.get("bounds")
            if clickable and bounds:
                return parse_bounds(bounds)
            current = parent_map.get(current)

    return None


def dismiss_recent_task_card_on_miui(serial: str, package: str, app_label: str) -> bool:
    original_navigation_state = switch_to_button_navigation_for_miui(serial)
    try:
        run_adb(ADB_BIN, serial, ["shell", "input", "keyevent", "KEYCODE_APP_SWITCH"])
        time.sleep(1)

        ui_xml = dump_ui_xml(serial)
        if not is_miui_recents_ui(ui_xml):
            log("MIUI recents UI did not open as expected.")
            return False

        bounds = find_miui_recent_card_bounds(ui_xml, app_label)
        if bounds is None:
            if is_miui_recents_empty(ui_xml):
                log(f"MIUI recents is already empty for {app_label}.")
                return True
            log(f"Could not locate recent-task card for {app_label}.")
            return False

        left, top, right, bottom = bounds
        center_x = (left + right) // 2
        center_y = (top + bottom) // 2
        dismiss_y = "120"

        removed = False
        for _ in range(2):
            run_adb(
                ADB_BIN,
                serial,
                ["shell", "input", "swipe", str(center_x), str(center_y), str(center_x), dismiss_y, "250"],
            )
            for _ in range(3):
                time.sleep(1)
                after_swipe_ui_xml = dump_ui_xml(serial)
                removed = (
                    is_miui_recents_empty(after_swipe_ui_xml)
                    or find_miui_recent_card_bounds(after_swipe_ui_xml, app_label) is None
                )
                if removed:
                    break
            if removed:
                break

        if not removed:
            run_adb(ADB_BIN, serial, ["shell", "input", "keyevent", "KEYCODE_HOME"])
            time.sleep(1)
            run_adb(ADB_BIN, serial, ["shell", "input", "keyevent", "KEYCODE_APP_SWITCH"])
            time.sleep(1)
            refreshed_ui_xml = dump_ui_xml(serial)
            removed = (
                is_miui_recents_empty(refreshed_ui_xml)
                or find_miui_recent_card_bounds(refreshed_ui_xml, app_label) is None
            )

        if removed:
            log(f"Dismissed MIUI recent-task card for {app_label}.")
        else:
            log(f"MIUI recent-task card for {app_label} is still visible after swipe.")
        return removed
    finally:
        run_adb(ADB_BIN, serial, ["shell", "input", "keyevent", "KEYCODE_HOME"])
        restore_navigation_state(serial, original_navigation_state)
        time.sleep(1)


def is_scrcpy_running_for_serial(serial: str) -> bool:
    result = subprocess.run(
        ["ps", "-ax", "-o", "pid=,args="],
        capture_output=True,
        text=True,
        check=True,
    )
    for line in result.stdout.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        parts = stripped.split(maxsplit=1)
        if len(parts) < 2:
            continue
        try:
            argv = shlex.split(parts[1])
        except ValueError:
            continue
        if not argv:
            continue
        executable = argv[0].rsplit("/", 1)[-1]
        if executable != "scrcpy":
            continue
        for index, arg in enumerate(argv[:-1]):
            if arg in {"--serial", "-s"} and argv[index + 1] == serial:
                return True
    return False


def launch_scrcpy(serial: str) -> None:
    env = os.environ.copy()
    current_path = env.get("PATH", "")
    adb_dir = ADB_BIN.rsplit("/", 1)[0] if "/" in ADB_BIN else ""
    if adb_dir and adb_dir not in current_path.split(":"):
        env["PATH"] = f"{adb_dir}:{current_path}" if current_path else adb_dir
    env["ADB"] = ADB_BIN
    subprocess.Popen(
        [SCRCPY_BIN, "--serial", serial],
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    log(f"Launched scrcpy for device {serial}.")


def random_datetime_for_window(target_day: date, window: TimeWindow) -> datetime:
    start_dt = datetime.combine(target_day, window.start)
    end_dt = datetime.combine(target_day, window.end)
    total_seconds = int((end_dt - start_dt).total_seconds())
    offset = random.randint(0, total_seconds)
    return start_dt + timedelta(seconds=offset)


def parse_clock_time(value: str) -> dt_time:
    value = value.strip()
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(value, fmt).time()
        except ValueError:
            continue
    raise ValueError(f"Unsupported time format: {value}. Expected HH:MM or HH:MM:SS.")


def window_contains_time(window: TimeWindow, value: dt_time) -> bool:
    return window.start <= value <= window.end


def load_runtime_config(path: Path) -> dict:
    if not path.exists():
        return {}

    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Config file must contain a JSON object.")
    return payload


def parse_window_overrides(payload: dict) -> tuple[TimeWindow, ...]:
    if not isinstance(payload, dict):
        raise ValueError("windows must be an object keyed by window name.")

    windows: list[TimeWindow] = []
    for window_name in ("morning", "evening"):
        raw_window = payload.get(window_name)
        if not isinstance(raw_window, dict):
            raise ValueError(f"Missing window definition for {window_name}.")

        start = parse_clock_time(str(raw_window.get("start", "")).strip())
        end = parse_clock_time(str(raw_window.get("end", "")).strip())
        if start >= end:
            raise ValueError(
                f"Window {window_name} is invalid: start {start.strftime('%H:%M:%S')} "
                f"must be earlier than end {end.strftime('%H:%M:%S')}."
            )
        windows.append(TimeWindow(window_name, start, end))

    return tuple(windows)


def override_arg_from_config(args: argparse.Namespace, attr: str, value: object) -> None:
    if value is None:
        return
    if getattr(args, attr) != ARG_DEFAULTS[attr]:
        return
    setattr(args, attr, value)


def apply_runtime_config(args: argparse.Namespace) -> None:
    global WINDOWS

    config_path = Path(args.config_file).expanduser()
    args.config_file = str(config_path)
    payload = load_runtime_config(config_path)
    if not payload:
        return

    raw_windows = payload.get("windows")
    if raw_windows is not None:
        WINDOWS = parse_window_overrides(raw_windows)

    serial = str(payload.get("serial", "")).strip()
    override_arg_from_config(args, "serial", serial or None)
    override_arg_from_config(args, "package", str(payload.get("package", "")).strip() or None)
    override_arg_from_config(args, "app_label", str(payload.get("app_label", "")).strip() or None)

    raw_delay_after_launch = payload.get("delay_after_launch")
    if raw_delay_after_launch is not None:
        override_arg_from_config(args, "delay_after_launch", max(1, int(raw_delay_after_launch)))

    raw_poll_interval = payload.get("poll_interval")
    if raw_poll_interval is not None:
        override_arg_from_config(args, "poll_interval", max(1, int(raw_poll_interval)))

    raw_scrcpy_launch_cooldown = payload.get("scrcpy_launch_cooldown")
    if raw_scrcpy_launch_cooldown is not None:
        override_arg_from_config(
            args,
            "scrcpy_launch_cooldown",
            max(1, int(raw_scrcpy_launch_cooldown)),
        )

    raw_state_file = str(payload.get("state_file", "")).strip()
    if raw_state_file:
        override_arg_from_config(args, "state_file", raw_state_file)

    raw_workday_api_url = str(payload.get("workday_api_url", "")).strip()
    if raw_workday_api_url:
        override_arg_from_config(args, "workday_api_url", raw_workday_api_url)

    raw_workday_timeout_ms = payload.get("workday_api_timeout_ms")
    raw_workday_timeout_seconds = payload.get("workday_api_timeout")
    if raw_workday_timeout_ms is not None:
        override_arg_from_config(
            args,
            "workday_api_timeout",
            max(1.0, float(raw_workday_timeout_ms) / 1000.0),
        )
    elif raw_workday_timeout_seconds is not None:
        override_arg_from_config(
            args,
            "workday_api_timeout",
            max(1.0, float(raw_workday_timeout_seconds)),
        )

    raw_adb_bin = str(payload.get("adb_bin", "")).strip()
    if raw_adb_bin:
        override_arg_from_config(args, "adb_bin", raw_adb_bin)

    raw_scrcpy_bin = str(payload.get("scrcpy_bin", "")).strip()
    if raw_scrcpy_bin:
        override_arg_from_config(args, "scrcpy_bin", raw_scrcpy_bin)

    if not args.enable_scrcpy_watch and bool(payload.get("enable_scrcpy_watch")):
        args.enable_scrcpy_watch = True

    if not args.notify_on_success and bool(payload.get("notify_on_success")):
        args.notify_on_success = True

    if not args.disable_workday_check and payload.get("enable_workday_check") is False:
        args.disable_workday_check = True


def next_run_after(now: datetime, window: TimeWindow) -> datetime:
    today_candidate = random_datetime_for_window(now.date(), window)
    if today_candidate > now:
        return today_candidate
    return random_datetime_for_window(now.date() + timedelta(days=1), window)


def build_daily_schedule(now: datetime) -> dict[str, datetime]:
    return {window.name: next_run_after(now, window) for window in WINDOWS}


def create_scheduler_state(now: datetime) -> SchedulerState:
    return SchedulerState(
        next_runs=build_daily_schedule(now),
        last_completed_dates={window.name: None for window in WINDOWS},
        last_workday_check=None,
    )


def normalize_scheduler_state(state: SchedulerState, now: datetime) -> SchedulerState:
    normalized = SchedulerState(
        next_runs=dict(state.next_runs),
        last_completed_dates=dict(state.last_completed_dates),
        last_workday_check=state.last_workday_check,
    )
    for window in WINDOWS:
        normalized.last_completed_dates.setdefault(window.name, None)
        scheduled_time = normalized.next_runs.get(window.name)
        if scheduled_time is None:
            normalized.next_runs[window.name] = next_run_after(now, window)
            continue
        if scheduled_time.date() < now.date():
            normalized.next_runs[window.name] = next_run_after(now, window)
            continue
        last_completed = normalized.last_completed_dates.get(window.name)
        if last_completed == scheduled_time.date() and scheduled_time <= now:
            normalized.next_runs[window.name] = next_run_after(now, window)
    return normalized


def load_scheduler_state(path: Path, now: datetime) -> SchedulerState:
    if not path.exists():
        return create_scheduler_state(now)

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        log(f"State file is unreadable, recreating it: {exc}")
        return create_scheduler_state(now)

    next_runs: dict[str, datetime] = {}
    for window in WINDOWS:
        raw_value = payload.get("next_runs", {}).get(window.name)
        if not raw_value:
            continue
        try:
            next_runs[window.name] = datetime.fromisoformat(raw_value)
        except ValueError:
            continue

    last_completed_dates: dict[str, date | None] = {}
    for window in WINDOWS:
        raw_value = payload.get("last_completed_dates", {}).get(window.name)
        if not raw_value:
            last_completed_dates[window.name] = None
            continue
        try:
            last_completed_dates[window.name] = date.fromisoformat(raw_value)
        except ValueError:
            last_completed_dates[window.name] = None

    last_workday_check: WorkdayCheckResult | None = None
    raw_workday_check = payload.get("last_workday_check")
    if isinstance(raw_workday_check, dict):
        try:
            checked_date = date.fromisoformat(raw_workday_check["checked_date"])
            checked_at = datetime.fromisoformat(raw_workday_check["checked_at"])
            is_workday = bool(raw_workday_check["is_workday"])
            note = str(raw_workday_check.get("note", ""))
            source = str(raw_workday_check.get("source", ""))
            last_workday_check = WorkdayCheckResult(
                checked_date=checked_date,
                is_workday=is_workday,
                note=note,
                source=source,
                checked_at=checked_at,
            )
        except (KeyError, TypeError, ValueError):
            last_workday_check = None

    return normalize_scheduler_state(
        SchedulerState(next_runs, last_completed_dates, last_workday_check),
        now,
    )


def save_scheduler_state(path: Path, state: SchedulerState) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "next_runs": {name: value.isoformat() for name, value in state.next_runs.items()},
        "last_completed_dates": {
            name: value.isoformat() if value else None
            for name, value in state.last_completed_dates.items()
        },
        "last_workday_check": (
            {
                "checked_date": state.last_workday_check.checked_date.isoformat(),
                "is_workday": state.last_workday_check.is_workday,
                "note": state.last_workday_check.note,
                "source": state.last_workday_check.source,
                "checked_at": state.last_workday_check.checked_at.isoformat(),
            }
            if state.last_workday_check
            else None
        ),
        "updated_at": datetime.now().isoformat(),
    }
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temp_path.replace(path)


def reschedule_window(state: SchedulerState, window: TimeWindow, anchor_day: date) -> None:
    state.next_runs[window.name] = random_datetime_for_window(anchor_day + timedelta(days=1), window)


def find_window(name: str) -> TimeWindow:
    normalized = name.strip().lower()
    for window in WINDOWS:
        if window.name == normalized:
            return window
    raise ValueError(f"Unsupported window: {name}. Expected one of: {', '.join(window.name for window in WINDOWS)}.")


def set_next_run_for_window(state: SchedulerState, window: TimeWindow, clock_time: dt_time) -> datetime:
    if not window_contains_time(window, clock_time):
        raise ValueError(
            f"Time {clock_time.strftime('%H:%M:%S')} is outside the {window.name} window "
            f"{format_window(window)}."
        )

    current_next_run = state.next_runs.get(window.name)
    target_day = current_next_run.date() if current_next_run else datetime.now().date()
    custom_next_run = datetime.combine(target_day, clock_time)
    state.next_runs[window.name] = custom_next_run
    return custom_next_run


def fetch_workday_status(target_day: date, api_url_template: str, timeout: float) -> WorkdayCheckResult:
    request_url = api_url_template.format(date=target_day.isoformat())
    with urllib.request.urlopen(request_url, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))

    type_label = str(payload.get("type", "")).strip()
    note = str(payload.get("note", "")).strip()
    is_holiday = payload.get("isHoliday")

    if type_label == "工作日":
        is_workday = True
    elif type_label == "假日":
        is_workday = False
    elif isinstance(is_holiday, bool):
        is_workday = not is_holiday
    else:
        raise ValueError(f"Unsupported workday API response: {payload}")

    return WorkdayCheckResult(
        checked_date=target_day,
        is_workday=is_workday,
        note=note or type_label or ("工作日" if is_workday else "假日"),
        source=request_url,
        checked_at=datetime.now(),
    )


def ensure_workday_status(config: Config, state: SchedulerState, target_day: date) -> WorkdayCheckResult | None:
    if not config.enable_workday_check:
        return None

    if state.last_workday_check and state.last_workday_check.checked_date == target_day:
        return state.last_workday_check

    result = fetch_workday_status(target_day, config.workday_api_url, config.workday_api_timeout)
    state.last_workday_check = result
    save_scheduler_state(config.state_file, state)
    label = "workday" if result.is_workday else "non-workday"
    log(f"Workday check for {target_day.isoformat()}: {label} ({result.note}).")
    return result


def roll_windows_forward_for_non_workday(config: Config, state: SchedulerState, target_day: date) -> None:
    changed = False
    for window in WINDOWS:
        scheduled_time = state.next_runs[window.name]
        if scheduled_time.date() <= target_day:
            state.next_runs[window.name] = random_datetime_for_window(target_day + timedelta(days=1), window)
            changed = True
            log(
                f"Skipped {window.name} window on {target_day.isoformat()} because it is not a workday. "
                f"Rescheduled to {format_timestamp(state.next_runs[window.name])}."
            )

    if changed:
        save_scheduler_state(config.state_file, state)


def random_morning_message() -> str:
    return random.choice(MORNING_MESSAGES)


def random_evening_message() -> str:
    return random.choice(EVENING_MESSAGES)


def perform_action(serial: str, package: str, app_label: str, delay_after_launch: int) -> None:
    launch_app(serial, package)
    log(f"Waiting {delay_after_launch} seconds before stopping {package}.")
    time.sleep(delay_after_launch)
    stop_app(serial, package)
    try:
        dismiss_recent_task_card_on_miui(serial, package, app_label)
    except subprocess.CalledProcessError as exc:
        details = describe_process_error(exc)
        log(f"Recent-task cleanup failed: {details}")
    except Exception as exc:
        log(f"Unexpected error during recent-task cleanup: {exc}")


def process_due_windows(config: Config, state: SchedulerState) -> None:
    now = datetime.now()
    for window in WINDOWS:
        scheduled_time = state.next_runs[window.name]
        if now < scheduled_time:
            continue

        if state.last_completed_dates.get(window.name) == scheduled_time.date():
            log(
                f"Skipping {window.name} action at {format_timestamp(scheduled_time)} "
                "because it was already completed."
            )
            reschedule_window(state, window, scheduled_time.date())
            save_scheduler_state(config.state_file, state)
            continue

        log(f"Executing {window.name} action scheduled for {format_timestamp(scheduled_time)}.")
        action_succeeded = False
        try:
            perform_action(config.serial, config.package, config.app_label, config.delay_after_launch)
            action_succeeded = True
            state.last_completed_dates[window.name] = scheduled_time.date()
            completion_message: str | None = None
            if window.name == "morning":
                completion_message = random_morning_message()
                log(completion_message)
            elif window.name == "evening":
                completion_message = random_evening_message()
                log(completion_message)
            if config.notify_on_success:
                notify_message = (
                    completion_message
                    if completion_message
                    else f"{window.name} window completed at {datetime.now().strftime('%H:%M:%S')}."
                )
                notify_user("DingTalk automation completed", notify_message)
        except subprocess.CalledProcessError as exc:
            details = describe_process_error(exc)
            log(f"adb command failed: {details}")
            notify_user("DingTalk automation failed", details[:180])
        except Exception as exc:
            log(f"Unexpected error during scheduled action: {exc}")
            notify_user("DingTalk automation failed", str(exc)[:180])
        finally:
            reschedule_window(state, window, scheduled_time.date())
            save_scheduler_state(config.state_file, state)
            outcome = "completed" if action_succeeded else "finished with errors"
            log(
                f"{window.name} action {outcome}. "
                f"Next run: {format_timestamp(state.next_runs[window.name])}."
            )


def is_device_ready(status: DeviceStatus | None) -> bool:
    return bool(status and status.state == "device" and status.usb_connected)


def maybe_launch_scrcpy(
    serial: str,
    status: DeviceStatus | None,
    previous_device_ready: bool | None,
    last_scrcpy_attempt_monotonic: float | None,
    scrcpy_launch_cooldown: int,
) -> tuple[bool, float | None]:
    current_device_ready = is_device_ready(status)
    if not current_device_ready:
        return current_device_ready, last_scrcpy_attempt_monotonic

    if previous_device_ready:
        return current_device_ready, last_scrcpy_attempt_monotonic

    now_monotonic = time.monotonic()
    if (
        last_scrcpy_attempt_monotonic is not None
        and now_monotonic - last_scrcpy_attempt_monotonic < scrcpy_launch_cooldown
    ):
        return current_device_ready, last_scrcpy_attempt_monotonic

    if is_scrcpy_running_for_serial(serial):
        return current_device_ready, last_scrcpy_attempt_monotonic

    try:
        launch_scrcpy(serial)
        return current_device_ready, now_monotonic
    except Exception as exc:
        log(f"Failed to launch scrcpy: {exc}")
        return current_device_ready, now_monotonic


def status_summary(status: DeviceStatus | None) -> str:
    if status is None:
        return "disconnected"
    if status.state == "unauthorized":
        return "usb-connected but unauthorized"
    if status.state == "device" and status.usb_connected:
        return "usb-connected and authorized"
    if status.state == "device":
        return "authorized but not identified as usb-connected"
    return status.state


def describe_window_state(state: SchedulerState, window: TimeWindow) -> str:
    next_run = state.next_runs[window.name]
    last_completed = state.last_completed_dates.get(window.name)
    last_completed_text = last_completed.isoformat() if last_completed else "never"
    return (
        f"{window.name:<7} window {format_window(window)} | "
        f"next: {format_timestamp(next_run)} | last completed: {last_completed_text}"
    )


def print_schedule_report(state: SchedulerState, state_file: Path) -> None:
    print(f"State file: {state_file}")
    if state.last_workday_check:
        decision = "workday" if state.last_workday_check.is_workday else "non-workday"
        print(
            "Last workday check: "
            f"{state.last_workday_check.checked_date.isoformat()} | "
            f"{decision} | {state.last_workday_check.note}"
        )
    for window in WINDOWS:
        print(describe_window_state(state, window))


def should_enable_scrcpy_watch(args: argparse.Namespace) -> bool:
    return args.enable_scrcpy_watch


def resolve_binaries_for_run(args: argparse.Namespace) -> tuple[str, str | None]:
    adb_bin = resolve_binary("adb", args.adb_bin, ADB_CANDIDATES)
    scrcpy_bin = None
    if should_enable_scrcpy_watch(args):
        scrcpy_bin = resolve_binary("scrcpy", args.scrcpy_bin, SCRCPY_CANDIDATES)
    return adb_bin, scrcpy_bin


def resolve_binaries_for_inspection(args: argparse.Namespace) -> tuple[str | None, str | None, list[str]]:
    warnings: list[str] = []

    try:
        adb_bin = resolve_binary("adb", args.adb_bin, ADB_CANDIDATES)
    except Exception as exc:
        adb_bin = None
        warnings.append(f"adb unavailable: {exc}")

    try:
        scrcpy_bin = resolve_binary("scrcpy", args.scrcpy_bin, SCRCPY_CANDIDATES)
    except Exception as exc:
        scrcpy_bin = None
        warnings.append(f"scrcpy unavailable: {exc}")

    return adb_bin, scrcpy_bin, warnings


def build_config(args: argparse.Namespace, serial: str) -> Config:
    return Config(
        serial=serial,
        package=args.package,
        app_label=args.app_label,
        delay_after_launch=max(1, args.delay_after_launch),
        poll_interval=max(1, args.poll_interval),
        enable_scrcpy_watch=should_enable_scrcpy_watch(args),
        scrcpy_launch_cooldown=max(1, args.scrcpy_launch_cooldown),
        state_file=Path(args.state_file).expanduser(),
        notify_on_success=args.notify_on_success,
        enable_workday_check=not args.disable_workday_check,
        workday_api_url=args.workday_api_url,
        workday_api_timeout=max(1.0, args.workday_api_timeout),
    )


def command_schedule(args: argparse.Namespace) -> int:
    state_file = Path(args.state_file).expanduser()
    state = load_scheduler_state(state_file, datetime.now())
    print_schedule_report(state, state_file)
    return 0


def command_set_next(args: argparse.Namespace) -> int:
    state_file = Path(args.state_file).expanduser()
    now = datetime.now()
    state = load_scheduler_state(state_file, now)

    try:
        window = find_window(args.window)
        clock_time = parse_clock_time(args.time)
        scheduled_at = set_next_run_for_window(state, window, clock_time)
    except ValueError as exc:
        print(f"Error: {exc}")
        return 1

    save_scheduler_state(state_file, state)
    print(
        f"Updated {window.name} next run to {format_timestamp(scheduled_at)} "
        f"in state file {state_file}."
    )
    return 0


def command_status(args: argparse.Namespace) -> int:
    state_file = Path(args.state_file).expanduser()
    state = load_scheduler_state(state_file, datetime.now())
    print_schedule_report(state, state_file)

    adb_bin, scrcpy_bin, warnings = resolve_binaries_for_inspection(args)
    for warning in warnings:
        print(f"Warning: {warning}")

    if not adb_bin:
        return 0

    print(f"ADB: {adb_bin} ({describe_binary_source(adb_bin, args.adb_bin)})")

    global ADB_BIN, SCRCPY_BIN
    ADB_BIN = adb_bin
    if scrcpy_bin:
        SCRCPY_BIN = scrcpy_bin

    try:
        serial = args.serial or detect_single_device()
    except subprocess.CalledProcessError as exc:
        print(f"Device: unavailable ({describe_process_error(exc)})")
        return 0
    except Exception as exc:
        print(f"Device: unavailable ({exc})")
        return 0

    try:
        status = get_device_status(serial)
    except subprocess.CalledProcessError as exc:
        print(f"Device: unavailable ({describe_process_error(exc)})")
        return 0
    print(f"Device: {serial} | {status_summary(status)}")
    if scrcpy_bin:
        print(f"scrcpy: {'running' if is_scrcpy_running_for_serial(serial) else 'not running'}")
    return 0


def command_doctor(args: argparse.Namespace) -> int:
    state_file = Path(args.state_file).expanduser()
    issues: list[str] = []
    warnings: list[str] = []
    scrcpy_required = should_enable_scrcpy_watch(args)

    adb_bin, scrcpy_bin, binary_warnings = resolve_binaries_for_inspection(args)
    if adb_bin:
        print(f"OK   adb: {adb_bin} ({describe_binary_source(adb_bin, args.adb_bin)})")
    else:
        issues.append("adb is required for scheduling and device checks. Run scripts/install_platform_tools.py.")
    if scrcpy_bin:
        print(f"OK   scrcpy: {scrcpy_bin} ({describe_binary_source(scrcpy_bin, args.scrcpy_bin)})")
    else:
        if scrcpy_required:
            issues.append("scrcpy is required while scrcpy watch is enabled.")
        else:
            print("WARN scrcpy: unavailable, but production mode only needs adb.")

    try:
        state = load_scheduler_state(state_file, datetime.now())
        save_scheduler_state(state_file, state)
        print(f"OK   state file: {state_file}")
    except Exception as exc:
        issues.append(f"state file is not writable: {exc}")

    if args.disable_workday_check:
        print("OK   workday check: disabled")
    else:
        try:
            result = fetch_workday_status(date.today(), args.workday_api_url, max(1.0, args.workday_api_timeout))
            decision = "workday" if result.is_workday else "non-workday"
            print(f"OK   workday API: {decision} ({result.note})")
        except Exception as exc:
            warnings.append(f"workday API unavailable: {exc}")

    for warning in binary_warnings + warnings:
        print(f"WARN {warning}")

    if not adb_bin:
        for issue in issues:
            print(f"FAIL {issue}")
        return 1

    global ADB_BIN, SCRCPY_BIN
    ADB_BIN = adb_bin
    if scrcpy_bin:
        SCRCPY_BIN = scrcpy_bin

    try:
        statuses = list_device_statuses()
        if not statuses:
            issues.append("no adb devices found.")
        else:
            for status in statuses:
                print(f"OK   device: {status.raw_line}")
    except subprocess.CalledProcessError as exc:
        issues.append(f"failed to query adb devices: {describe_process_error(exc)}")
        statuses = []
    except Exception as exc:
        issues.append(f"failed to query adb devices: {exc}")
        statuses = []

    selected_serial: str | None = None
    if statuses:
        try:
            selected_serial = args.serial or detect_single_device()
            print(f"OK   selected device: {selected_serial}")
        except Exception as exc:
            issues.append(str(exc))

    if selected_serial:
        selected_status = get_device_status(selected_serial)
        if selected_status and selected_status.state == "unauthorized":
            issues.append(
                f"device {selected_serial} is connected but unauthorized. Approve USB debugging on the phone."
            )
        elif selected_status is None:
            issues.append(f"device {selected_serial} is not visible to adb.")
        else:
            print(f"OK   device state: {status_summary(selected_status)}")
            if scrcpy_bin:
                print(
                    f"OK   scrcpy state: "
                    f"{'running' if is_scrcpy_running_for_serial(selected_serial) else 'not running'}"
                )

    if issues:
        for issue in issues:
            print(f"FAIL {issue}")
        return 1

    print("OK   doctor finished with no blocking issues.")
    return 0


def command_run(args: argparse.Namespace) -> int:
    global ADB_BIN, SCRCPY_BIN

    try:
        ADB_BIN, SCRCPY_BIN = resolve_binaries_for_run(args)
    except Exception as exc:
        log(f"Binary initialization failed: {exc}")
        return 1

    try:
        serial = args.serial or detect_single_device()
    except Exception as exc:
        log(f"Device detection failed: {exc}")
        return 1

    config = build_config(args, serial)
    state = load_scheduler_state(config.state_file, datetime.now())
    save_scheduler_state(config.state_file, state)

    log(f"Using adb {ADB_BIN}.")
    if config.enable_scrcpy_watch and SCRCPY_BIN:
        log(f"Using scrcpy {SCRCPY_BIN}.")
    log(f"Using device {config.serial}. Package: {config.package}. App label: {config.app_label}")
    log(
        f"scrcpy reconnect watch: {'enabled' if config.enable_scrcpy_watch else 'disabled'}. "
        f"Poll interval: {config.poll_interval}s."
    )
    if config.enable_workday_check:
        log(f"Workday check: enabled via {config.workday_api_url}.")
    else:
        log("Workday check: disabled.")
    log(f"State file: {config.state_file}")
    for window in WINDOWS:
        log(f"Next {window.name} run scheduled at {format_timestamp(state.next_runs[window.name])}.")
    log("Press Ctrl+C to stop.")

    previous_status_summary: str | None = None
    previous_device_ready: bool | None = None
    last_scrcpy_attempt_monotonic: float | None = None
    authorization_prompt_shown = False

    try:
        while True:
            try:
                device_status = get_device_status(config.serial)
            except Exception as exc:
                device_status = None
                log(f"Device status check failed: {exc}")

            current_status_summary = status_summary(device_status)
            if previous_status_summary is None or current_status_summary != previous_status_summary:
                log(f"Device {config.serial} state: {current_status_summary}.")
                previous_status_summary = current_status_summary

            if device_status and device_status.state == "unauthorized" and device_status.usb_connected:
                if not authorization_prompt_shown:
                    log(
                        f"Device {config.serial} is connected by USB but adb is not authorized. "
                        "Approve the USB debugging prompt on the phone."
                    )
                    notify_user(
                        "Android device authorization required",
                        f"Device {config.serial} is waiting for USB debugging authorization. "
                        "Please tap Allow on the phone.",
                    )
                    authorization_prompt_shown = True
            else:
                authorization_prompt_shown = False

            if config.enable_scrcpy_watch:
                previous_device_ready, last_scrcpy_attempt_monotonic = maybe_launch_scrcpy(
                    config.serial,
                    device_status,
                    previous_device_ready,
                    last_scrcpy_attempt_monotonic,
                    config.scrcpy_launch_cooldown,
                )
            else:
                previous_device_ready = is_device_ready(device_status)

            if is_device_ready(device_status):
                if config.enable_workday_check:
                    try:
                        workday_result = ensure_workday_status(config, state, datetime.now().date())
                    except Exception as exc:
                        log(f"Workday check failed, continuing with normal scheduling: {exc}")
                        workday_result = None
                    if workday_result and not workday_result.is_workday:
                        roll_windows_forward_for_non_workday(config, state, datetime.now().date())
                    else:
                        process_due_windows(config, state)
                else:
                    process_due_windows(config, state)
            time.sleep(config.poll_interval)
    except KeyboardInterrupt:
        log("Scheduler stopped by user.")
        return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Persistent DingTalk scheduler for one Android device; scrcpy is controlled only by explicit config."
    )
    parser.add_argument(
        "command",
        nargs="?",
        choices=("run", "debug", "status", "schedule", "doctor", "set-next"),
        default="run",
        help="run the scheduler, start debug mode, inspect status/schedule, update the next run, or run diagnostics",
    )
    parser.add_argument(
        "--window",
        choices=tuple(window.name for window in WINDOWS),
        help="target schedule window for set-next, e.g. morning or evening",
    )
    parser.add_argument(
        "--time",
        help="custom next run time for set-next. Format: HH:MM or HH:MM:SS",
    )
    parser.add_argument(
        "--serial",
        help="adb device serial. If omitted, the script auto-selects the only online device.",
    )
    parser.add_argument(
        "--package",
        default=DEFAULT_PACKAGE,
        help=f"Android package name to control. Default: {DEFAULT_PACKAGE}",
    )
    parser.add_argument(
        "--app-label",
        default=DEFAULT_APP_LABEL,
        help=f"Visible app label used for MIUI recents cleanup. Default: {DEFAULT_APP_LABEL}",
    )
    parser.add_argument(
        "--delay-after-launch",
        type=int,
        default=DEFAULT_DELAY_AFTER_LAUNCH,
        help=f"Seconds to wait before force-stopping the app. Default: {DEFAULT_DELAY_AFTER_LAUNCH}",
    )
    parser.add_argument(
        "--adb-bin",
        help="Absolute path to adb. If omitted, the script searches common platform-tools locations.",
    )
    parser.add_argument(
        "--scrcpy-bin",
        help="Absolute path to scrcpy. If omitted, the script searches common install locations.",
    )
    parser.add_argument(
        "--enable-scrcpy-watch",
        action="store_true",
        help="Enable automatic scrcpy relaunch on reconnect. Debug mode does not enable it implicitly.",
    )
    parser.add_argument(
        "--poll-interval",
        type=int,
        default=DEFAULT_POLL_INTERVAL,
        help=f"Main loop poll interval in seconds. Default: {DEFAULT_POLL_INTERVAL}",
    )
    parser.add_argument(
        "--scrcpy-launch-cooldown",
        type=int,
        default=DEFAULT_SCRCPY_LAUNCH_COOLDOWN,
        help=(
            "Minimum seconds between scrcpy relaunch attempts after reconnect. "
            f"Default: {DEFAULT_SCRCPY_LAUNCH_COOLDOWN}"
        ),
    )
    parser.add_argument(
        "--state-file",
        default=DEFAULT_STATE_FILE,
        help=f"Path to the persisted scheduler state file. Default: {DEFAULT_STATE_FILE}",
    )
    parser.add_argument(
        "--config-file",
        default=DEFAULT_CONFIG_FILE,
        help=f"Optional JSON config file for runtime overrides. Default: {DEFAULT_CONFIG_FILE}",
    )
    parser.add_argument(
        "--disable-workday-check",
        action="store_true",
        help="Disable the online China workday check and always use the local schedule.",
    )
    parser.add_argument(
        "--workday-api-url",
        default=DEFAULT_WORKDAY_API_URL,
        help=f"China workday API URL template. Default: {DEFAULT_WORKDAY_API_URL}",
    )
    parser.add_argument(
        "--workday-api-timeout",
        type=float,
        default=DEFAULT_WORKDAY_API_TIMEOUT,
        help=f"Workday API timeout in seconds. Default: {DEFAULT_WORKDAY_API_TIMEOUT}",
    )
    parser.add_argument(
        "--notify-on-success",
        action="store_true",
        help="Show a macOS notification after a scheduled window completes successfully.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        apply_runtime_config(args)
    except Exception as exc:
        print(f"Error: failed to load config file {args.config_file}: {exc}")
        return 1
    if args.command == "schedule":
        return command_schedule(args)
    if args.command == "status":
        return command_status(args)
    if args.command == "doctor":
        return command_doctor(args)
    if args.command == "set-next":
        if not args.window or not args.time:
            print("Error: set-next requires --window and --time.")
            return 1
        return command_set_next(args)
    return command_run(args)


if __name__ == "__main__":
    sys.exit(main())
