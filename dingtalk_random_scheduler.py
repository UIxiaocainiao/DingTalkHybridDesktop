#!/usr/bin/env python3
"""Persistent Android device manager driven by adb.

Features:
1. Launches DingTalk once per day at a random time between 09:05-09:10
2. Launches DingTalk once per day at a random time between 18:05-18:15
3. Waits 5 seconds after each launch and then force-stops DingTalk
4. Watches for device disconnect/reconnect and relaunches scrcpy automatically
"""

from __future__ import annotations

import argparse
import os
import random
import re
import shlex
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, time as dt_time, timedelta
from typing import Iterable
import xml.etree.ElementTree as ET


DEFAULT_PACKAGE = "com.alibaba.android.rimet"
DEFAULT_APP_LABEL = "钉钉"
DEFAULT_DELAY_AFTER_LAUNCH = 5
DEFAULT_POLL_INTERVAL = 5
DEFAULT_SCRCPY_LAUNCH_COOLDOWN = 15
OSASCRIPT_BIN = "/usr/bin/osascript"
ADB_BIN = "adb"
SCRCPY_BIN = "scrcpy"
ADB_CANDIDATES = (
    "adb",
    "/opt/homebrew/bin/adb",
    "/usr/local/bin/adb",
    "/usr/bin/adb",
)
SCRCPY_CANDIDATES = (
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


WINDOWS: tuple[TimeWindow, ...] = (
    TimeWindow("morning", dt_time(9, 5), dt_time(9, 10)),
    TimeWindow("evening", dt_time(18, 5), dt_time(18, 15)),
)


def log(message: str) -> None:
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {message}", flush=True)


def resolve_binary(binary_name: str, configured_path: str | None, candidates: tuple[str, ...]) -> str:
    if configured_path:
        return configured_path

    for candidate in candidates:
        if "/" in candidate:
            resolved = candidate if shutil.which(candidate) else None
        else:
            resolved = shutil.which(candidate)
        if resolved:
            return resolved

    raise RuntimeError(
        f"{binary_name} not found. Install it first or pass the explicit path."
    )


def run_adb(adb_bin: str, serial: str | None, args: Iterable[str]) -> subprocess.CompletedProcess[str]:
    command = [adb_bin]
    if serial:
        command.extend(["-s", serial])
    command.extend(args)
    return subprocess.run(command, capture_output=True, text=True, check=True)


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


def list_visible_recent_tasks(serial: str) -> list[RecentTask]:
    result = run_adb(ADB_BIN, serial, ["shell", "dumpsys", "activity", "recents"])
    tasks: list[RecentTask] = []
    in_visible_section = False
    current_task_id: int | None = None

    for raw_line in result.stdout.splitlines():
        line = raw_line.strip()
        if line.startswith("Visible recent tasks"):
            in_visible_section = True
            current_task_id = None
            continue
        if not in_visible_section:
            continue
        if line.startswith("* RecentTaskInfo #"):
            current_task_id = None
            continue
        if line.startswith("id="):
            try:
                current_task_id = int(line.split("=", 1)[1].split()[0])
            except (ValueError, IndexError):
                current_task_id = None
        if "realActivity={" in line:
            try:
                component = line.split("{", 1)[1].split("}", 1)[0]
                package = component.split("/", 1)[0]
            except (IndexError, ValueError):
                continue
            if package == "com.miui.home":
                current_task_id = None
                continue
            tasks.append(
                RecentTask(
                    task_id=current_task_id or -1,
                    package=package,
                    raw_line=line,
                )
            )
            current_task_id = None

    return tasks


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
        start_new_session=True,
    )
    log(f"Launched scrcpy for device {serial}.")


def random_datetime_for_window(target_day: date, window: TimeWindow) -> datetime:
    start_dt = datetime.combine(target_day, window.start)
    end_dt = datetime.combine(target_day, window.end)
    total_seconds = int((end_dt - start_dt).total_seconds())
    offset = random.randint(0, total_seconds)
    return start_dt + timedelta(seconds=offset)


def next_run_after(now: datetime, window: TimeWindow) -> datetime:
    today_candidate = random_datetime_for_window(now.date(), window)
    if today_candidate > now:
        return today_candidate
    return random_datetime_for_window(now.date() + timedelta(days=1), window)


def compute_next_event(now: datetime) -> tuple[datetime, str]:
    candidates = [(next_run_after(now, window), window.name) for window in WINDOWS]
    return min(candidates, key=lambda item: item[0])


def build_daily_schedule(now: datetime) -> dict[str, datetime]:
    return {window.name: next_run_after(now, window) for window in WINDOWS}


def perform_action(serial: str, package: str, app_label: str, delay_after_launch: int) -> None:
    launch_app(serial, package)
    log(f"Waiting {delay_after_launch} seconds before stopping {package}.")
    time.sleep(delay_after_launch)
    stop_app(serial, package)
    try:
        dismiss_recent_task_card_on_miui(serial, package, app_label)
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        stdout = (exc.stdout or "").strip()
        details = stderr or stdout or str(exc)
        log(f"Recent-task cleanup failed: {details}")
    except Exception as exc:
        log(f"Unexpected error during recent-task cleanup: {exc}")


def process_due_windows(
    serial: str,
    package: str,
    app_label: str,
    delay_after_launch: int,
    next_runs: dict[str, datetime],
) -> None:
    now = datetime.now()
    for window in WINDOWS:
        scheduled_time = next_runs[window.name]
        if now < scheduled_time:
            continue
        log(f"Executing {window.name} action scheduled for {scheduled_time.strftime('%Y-%m-%d %H:%M:%S')}.")
        try:
            perform_action(serial, package, app_label, delay_after_launch)
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or "").strip()
            stdout = (exc.stdout or "").strip()
            details = stderr or stdout or str(exc)
            log(f"adb command failed: {details}")
        except Exception as exc:
            log(f"Unexpected error during scheduled action: {exc}")
        next_runs[window.name] = random_datetime_for_window(scheduled_time.date() + timedelta(days=1), window)
        log(
            f"Rescheduled {window.name} action to {next_runs[window.name].strftime('%Y-%m-%d %H:%M:%S')}."
        )


def is_device_ready(status: DeviceStatus | None) -> bool:
    return bool(status and status.state == "device" and status.usb_connected)


def maybe_launch_scrcpy(
    serial: str,
    status: DeviceStatus | None,
    last_scrcpy_attempt_monotonic: float | None,
    scrcpy_launch_cooldown: int,
) -> float | None:
    if not is_device_ready(status):
        return last_scrcpy_attempt_monotonic

    if is_scrcpy_running_for_serial(serial):
        return last_scrcpy_attempt_monotonic

    now_monotonic = time.monotonic()
    if (
        last_scrcpy_attempt_monotonic is not None
        and now_monotonic - last_scrcpy_attempt_monotonic < scrcpy_launch_cooldown
    ):
        return last_scrcpy_attempt_monotonic

    try:
        launch_scrcpy(serial)
        return now_monotonic
    except Exception as exc:
        log(f"Failed to launch scrcpy: {exc}")
        return now_monotonic


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Persistent DingTalk scheduler and scrcpy reconnect manager for one Android device."
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
        "--disable-scrcpy-watch",
        action="store_true",
        help="Disable automatic scrcpy relaunch when the device reconnects.",
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
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    global ADB_BIN, SCRCPY_BIN

    try:
        ADB_BIN = resolve_binary("adb", args.adb_bin, ADB_CANDIDATES)
        SCRCPY_BIN = resolve_binary("scrcpy", args.scrcpy_bin, SCRCPY_CANDIDATES)
    except Exception as exc:
        log(f"Binary initialization failed: {exc}")
        return 1

    try:
        serial = args.serial or detect_single_device()
    except Exception as exc:
        log(f"Device detection failed: {exc}")
        return 1

    config = Config(
        serial=serial,
        package=args.package,
        app_label=args.app_label,
        delay_after_launch=args.delay_after_launch,
        poll_interval=max(1, args.poll_interval),
        enable_scrcpy_watch=not args.disable_scrcpy_watch,
        scrcpy_launch_cooldown=max(1, args.scrcpy_launch_cooldown),
    )

    next_runs = build_daily_schedule(datetime.now())
    for window in WINDOWS:
        log(f"Next {window.name} run scheduled at {next_runs[window.name].strftime('%Y-%m-%d %H:%M:%S')}.")

    previous_status_summary: str | None = None
    last_scrcpy_attempt_monotonic: float | None = None
    authorization_prompt_shown = False

    log(f"Using adb {ADB_BIN}.")
    log(f"Using scrcpy {SCRCPY_BIN}.")
    log(f"Using device {config.serial}. Package: {config.package}. App label: {config.app_label}")
    log("Schedule windows: 09:05-09:10 and 18:05-18:15.")
    log(
        f"scrcpy reconnect watch: {'enabled' if config.enable_scrcpy_watch else 'disabled'}. "
        f"Poll interval: {config.poll_interval}s."
    )
    log("Press Ctrl+C to stop.")

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
                last_scrcpy_attempt_monotonic = maybe_launch_scrcpy(
                    config.serial,
                    device_status,
                    last_scrcpy_attempt_monotonic,
                    config.scrcpy_launch_cooldown,
                )

            if is_device_ready(device_status):
                process_due_windows(
                    config.serial,
                    config.package,
                    config.app_label,
                    config.delay_after_launch,
                    next_runs,
                )
            time.sleep(config.poll_interval)
    except KeyboardInterrupt:
        log("Scheduler stopped by user.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
