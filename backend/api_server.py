#!/usr/bin/env python3
"""HTTP API for the DingTalk automation console."""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import socket
import subprocess
import sys
import threading
import time
from dataclasses import asdict
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    import dingtalk_random_scheduler as scheduler
except ModuleNotFoundError:  # pragma: no cover - import path depends on entrypoint style
    from backend import dingtalk_random_scheduler as scheduler


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
SCRIPT_PATH = BASE_DIR / "dingtalk_random_scheduler.py"
INSTALL_PLATFORM_TOOLS_SCRIPT_ENV = "DINGTALK_INSTALL_PLATFORM_TOOLS_SCRIPT"
CONFIG_FILE = Path(os.environ.get("DINGTALK_CONSOLE_CONFIG_FILE", scheduler.DEFAULT_CONFIG_FILE))
PROCESS_FILE = Path(
    os.environ.get(
        "DINGTALK_CONSOLE_PROCESS_FILE",
        str(BASE_DIR / "logs/dingtalk-random-scheduler.process.json"),
    )
)
LOG_FILE = Path(
    os.environ.get(
        "DINGTALK_CONSOLE_LOG_FILE",
        str(BASE_DIR / "logs/dingtalk-random-scheduler.log"),
    )
)
ERR_LOG_FILE = Path(
    os.environ.get(
        "DINGTALK_CONSOLE_ERR_LOG_FILE",
        str(BASE_DIR / "logs/dingtalk-random-scheduler.err.log"),
    )
)
CHECKIN_RECORDS_FILE = Path(
    os.environ.get(
        "DINGTALK_CONSOLE_CHECKIN_RECORDS_FILE",
        str(BASE_DIR / "logs/dingtalk-checkin-records.json"),
    )
)
REMOTE_ADB_STATUS_FILE = Path(
    os.environ.get(
        "DINGTALK_REMOTE_ADB_STATUS_FILE",
        str(BASE_DIR / "runtime/remote-adb-status.json"),
    )
)
WINDOW_LABELS = {
    "morning": "上午窗口",
    "evening": "下午窗口",
}
CHECKIN_TYPE_LABELS = {
    "morning": "上午打卡",
    "evening": "下午打卡",
}
DEFAULT_STATE_FILE = os.environ.get("DINGTALK_CONSOLE_DEFAULT_STATE_FILE", scheduler.DEFAULT_STATE_FILE)


def read_env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() not in {"0", "false", "off", "no"}


def read_env_int(name: str, default: int, minimum: int = 0) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return max(minimum, default)
    try:
        value = int(str(raw).strip())
    except Exception:
        return max(minimum, default)
    return max(minimum, value)


AUTO_REMOTE_ADB_CONNECT_DEFAULT = read_env_bool("DINGTALK_AUTO_REMOTE_ADB_CONNECT", True)
AUTO_REMOTE_ADB_CONNECT_COOLDOWN_SECONDS = read_env_int(
    "DINGTALK_AUTO_REMOTE_ADB_CONNECT_COOLDOWN_SECONDS",
    30,
    minimum=5,
)
API_LOCK = threading.Lock()


class ApiError(RuntimeError):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def parse_required_int_from_payload(
    payload: dict[str, Any],
    field_name: str,
    *,
    missing_message: str,
    invalid_message: str,
) -> int:
    raw_value = payload.get(field_name)
    if raw_value is None or (isinstance(raw_value, str) and not raw_value.strip()):
        raise ApiError(400, missing_message)
    try:
        return int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ApiError(400, invalid_message) from exc


def resolve_install_platform_tools_script() -> Path:
    env_script = str(os.environ.get(INSTALL_PLATFORM_TOOLS_SCRIPT_ENV, "")).strip()
    candidates = []
    if env_script:
        candidates.append(Path(env_script).expanduser())
    candidates.extend(
        [
            BASE_DIR / "install_platform_tools.py",
            PROJECT_DIR / "scripts/install_platform_tools.py",
            Path.cwd() / "scripts/install_platform_tools.py",
        ]
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate

    checked_paths = "\n".join(f"- {path}" for path in candidates)
    raise ApiError(
        500,
        "安装脚本不存在，请确认部署中包含 install_platform_tools.py。\n"
        f"已检查路径：\n{checked_paths}",
    )


def format_beijing_datetime_label(value: datetime | None) -> str:
    if not value:
        return ""
    return f"{scheduler.format_timestamp(value)} 北京时间"


def format_beijing_date_label(value: date | None) -> str:
    if not value:
        return ""
    return f"{value.isoformat()} 北京时间"


def default_console_config() -> dict[str, Any]:
    return {
        "serial": "",
        "remote_adb_target": "",
        "remote_adb_target_name": "",
        "recent_remote_adb_targets": [],
        "package": scheduler.DEFAULT_PACKAGE,
        "app_label": scheduler.DEFAULT_APP_LABEL,
        "delay_after_launch": scheduler.DEFAULT_DELAY_AFTER_LAUNCH,
        "poll_interval": scheduler.DEFAULT_POLL_INTERVAL,
        "scrcpy_launch_cooldown": scheduler.DEFAULT_SCRCPY_LAUNCH_COOLDOWN,
        "workday_api_url": scheduler.DEFAULT_WORKDAY_API_URL,
        "workday_api_timeout_ms": int(scheduler.DEFAULT_WORKDAY_API_TIMEOUT * 1000),
        "enable_scrcpy_watch": False,
        "notify_on_success": False,
        "enable_workday_check": True,
        "enable_auto_remote_adb_connect": AUTO_REMOTE_ADB_CONNECT_DEFAULT,
        "adb_bin": "",
        "scrcpy_bin": "",
        "state_file": DEFAULT_STATE_FILE,
        "windows": {
            window.name: {
                "start": window.start.strftime("%H:%M"),
                "end": window.end.strftime("%H:%M"),
            }
            for window in scheduler.WINDOWS
        },
    }


def normalize_recent_remote_adb_targets(raw_value: Any) -> list[dict[str, str]]:
    if not isinstance(raw_value, list):
        return []

    normalized: list[dict[str, str]] = []
    seen_targets: set[str] = set()
    for item in raw_value:
        if isinstance(item, dict):
            target = str(item.get("target") or "").strip()
            name = str(item.get("name") or "").strip()
        else:
            target = str(item or "").strip()
            name = ""
        if not target or target in seen_targets:
            continue
        normalized.append({"name": name, "target": target})
        seen_targets.add(target)
    return normalized[:8]


def normalize_console_config(payload: Any) -> dict[str, Any]:
    defaults = default_console_config()
    if not isinstance(payload, dict):
        return defaults

    normalized = default_console_config()

    for key in (
        "serial",
        "remote_adb_target",
        "remote_adb_target_name",
        "package",
        "app_label",
        "state_file",
        "workday_api_url",
        "adb_bin",
        "scrcpy_bin",
    ):
        if key in payload and payload[key] is not None:
            normalized[key] = str(payload[key]).strip()

    raw_recent_targets = payload.get("recent_remote_adb_targets")
    normalized["recent_remote_adb_targets"] = normalize_recent_remote_adb_targets(raw_recent_targets)

    for key, minimum in (
        ("delay_after_launch", 1),
        ("poll_interval", 1),
        ("scrcpy_launch_cooldown", 1),
        ("workday_api_timeout_ms", 1000),
    ):
        if key in payload and payload[key] is not None:
            normalized[key] = max(minimum, int(payload[key]))

    for key in (
        "enable_scrcpy_watch",
        "notify_on_success",
        "enable_workday_check",
        "enable_auto_remote_adb_connect",
    ):
        if key in payload:
            normalized[key] = bool(payload[key])

    raw_windows = payload.get("windows")
    if isinstance(raw_windows, dict):
        for window_name in WINDOW_LABELS:
            raw_window = raw_windows.get(window_name)
            if not isinstance(raw_window, dict):
                continue
            start = str(raw_window.get("start", normalized["windows"][window_name]["start"])).strip()
            end = str(raw_window.get("end", normalized["windows"][window_name]["end"])).strip()
            normalized["windows"][window_name] = {"start": start, "end": end}

    if not normalized["package"]:
        normalized["package"] = defaults["package"]
    if not normalized["app_label"]:
        normalized["app_label"] = defaults["app_label"]
    if not normalized["state_file"]:
        normalized["state_file"] = defaults["state_file"]
    if not normalized["workday_api_url"]:
        normalized["workday_api_url"] = defaults["workday_api_url"]

    scheduler.parse_window_overrides(normalized["windows"])
    return normalized


def load_console_config() -> dict[str, Any]:
    if not CONFIG_FILE.exists():
        return default_console_config()

    try:
        payload = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:
        return default_console_config()

    try:
        return normalize_console_config(payload)
    except Exception:
        return default_console_config()


def remember_remote_adb_target(target: str, name: str = "") -> None:
    normalized_target = str(target or "").strip()
    normalized_name = str(name or "").strip()
    if not normalized_target:
        return
    config = load_console_config()
    recent_targets = [
        item
        for item in config.get("recent_remote_adb_targets", [])
        if str(item.get("target") or "").strip() != normalized_target
    ]
    config["remote_adb_target"] = normalized_target
    if normalized_name:
        config["remote_adb_target_name"] = normalized_name
    config["recent_remote_adb_targets"] = [{"name": normalized_name, "target": normalized_target}, *recent_targets][:8]
    save_console_config(config)


def delete_remote_adb_target(target: str) -> dict[str, Any]:
    normalized_target = str(target or "").strip()
    if not normalized_target:
        raise ApiError(400, "target 不能为空。")

    config = load_console_config()
    existing_targets = list(config.get("recent_remote_adb_targets", []))
    config["recent_remote_adb_targets"] = [
        item for item in existing_targets if str(item.get("target") or "").strip() != normalized_target
    ]
    if config.get("remote_adb_target") == normalized_target:
        config["remote_adb_target"] = ""
        config["remote_adb_target_name"] = ""
    save_console_config(config)

    return {
        "message": "远程目标已删除",
        "detail": f"{normalized_target} 已从最近使用列表移除。",
    }


def save_console_config(config: dict[str, Any]) -> None:
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(
        json.dumps(normalize_console_config(config), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def apply_console_windows(config: dict[str, Any]) -> tuple[scheduler.TimeWindow, ...]:
    windows = scheduler.parse_window_overrides(config["windows"])
    scheduler.WINDOWS = windows
    return windows


def build_namespace(config: dict[str, Any], command: str = "status", **overrides: Any) -> argparse.Namespace:
    namespace = argparse.Namespace(
        command=command,
        window=None,
        time=None,
        serial=config["serial"] or None,
        remote_adb_target=config["remote_adb_target"] or None,
        package=config["package"],
        app_label=config["app_label"],
        delay_after_launch=int(config["delay_after_launch"]),
        adb_bin=config["adb_bin"] or None,
        scrcpy_bin=config["scrcpy_bin"] or None,
        enable_scrcpy_watch=bool(config["enable_scrcpy_watch"]),
        poll_interval=int(config["poll_interval"]),
        scrcpy_launch_cooldown=int(config["scrcpy_launch_cooldown"]),
        state_file=config["state_file"],
        config_file=str(CONFIG_FILE),
        disable_workday_check=not bool(config["enable_workday_check"]),
        workday_api_url=config["workday_api_url"],
        workday_api_timeout=float(config["workday_api_timeout_ms"]) / 1000.0,
        notify_on_success=bool(config["notify_on_success"]),
    )
    for key, value in overrides.items():
        setattr(namespace, key, value)
    return namespace


def build_runtime_config(config: dict[str, Any], serial: str) -> scheduler.Config:
    args = build_namespace(config, command="run", serial=serial)
    return scheduler.build_config(args, serial)


def load_scheduler_state(config: dict[str, Any]) -> scheduler.SchedulerState:
    state_file = Path(config["state_file"]).expanduser()
    return scheduler.load_scheduler_state(state_file, scheduler.now_beijing())


def save_scheduler_state(config: dict[str, Any], state: scheduler.SchedulerState) -> None:
    state_file = Path(config["state_file"]).expanduser()
    scheduler.save_scheduler_state(state_file, state)


def read_process_record() -> dict[str, Any]:
    if not PROCESS_FILE.exists():
        return {}
    try:
        payload = json.loads(PROCESS_FILE.read_text(encoding="utf-8"))
    except Exception:
        PROCESS_FILE.unlink(missing_ok=True)
        return {}
    return payload if isinstance(payload, dict) else {}


def read_remote_adb_status() -> dict[str, Any]:
    if not REMOTE_ADB_STATUS_FILE.exists():
        return {}
    try:
        payload = json.loads(REMOTE_ADB_STATUS_FILE.read_text(encoding="utf-8"))
    except Exception:
        REMOTE_ADB_STATUS_FILE.unlink(missing_ok=True)
        return {}
    return payload if isinstance(payload, dict) else {}


def save_remote_adb_status(payload: dict[str, Any]) -> None:
    REMOTE_ADB_STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    REMOTE_ADB_STATUS_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def record_remote_adb_status(target: str, action: str, ok: bool, detail: str) -> None:
    now = scheduler.now_beijing()
    save_remote_adb_status(
        {
            "target": target,
            "action": action,
            "ok": bool(ok),
            "detail": detail,
            "checkedAt": now.isoformat(),
            "checkedAtLabel": format_beijing_datetime_label(now),
        }
    )


def serialize_remote_adb_status() -> dict[str, Any]:
    status = read_remote_adb_status()
    return {
        "target": str(status.get("target") or ""),
        "action": str(status.get("action") or ""),
        "ok": bool(status.get("ok")) if "ok" in status else None,
        "detail": str(status.get("detail") or ""),
        "checkedAt": str(status.get("checkedAt") or ""),
        "checkedAtLabel": str(status.get("checkedAtLabel") or ""),
    }


def parse_iso_datetime(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except Exception:
        return None


def should_throttle_auto_remote_adb_connect(target: str) -> tuple[bool, str]:
    status = read_remote_adb_status()
    if str(status.get("target") or "").strip() != target:
        return False, ""
    if str(status.get("action") or "").strip() != "connect":
        return False, ""

    checked_at = parse_iso_datetime(status.get("checkedAt"))
    if not checked_at:
        return False, ""

    elapsed = (scheduler.now_beijing() - checked_at).total_seconds()
    if elapsed >= AUTO_REMOTE_ADB_CONNECT_COOLDOWN_SECONDS:
        return False, ""

    remaining_seconds = int(max(1, AUTO_REMOTE_ADB_CONNECT_COOLDOWN_SECONDS - elapsed))
    return True, f"远程 ADB 最近刚尝试连接，{remaining_seconds} 秒后将自动重试。"


def save_process_record(payload: dict[str, Any]) -> None:
    PROCESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROCESS_FILE.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def read_checkin_records() -> list[dict[str, str]]:
    """Read check-in records from the records file."""
    if not CHECKIN_RECORDS_FILE.exists():
        return []
    try:
        payload = json.loads(CHECKIN_RECORDS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []
    records = payload.get("records", [])
    if not isinstance(records, list):
        return []

    normalized_records: list[dict[str, str]] = []
    for item in records:
        if not isinstance(item, dict):
            continue
        normalized_records.append(
            {
                "date": str(item.get("date", "")).strip(),
                "time": str(item.get("time", "")).strip(),
                "type": normalize_checkin_type(item.get("type", "")),
                "status": str(item.get("status", "")).strip(),
                "remark": str(item.get("remark", "")).strip(),
            }
        )
    return normalized_records


def normalize_checkin_type(raw_value: Any) -> str:
    raw = str(raw_value or "").strip()
    if not raw:
        return "手动记录"

    aliases = {
        "morning": "上午打卡",
        "上午窗口": "上午打卡",
        "上午打卡": "上午打卡",
        "evening": "下午打卡",
        "下午窗口": "下午打卡",
        "下午打卡": "下午打卡",
    }
    lowered = raw.lower()
    return aliases.get(lowered, aliases.get(raw, raw))


def save_checkin_record(record: dict[str, str]) -> None:
    """Append a new check-in record to the records file."""
    CHECKIN_RECORDS_FILE.parent.mkdir(parents=True, exist_ok=True)

    records = read_checkin_records()
    records.insert(0, record)  # 新记录插到前面

    # 保留最近 500 条记录
    records = records[:500]

    CHECKIN_RECORDS_FILE.write_text(
        json.dumps({"records": records}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def add_checkin_record(window_name: str, status: str, remark: str = "") -> None:
    """Add a check-in record with current timestamp."""
    now = scheduler.now_beijing()
    record = {
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H:%M:%S"),
        "type": normalize_checkin_type(CHECKIN_TYPE_LABELS.get(window_name, window_name)),
        "status": status,
        "remark": remark,
    }
    save_checkin_record(record)


def is_pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        reaped_pid, _ = os.waitpid(pid, os.WNOHANG)
        if reaped_pid == pid:
            return False
    except ChildProcessError:
        pass
    except OSError:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def get_scheduler_process_state() -> dict[str, Any]:
    record = read_process_record()
    pid = int(record.get("pid") or 0)
    if pid and is_pid_alive(pid):
        mode = str(record.get("mode") or "run")
        started_at = str(record.get("started_at") or "")
        return {
            "running": True,
            "pid": pid,
            "mode": mode,
            "startedAt": started_at,
            "startedAtLabel": format_beijing_datetime_label(datetime.fromisoformat(started_at)) if started_at else "",
            "label": "调试中" if mode == "debug" else "运行中",
            "detail": f"受控进程 PID {pid}，模式 {mode}。",
        }

    PROCESS_FILE.unlink(missing_ok=True)
    return {
        "running": False,
        "pid": None,
        "mode": None,
        "startedAt": "",
        "startedAtLabel": "",
        "label": "未启动",
        "detail": "当前没有受控制台托管的调度进程。",
    }


def serialize_workday_result(result: scheduler.WorkdayCheckResult | None, error: str | None) -> dict[str, Any]:
    if not result:
        return {
            "enabled": False,
            "checkedDate": "",
            "checkedDateLabel": "",
            "isWorkday": None,
            "note": "",
            "source": "",
            "checkedAt": "",
            "checkedAtLabel": "",
            "error": error or "",
        }
    return {
        "enabled": True,
        "checkedDate": result.checked_date.isoformat(),
        "checkedDateLabel": format_beijing_date_label(result.checked_date),
        "isWorkday": result.is_workday,
        "note": result.note,
        "source": result.source,
        "checkedAt": result.checked_at.isoformat(),
        "checkedAtLabel": format_beijing_datetime_label(result.checked_at),
        "error": error or "",
    }


def resolve_workday_snapshot(
    config: dict[str, Any],
    state: scheduler.SchedulerState,
) -> tuple[scheduler.WorkdayCheckResult | None, str | None]:
    if not config["enable_workday_check"]:
        return None, None

    today = scheduler.today_beijing()
    if state.last_workday_check and state.last_workday_check.checked_date == today:
        return state.last_workday_check, None

    try:
        result = scheduler.fetch_workday_status(
            today,
            config["workday_api_url"],
            float(config["workday_api_timeout_ms"]) / 1000.0,
        )
    except Exception as exc:
        return state.last_workday_check, str(exc)

    state.last_workday_check = result
    save_scheduler_state(config, state)
    return result, None


def resolve_device_snapshot(config: dict[str, Any], allow_auto_remote_connect: bool = True) -> dict[str, Any]:
    args = build_namespace(config, command="status")
    adb_bin, scrcpy_bin, warnings = scheduler.resolve_binaries_for_inspection(args)
    if adb_bin:
        scheduler.ADB_BIN = adb_bin
    if scrcpy_bin:
        scheduler.SCRCPY_BIN = scrcpy_bin

    selected_serial = config["serial"] or ""
    status: scheduler.DeviceStatus | None = None
    error = ""
    statuses: list[scheduler.DeviceStatus] = []
    auto_connect_note = ""
    remote_target = str(config.get("remote_adb_target") or "").strip()
    remote_target_name = str(config.get("remote_adb_target_name") or "").strip()
    auto_remote_adb_enabled = bool(
        config.get("enable_auto_remote_adb_connect", AUTO_REMOTE_ADB_CONNECT_DEFAULT)
    )

    if adb_bin:
        try:
            statuses = scheduler.list_device_statuses()
        except subprocess.CalledProcessError as exc:
            error = summarize_adb_connection_error(scheduler.describe_process_error(exc))
        except Exception as exc:
            error = summarize_adb_connection_error(str(exc))
    else:
        error = (
            "设备连接器缺少 adb：请在网页端点击“在线安装 ADB”，安装会在当前云服务器执行；"
            "也可以在前台配置 adb_bin 为 platform-tools/adb 的绝对路径。"
        )

    if (
        adb_bin
        and not error
        and allow_auto_remote_connect
        and auto_remote_adb_enabled
        and remote_target
        and not any(item.state == "device" for item in statuses)
    ):
        throttled, throttle_note = should_throttle_auto_remote_adb_connect(remote_target)
        if throttled:
            auto_connect_note = throttle_note
        else:
            try:
                output = connect_remote_adb_for_dashboard(adb_bin, remote_target)
                detail = output
                remember_remote_adb_target(remote_target, remote_target_name)
                record_remote_adb_status(remote_target, "connect", True, detail)
                auto_connect_note = (
                    f"{remote_target_name + ' / ' if remote_target_name else ''}{remote_target} 已自动连通。"
                )
                try:
                    statuses = scheduler.list_device_statuses()
                except subprocess.CalledProcessError as exc:
                    error = summarize_adb_connection_error(scheduler.describe_process_error(exc))
                except Exception as exc:
                    error = summarize_adb_connection_error(str(exc))
            except Exception as exc:
                detail = summarize_remote_adb_error(str(exc), remote_target)
                remember_remote_adb_target(remote_target, remote_target_name)
                record_remote_adb_status(remote_target, "connect", False, detail)
                auto_connect_note = f"自动连接失败：{detail}"

    if adb_bin and not error:
        if selected_serial:
            status = next((item for item in statuses if item.serial == selected_serial), None)
            if status is None and statuses:
                error = f"设备 {selected_serial} 未出现在 adb 列表中，请确认 USB 连接或更新 serial。"
        else:
            online = [item for item in statuses if item.state == "device"]
            if len(online) == 1:
                status = online[0]
                selected_serial = online[0].serial
            elif len(online) > 1:
                error = f"检测到 {len(online)} 台设备，请在前台配置 serial 绑定目标设备。"
            elif len(statuses) == 1:
                status = statuses[0]
                selected_serial = statuses[0].serial
            elif not statuses:
                if remote_target and auto_connect_note:
                    error = f"未发现在线设备：{auto_connect_note}"
                elif remote_target:
                    named_target = f"{remote_target_name} / {remote_target}" if remote_target_name else remote_target
                    error = (
                        f"未发现在线设备：已配置远程目标 {named_target}，"
                        "可点击“连接远程 ADB”或稍后等待自动重试。"
                    )
                else:
                    error = "未发现在线设备：请确认 USB 已连接、已开启 USB 调试，并重新刷新设备状态。"

    scrcpy_running = False
    if scrcpy_bin and selected_serial:
        try:
            scrcpy_running = scheduler.is_scrcpy_running_for_serial(selected_serial)
        except Exception:
            scrcpy_running = False

    processed_warnings: list[str] = []
    for warning in warnings:
        lowered = warning.lower()
        if lowered.startswith("adb unavailable:"):
            processed_warnings.append(summarize_adb_connection_error(warning))
        elif lowered.startswith("scrcpy unavailable:"):
            processed_warnings.append(summarize_scrcpy_connection_error(warning))
        else:
            processed_warnings.append(warning)
    if auto_connect_note and auto_connect_note not in processed_warnings and auto_connect_note not in error:
        processed_warnings.append(auto_connect_note)

    device_count = len(statuses)
    online_count = len([item for item in statuses if item.state == "device"])
    unauthorized_count = len([item for item in statuses if item.state == "unauthorized"])
    offline_count = len([item for item in statuses if item.state == "offline"])
    device_list = [
        {"serial": item.serial, "state": item.state, "usbConnected": item.usb_connected}
        for item in statuses
    ]
    remote_connected = bool(
        remote_target and any(item.serial == remote_target and item.state == "device" for item in statuses)
    )

    return {
        "serial": selected_serial,
        "remoteAdbTarget": remote_target,
        "remoteAdbTargetName": remote_target_name,
        "remoteAdbConnected": remote_connected,
        "autoRemoteAdbConnectEnabled": auto_remote_adb_enabled,
        "autoRemoteAdbConnectNote": auto_connect_note,
        "summary": scheduler.status_summary(status) if status else "unavailable",
        "ready": scheduler.is_device_ready(status),
        "authorized": bool(status and status.state == "device"),
        "usbConnected": bool(status and status.usb_connected),
        "rawLine": status.raw_line if status else "",
        "warningMessages": processed_warnings,
        "error": error,
        "adbAvailable": bool(adb_bin),
        "adbBin": adb_bin or "",
        "adbSource": scheduler.describe_binary_source(adb_bin, config["adb_bin"] or None),
        "adbInstallHint": "在网页端点击“在线安装 ADB”",
        "deviceCount": device_count,
        "onlineCount": online_count,
        "unauthorizedCount": unauthorized_count,
        "offlineCount": offline_count,
        "devices": device_list,
        "scrcpyAvailable": bool(scrcpy_bin),
        "scrcpyBin": scrcpy_bin or "",
        "scrcpySource": scheduler.describe_binary_source(scrcpy_bin, config["scrcpy_bin"] or None),
        "scrcpyRunning": scrcpy_running,
    }


def summarize_adb_connection_error(message: str) -> str:
    normalized = " ".join(message.strip().split())
    lowered = normalized.lower()

    if "not found" in lowered or "not executable" in lowered:
        return (
            "ADB 未安装或路径不可执行：请在网页端点击“在线安装 ADB”，"
            "或在前台配置 adb_bin。"
        )
    if "could not install *smartsocket* listener" in lowered or "cannot connect to daemon" in lowered:
        return (
            "ADB 服务启动失败：请确认当前是在本机设备连接器环境运行、5037 端口未被异常占用，"
            "并允许 adb 启动本地 daemon。"
        )
    if "unauthorized" in lowered:
        return "设备已连接但未授权：请在手机上确认 USB 调试授权。"
    if "no devices" in lowered:
        return "未发现在线设备：请确认 USB 已连接、已开启 USB 调试，并重新刷新设备状态。"
    if "offline" in lowered:
        return "设备处于 offline：请重新插拔 USB，或在手机上重新授权 USB 调试。"

    return normalized[:500] if normalized else "ADB 连接异常"


def summarize_scrcpy_connection_error(message: str) -> str:
    normalized = " ".join(message.strip().split())
    lowered = normalized.lower()
    if "not found" in lowered or "not executable" in lowered:
        return "scrcpy 未安装或路径不可执行：请安装 scrcpy 或在前台配置 scrcpy_bin。"
    return normalized[:500] if normalized else "scrcpy 不可用"


def summarize_remote_adb_error(message: str, target: str) -> str:
    normalized = " ".join(message.strip().split())
    lowered = normalized.lower()
    if not normalized:
        return "远程 ADB 连接失败。"
    if "target is empty" in lowered:
        return "远程 ADB 目标为空：请先保存 remote_adb_target，例如 192.168.1.8:5555。"
    if "format invalid" in lowered:
        return "远程 ADB 目标格式错误：请使用 host:port，端口范围 1-65535。"
    if "tcp probe failed" in lowered:
        return (
            f"远程 ADB 网络探测失败：当前服务器无法连到 {target}。"
            "公网环境请确认设备侧端口映射、云服务器安全组/防火墙放行，以及目标地址可达。"
        )
    if "connection refused" in lowered or "actively refused" in lowered:
        return (
            f"远程 ADB 被拒绝：{target} 端口未监听或目标未开启无线调试/ADB TCP。"
            "公网环境请确认端口映射已生效。"
        )
    if "timed out" in lowered or "timeout" in lowered:
        return f"远程 ADB 超时：无法在时限内连到 {target}，请检查公网网络路径与端口策略。"
    if "no route to host" in lowered or "network is unreachable" in lowered:
        return f"远程 ADB 不可达：当前服务器无法访问 {target}。"
    if "unknown host" in lowered or "name or service not known" in lowered:
        return f"远程 ADB 目标无效：无法解析 {target}。"
    if "unauthorized" in lowered:
        return "远程 ADB 已连通但设备未授权：请在手机上确认无线调试授权弹窗。"
    if "offline" in lowered:
        return f"远程 ADB 已连接但设备处于 offline：建议重新连接 {target} 并刷新状态。"
    if "unable to connect" in lowered or "failed to connect" in lowered:
        return f"远程 ADB 连接失败：请检查 {target} 是否可达，且目标设备已开启无线调试/ADB TCP。"
    return normalized[:500]


def derive_last_success(state: scheduler.SchedulerState) -> dict[str, str]:
    latest_window = ""
    latest_date: date | None = None
    for window in scheduler.WINDOWS:
        completed = state.last_completed_dates.get(window.name)
        if completed and (latest_date is None or completed > latest_date):
            latest_date = completed
            latest_window = window.name

    if not latest_date:
        return {"window": "", "date": "", "dateLabel": "", "label": "暂无执行记录"}

    window_label = WINDOW_LABELS.get(latest_window, latest_window)
    return {
        "window": latest_window,
        "date": latest_date.isoformat(),
        "dateLabel": format_beijing_date_label(latest_date),
        "label": f"{latest_date.isoformat()} {window_label} 北京时间",
    }


def build_window_items(config: dict[str, Any], state: scheduler.SchedulerState) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for window in scheduler.WINDOWS:
        next_run = state.next_runs.get(window.name)
        last_completed = state.last_completed_dates.get(window.name)
        raw_window = config["windows"][window.name]
        items.append(
            {
                "name": window.name,
                "title": WINDOW_LABELS.get(window.name, window.name),
                "start": raw_window["start"],
                "end": raw_window["end"],
                "selected": next_run.strftime("%H:%M:%S") if next_run else "--:--:--",
                "selectedAt": scheduler.format_timestamp(next_run) if next_run else "未排期",
                "selectedAtLabel": format_beijing_datetime_label(next_run) if next_run else "未排期",
                "completed": last_completed.isoformat() if last_completed else "未执行",
                "completedLabel": format_beijing_date_label(last_completed) if last_completed else "未执行",
            }
        )
    return items


def classify_log_status(message: str, source: str) -> str:
    lowered = message.lower()
    if source == "error" or " fail" in lowered or "failed" in lowered or "error" in lowered:
        return "异常"
    if "warning" in lowered or "warn" in lowered or "unauthorized" in lowered or "skip" in lowered:
        return "提醒"
    if "completed" in lowered or "ok" in lowered or "success" in lowered or "finished" in lowered:
        return "成功"
    return "信息"


def summarize_log_title(message: str, source: str) -> str:
    mappings = (
        ("Executing morning action", "上午自动打卡开始执行"),
        ("Executing evening action", "下午自动打卡开始执行"),
        ("action completed", "自动打卡执行完成"),
        ("doctor finished with no blocking issues", "环境自检通过"),
        ("Workday check for", "工作日接口检查"),
        ("Device detection failed", "设备检测失败"),
        ("Scheduler stopped by user", "调度任务已停止"),
        ("Press Ctrl+C to stop", "调度任务已启动"),
    )
    for token, title in mappings:
        if token in message:
            return title
    if source == "error":
        return "后端错误日志"
    return message[:28] + ("..." if len(message) > 28 else "")


def parse_log_timestamp(raw_line: str) -> tuple[datetime | None, str]:
    match = re.match(r"^\[(?P<timestamp>[\d-]+\s[\d:]+)\]\s*(?P<message>.*)$", raw_line)
    if not match:
        return None, raw_line.strip()

    try:
        timestamp = datetime.strptime(match.group("timestamp"), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        timestamp = None
    return timestamp, match.group("message").strip()


def read_recent_logs(limit: int = 8) -> list[dict[str, str]]:
    entries: list[dict[str, Any]] = []
    for path, source in ((ERR_LOG_FILE, "error"), (LOG_FILE, "info")):
        if not path.exists():
            continue
        for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines()[-400:]:
            line = raw_line.strip()
            if not line:
                continue
            timestamp, message = parse_log_timestamp(line)
            entries.append(
                {
                    "timestamp": timestamp,
                    "message": message,
                    "source": source,
                }
            )

    entries.sort(key=lambda item: item["timestamp"] or datetime.min, reverse=True)

    logs: list[dict[str, str]] = []
    for entry in entries[:limit]:
        timestamp = entry["timestamp"]
        message = entry["message"]
        source = entry["source"]
        logs.append(
            {
                "time": timestamp.strftime("%m-%d %H:%M") if timestamp else ("错误日志" if source == "error" else "运行日志"),
                "timeLabel": f"{timestamp.strftime('%m-%d %H:%M')} 北京时间" if timestamp else ("错误日志" if source == "error" else "运行日志"),
                "title": summarize_log_title(message, source),
                "detail": message,
                "status": classify_log_status(message, source),
            }
        )

    if logs:
        return logs

    return [
        {
            "time": "暂无",
            "timeLabel": "暂无",
            "title": "还没有后端日志",
            "detail": "启动调度器、自检或试运行后，这里会展示真实的后端日志。",
            "status": "信息",
        }
    ]


def build_timeline(logs: list[dict[str, str]], windows: list[dict[str, str]], workday: dict[str, Any]) -> list[str]:
    items: list[str] = []
    for entry in reversed(logs[:4]):
        items.append(f"{entry.get('timeLabel') or entry['time']} {entry['title']}")

    if workday.get("enabled") and workday.get("checkedDate") and workday.get("note"):
        items.append(f"{workday['checkedDateLabel'] or workday['checkedDate']} 工作日校验 {workday['note']}")

    for window in windows:
        items.append(f"{window['title']} 下一次计划 {window['selectedAtLabel']}")

    deduped: list[str] = []
    seen: set[str] = set()
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        deduped.append(item)
    return deduped[:6]


def build_status_tags(
    process_state: dict[str, Any],
    device: dict[str, Any],
    workday: dict[str, Any],
) -> list[str]:
    tags = [f"任务 {process_state['label']}"]
    if device["serial"]:
        tags.append(f"设备 {device['serial']}")
    elif device.get("deviceCount", 0) > 1:
        tags.append("多设备未绑定")
    if device.get("remoteAdbTarget"):
        tags.append("远程 ADB 已连接" if device.get("remoteAdbConnected") else "远程 ADB 未连接")
    if not device.get("adbAvailable"):
        tags.append("ADB 未安装")
    else:
        tags.append("ADB 已授权" if device["ready"] else "ADB 待处理")
    if device.get("unauthorizedCount"):
        tags.append("设备未授权")
    if workday.get("enabled") and workday.get("isWorkday") is not None:
        tags.append("今天是工作日" if workday["isWorkday"] else "今天非工作日")
    if device["scrcpyRunning"]:
        tags.append("scrcpy 运行中")
    return tags


def build_alerts(
    process_state: dict[str, Any],
    device: dict[str, Any],
    workday: dict[str, Any],
) -> list[dict[str, str]]:
    alerts: list[dict[str, str]] = []

    if not process_state["running"]:
        alerts.append(
            {
                "title": "调度器未启动",
                "detail": "当前前端控制台还没有托管运行中的调度进程，需要先点击“启动任务”或“调试模式”。",
            }
        )
    if device["error"]:
        alerts.append(
            {
                "title": "设备连接器异常" if not device.get("adbAvailable") else "设备状态异常",
                "detail": device["error"],
            }
        )
    elif not device["ready"]:
        alerts.append(
            {
                "title": "设备尚未就绪",
                "detail": "请确认 USB 已连接、ADB 已授权，并在需要时刷新设备状态。",
            }
        )
    if workday.get("error"):
        alerts.append(
            {
                "title": "工作日接口不可用",
                "detail": workday["error"],
            }
        )

    if alerts:
        return alerts[:3]

    return [
        {
            "title": "当前没有阻断性告警",
            "detail": "建议优先执行一次自检，再根据排期决定是否启动调度。",
        }
    ]


def build_dashboard(allow_auto_remote_connect: bool = True) -> dict[str, Any]:
    config = load_console_config()
    apply_console_windows(config)
    state = load_scheduler_state(config)
    process_state = get_scheduler_process_state()
    workday_result, workday_error = resolve_workday_snapshot(config, state)
    device = resolve_device_snapshot(config, allow_auto_remote_connect=allow_auto_remote_connect)
    windows = build_window_items(config, state)
    logs = read_recent_logs()
    workday = serialize_workday_result(workday_result, workday_error)
    remote_adb = serialize_remote_adb_status()

    return {
        "generatedAt": scheduler.now_beijing().isoformat(),
        "generatedAtLabel": format_beijing_datetime_label(scheduler.now_beijing()),
        "config": config,
        "scheduler": process_state,
        "device": device,
        "remoteAdb": remote_adb,
        "workday": workday,
        "windows": windows,
        "lastSuccess": derive_last_success(state),
        "scheduleSummary": " / ".join(window["selected"] for window in windows),
        "toggles": [
            f"scrcpy 观察模式 {'已开启' if config['enable_scrcpy_watch'] else '已关闭'}",
            f"成功通知 {'已开启' if config['notify_on_success'] else '已关闭'}",
            f"工作日校验 {'已开启' if config['enable_workday_check'] else '已关闭'}",
            f"远程 ADB 自动连接 {'已开启' if config['enable_auto_remote_adb_connect'] else '已关闭'}",
        ],
        "statusTags": build_status_tags(process_state, device, workday),
        "alerts": build_alerts(process_state, device, workday),
        "logs": logs,
        "timeline": build_timeline(logs, windows, workday),
    }


def run_cli_command(command: str) -> dict[str, Any]:
    result = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), command, "--config-file", str(CONFIG_FILE)],
        cwd=str(PROJECT_DIR),
        capture_output=True,
        text=True,
        check=False,
    )
    output = (result.stdout or "").strip()
    error_output = (result.stderr or "").strip()
    message = output or error_output or f"{command} exited with code {result.returncode}"
    return {
        "ok": result.returncode == 0,
        "exitCode": result.returncode,
        "output": message,
    }


def start_scheduler_process(mode: str) -> dict[str, Any]:
    if mode not in {"run", "debug"}:
        raise ApiError(400, "mode 只支持 run 或 debug。")

    current_state = get_scheduler_process_state()
    if current_state["running"]:
        raise ApiError(409, f"调度器已经在运行中，PID {current_state['pid']}。")

    config = load_console_config()
    args = build_namespace(config, command=mode)
    auto_connect_note = ensure_online_device_with_remote_adb(config, args, "启动任务")
    save_console_config(config)
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

    stdout_handle = LOG_FILE.open("a", encoding="utf-8")
    stderr_handle = ERR_LOG_FILE.open("a", encoding="utf-8")
    try:
        process = subprocess.Popen(
            [sys.executable, str(SCRIPT_PATH), mode, "--config-file", str(CONFIG_FILE)],
            cwd=str(PROJECT_DIR),
            stdin=subprocess.DEVNULL,
            stdout=stdout_handle,
            stderr=stderr_handle,
            start_new_session=True,
        )
    finally:
        stdout_handle.close()
        stderr_handle.close()

    save_process_record(
        {
            "pid": process.pid,
            "mode": mode,
            "started_at": scheduler.now_beijing().isoformat(),
            "command": [sys.executable, str(SCRIPT_PATH), mode, "--config-file", str(CONFIG_FILE)],
        }
    )
    return {
        "message": "调度器已启动",
        "detail": " ".join(filter(None, [f"已启动 {mode} 模式，PID {process.pid}。", auto_connect_note])),
    }


def stop_scheduler_process() -> dict[str, Any]:
    record = read_process_record()
    pid = int(record.get("pid") or 0)
    if not pid or not is_pid_alive(pid):
        PROCESS_FILE.unlink(missing_ok=True)
        raise ApiError(409, "当前没有受控的调度进程可停止。")

    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        PROCESS_FILE.unlink(missing_ok=True)
        raise ApiError(409, "调度进程已经退出。")
    except PermissionError as exc:
        if not is_pid_alive(pid):
            PROCESS_FILE.unlink(missing_ok=True)
            raise ApiError(409, "调度进程已经退出。") from exc
        raise ApiError(500, f"无法停止调度进程 PID {pid}: {exc}") from exc

    deadline = time.time() + 5
    while time.time() < deadline:
        if not is_pid_alive(pid):
            break
        time.sleep(0.15)

    if is_pid_alive(pid):
        os.kill(pid, signal.SIGKILL)

    PROCESS_FILE.unlink(missing_ok=True)
    return {
        "message": "调度器已停止",
        "detail": f"已停止 PID {pid}。",
    }


def run_once() -> dict[str, Any]:
    config = load_console_config()
    apply_console_windows(config)
    args = build_namespace(config, command="run")
    scrcpy_note = ""
    auto_connect_note = ""

    try:
        auto_connect_note = ensure_online_device_with_remote_adb(config, args, "试运行")
        scheduler.ADB_BIN = scheduler.resolve_binary("adb", args.adb_bin, scheduler.ADB_CANDIDATES)
        serial = args.serial or scheduler.detect_single_device()
        status = scheduler.get_device_status(serial)
        try:
            scrcpy_bin = scheduler.resolve_binary("scrcpy", args.scrcpy_bin, scheduler.SCRCPY_CANDIDATES)
            scheduler.SCRCPY_BIN = scrcpy_bin
            if scheduler.is_scrcpy_running_for_serial(serial):
                scrcpy_note = "scrcpy 已在运行。"
            else:
                scheduler.launch_scrcpy(serial)
                scrcpy_note = "scrcpy 已拉起。"
        except Exception as exc:
            scrcpy_note = f"scrcpy 未启动: {exc}"
    except ApiError:
        raise
    except subprocess.CalledProcessError as exc:
        raise ApiError(400, scheduler.describe_process_error(exc)) from exc
    except Exception as exc:
        raise ApiError(400, str(exc)) from exc

    if not scheduler.is_device_ready(status):
        raise ApiError(409, f"设备 {serial} 当前不可执行，状态为 {scheduler.status_summary(status)}。")

    scheduler.log("Manual run triggered from web console.")

    # 确定当前是哪个打卡窗口
    now = scheduler.now_beijing()
    current_time = now.time()
    window_name = "手动执行"
    for window in scheduler.WINDOWS:
        if window.start <= current_time <= window.end:
            window_name = window.name
            break

    try:
        scheduler.perform_action(
            serial,
            config["package"],
            config["app_label"],
            int(config["delay_after_launch"]),
        )
        # 执行成功，记录打卡
        add_checkin_record(window_name, "成功", "手动试运行")
    except subprocess.CalledProcessError as exc:
        # 执行失败，也记录
        add_checkin_record(window_name, "失败", scheduler.describe_process_error(exc))
        raise ApiError(500, scheduler.describe_process_error(exc)) from exc
    except Exception as exc:
        add_checkin_record(window_name, "失败", str(exc))
        raise ApiError(500, str(exc)) from exc

    return {
        "message": "试运行已完成",
        "detail": " ".join(
            filter(None, [f"设备 {serial} 已执行一次手动动作链路。", auto_connect_note, scrcpy_note])
        ),
    }


def restart_adb() -> dict[str, Any]:
    config = load_console_config()
    args = build_namespace(config, command="status")
    try:
        adb_bin = scheduler.resolve_binary("adb", args.adb_bin, scheduler.ADB_CANDIDATES)
    except Exception as exc:
        raise ApiError(400, f"ADB 不可用：{exc}") from exc

    try:
        output = scheduler.restart_adb_server(adb_bin)
    except subprocess.CalledProcessError as exc:
        raise ApiError(500, scheduler.describe_process_error(exc)) from exc
    except Exception as exc:
        raise ApiError(500, str(exc)) from exc

    return {
        "message": "ADB 已重启",
        "detail": output or "ADB daemon 已重新启动。",
    }


def connect_remote_adb_for_dashboard(adb_bin: str, target: str) -> str:
    return scheduler.adb_connect(
        adb_bin,
        target,
        retries=1,
        retry_interval_seconds=0.2,
        probe_timeout_seconds=1.5,
    )


def connect_remote_adb_with_recovery(adb_bin: str, target: str) -> tuple[str, bool]:
    try:
        return scheduler.adb_connect(adb_bin, target), False
    except Exception as first_exc:
        restart_output = scheduler.restart_adb_server(adb_bin)
        try:
            retry_output = scheduler.adb_connect(adb_bin, target)
        except Exception as second_exc:
            raise RuntimeError(
                f"{first_exc}; retry after adb restart failed: {second_exc}"
            ) from second_exc

        merged_output = " ".join(part for part in (restart_output, retry_output) if part).strip()
        return merged_output or retry_output, True


def ensure_online_device_with_remote_adb(config: dict[str, Any], args: argparse.Namespace, action_label: str) -> str:
    target = str(config.get("remote_adb_target") or "").strip()
    target_name = str(config.get("remote_adb_target_name") or "").strip()

    try:
        adb_bin = scheduler.resolve_binary("adb", args.adb_bin, scheduler.ADB_CANDIDATES)
    except Exception as exc:
        raise ApiError(400, f"ADB 不可用：{exc}") from exc

    scheduler.ADB_BIN = adb_bin
    statuses = scheduler.list_device_statuses()
    if any(item.state == "device" for item in statuses):
        return ""

    if not target:
        return ""

    try:
        output, used_recovery = connect_remote_adb_with_recovery(adb_bin, target)
    except Exception as exc:
        detail = summarize_remote_adb_error(str(exc), target)
        remember_remote_adb_target(target, target_name)
        record_remote_adb_status(target, "connect", False, detail)
        raise ApiError(409, f"{action_label}前未检测到在线设备，且远程 ADB 自动连接失败：{detail}") from exc

    remember_remote_adb_target(target, target_name)
    record_remote_adb_status(target, "connect", True, output)
    return f"{target_name + ' / ' if target_name else ''}{target} 已自动连通。{'（已自动重启 ADB 后重试）' if used_recovery else ''}"


def connect_remote_adb() -> dict[str, Any]:
    config = load_console_config()
    args = build_namespace(config, command="status")
    target = str(config.get("remote_adb_target") or "").strip()
    target_name = str(config.get("remote_adb_target_name") or "").strip()
    if not target:
        raise ApiError(400, "请先在前台配置 remote_adb_target，例如 192.168.1.8:5555。")

    try:
        adb_bin = scheduler.resolve_binary("adb", args.adb_bin, scheduler.ADB_CANDIDATES)
    except Exception as exc:
        raise ApiError(400, f"ADB 不可用：{exc}") from exc

    try:
        output, used_recovery = connect_remote_adb_with_recovery(adb_bin, target)
    except Exception as exc:
        detail = summarize_remote_adb_error(str(exc), target)
        remember_remote_adb_target(target, target_name)
        record_remote_adb_status(target, "connect", False, detail)
        raise ApiError(500, detail) from exc

    detail = f"{output}{'（已自动重启 ADB 后重试）' if used_recovery else ''}"
    remember_remote_adb_target(target, target_name)
    record_remote_adb_status(target, "connect", True, detail)

    return {
        "message": "远程 ADB 已连接",
        "detail": detail,
    }


def disconnect_remote_adb() -> dict[str, Any]:
    config = load_console_config()
    args = build_namespace(config, command="status")
    target = str(config.get("remote_adb_target") or "").strip()
    target_name = str(config.get("remote_adb_target_name") or "").strip()
    if not target:
        raise ApiError(400, "请先在前台配置 remote_adb_target，例如 192.168.1.8:5555。")

    try:
        adb_bin = scheduler.resolve_binary("adb", args.adb_bin, scheduler.ADB_CANDIDATES)
    except Exception as exc:
        raise ApiError(400, f"ADB 不可用：{exc}") from exc

    try:
        output = scheduler.adb_disconnect(adb_bin, target)
    except Exception as exc:
        detail = summarize_remote_adb_error(str(exc), target)
        remember_remote_adb_target(target, target_name)
        record_remote_adb_status(target, "disconnect", False, detail)
        raise ApiError(500, detail) from exc

    remember_remote_adb_target(target, target_name)
    record_remote_adb_status(target, "disconnect", True, output)

    return {
        "message": "远程 ADB 已断开",
        "detail": output,
    }


def diagnose_remote_adb() -> dict[str, Any]:
    config = load_console_config()
    args = build_namespace(config, command="status")
    target = str(config.get("remote_adb_target") or "").strip()
    target_name = str(config.get("remote_adb_target_name") or "").strip()

    if not target:
        raise ApiError(400, "请先在前台配置 remote_adb_target，例如 192.168.1.8:5555。")

    try:
        normalized_target, host, port = scheduler.normalize_remote_adb_target(target)
    except Exception as exc:
        raise ApiError(400, f"远程目标格式不合法：{exc}") from exc

    report: dict[str, Any] = {
        "target": normalized_target,
        "targetName": target_name,
        "host": host,
        "port": port,
        "dnsOk": False,
        "dnsIps": [],
        "dnsError": "",
        "tcpOk": False,
        "tcpError": "",
        "adbAvailable": False,
        "adbBin": "",
        "adbSource": "",
        "adbError": "",
        "deviceCount": 0,
        "onlineCount": 0,
        "targetState": "",
        "targetRawLine": "",
        "suggestions": [],
    }

    lines: list[str] = [f"目标 {target_name + ' / ' if target_name else ''}{normalized_target}"]

    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
        ips = sorted({item[4][0] for item in infos if item and item[4]})
        report["dnsOk"] = True
        report["dnsIps"] = ips
        lines.append(f"DNS 可解析（{', '.join(ips[:4]) if ips else '无返回地址'}）")
    except Exception as exc:
        report["dnsError"] = str(exc)
        lines.append(f"DNS 解析失败（{exc}）")

    try:
        scheduler.probe_remote_tcp_endpoint(host, port, timeout_seconds=2.5)
        report["tcpOk"] = True
        lines.append("TCP 端口可达")
    except Exception as exc:
        report["tcpError"] = str(exc)
        lines.append(f"TCP 探测失败（{exc}）")

    try:
        adb_bin = scheduler.resolve_binary("adb", args.adb_bin, scheduler.ADB_CANDIDATES)
        report["adbAvailable"] = True
        report["adbBin"] = adb_bin
        report["adbSource"] = scheduler.describe_binary_source(adb_bin, config.get("adb_bin") or None)
        lines.append(f"ADB 可用（{report['adbSource']}）")
    except Exception as exc:
        report["adbError"] = str(exc)
        lines.append(f"ADB 不可用（{exc}）")
        report["suggestions"].append("先点击“在线安装 ADB”或在前台配置 adb_bin。")
        return {
            "message": "远程 ADB 诊断完成（存在阻断项）",
            "detail": "；".join(lines),
            "diagnostics": report,
        }

    try:
        statuses = scheduler.list_device_statuses_with_bin(report["adbBin"])
    except subprocess.CalledProcessError as exc:
        adb_devices_error = scheduler.describe_process_error(exc)
        report["adbError"] = adb_devices_error
        lines.append(f"adb devices 执行失败（{adb_devices_error}）")
        report["suggestions"].append("先执行“重启 ADB”，再重新诊断。")
        return {
            "message": "远程 ADB 诊断完成（存在阻断项）",
            "detail": "；".join(lines),
            "diagnostics": report,
        }
    except Exception as exc:
        report["adbError"] = str(exc)
        lines.append(f"adb devices 执行失败（{exc}）")
        report["suggestions"].append("先执行“重启 ADB”，再重新诊断。")
        return {
            "message": "远程 ADB 诊断完成（存在阻断项）",
            "detail": "；".join(lines),
            "diagnostics": report,
        }

    report["deviceCount"] = len(statuses)
    report["onlineCount"] = len([item for item in statuses if item.state == "device"])
    target_status = next((item for item in statuses if item.serial == normalized_target), None)
    if target_status:
        report["targetState"] = target_status.state
        report["targetRawLine"] = target_status.raw_line
        lines.append(f"目标设备状态 {target_status.state}")
    else:
        lines.append("目标设备尚未出现在 adb 列表")

    if report["tcpOk"] and report["targetState"] != "device":
        report["suggestions"].append("网络可达但尚未连上，建议点击“连接远程 ADB”立即重试。")
    if report["targetState"] == "unauthorized":
        report["suggestions"].append("目标已连通但未授权，请在手机端确认无线调试授权弹窗。")
    if not report["tcpOk"]:
        report["suggestions"].append("先打通云服务器到目标 host:port 的网络路径（隧道/安全组/防火墙）。")
    if not report["suggestions"]:
        report["suggestions"].append("链路基本正常，可继续执行刷新状态或启动任务。")

    lines.append(f"在线设备 {report['onlineCount']} / 总设备 {report['deviceCount']}")

    return {
        "message": "远程 ADB 诊断完成",
        "detail": "；".join(lines),
        "diagnostics": report,
    }


def install_adb() -> dict[str, Any]:
    install_script = resolve_install_platform_tools_script()

    result = subprocess.run(
        [sys.executable, str(install_script)],
        cwd=str(install_script.parent),
        capture_output=True,
        text=True,
        check=False,
        timeout=180,
    )
    output = "\n".join(part.strip() for part in (result.stdout, result.stderr) if part and part.strip()).strip()
    if result.returncode != 0:
        raise ApiError(500, output or "在线安装 ADB 失败。")

    return {
        "message": "ADB 已安装到云服务器",
        "detail": output or "platform-tools 已安装完成。",
    }


def reroll_schedule() -> dict[str, Any]:
    config = load_console_config()
    apply_console_windows(config)
    now = scheduler.now_beijing()
    state = load_scheduler_state(config)
    for window in scheduler.WINDOWS:
        state.next_runs[window.name] = scheduler.next_run_after(now, window)
    save_scheduler_state(config, state)
    return {
        "message": "今日计划已重新抽取",
        "detail": "上午和下午窗口的下一次执行时间已重新生成。",
    }


def save_config_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    raw_config = payload.get("config")
    raw_next_runs = payload.get("nextRuns", {})
    if not isinstance(raw_next_runs, dict):
        raise ApiError(400, "nextRuns 必须是对象。")

    try:
        config = normalize_console_config(raw_config)
    except Exception as exc:
        raise ApiError(400, f"配置校验失败: {exc}") from exc

    apply_console_windows(config)
    state = load_scheduler_state(config)
    for window_name in WINDOW_LABELS:
        raw_time = str(raw_next_runs.get(window_name, "")).strip()
        if not raw_time:
            continue
        try:
            window = scheduler.find_window(window_name)
            clock_time = scheduler.parse_clock_time(raw_time)
            scheduler.set_next_run_for_window(state, window, clock_time)
        except ValueError as exc:
            raise ApiError(400, str(exc)) from exc

    save_console_config(config)
    save_scheduler_state(config, state)
    return {
        "message": "配置已保存",
        "detail": "基础参数与下一次执行时间已同步到后端。",
    }


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "DingTalkConsoleAPI/0.1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
        super().end_headers()

    def send_json(self, status_code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self) -> dict[str, Any]:
        content_length = int(self.headers.get("Content-Length") or "0")
        if content_length <= 0:
            return {}
        raw_body = self.rfile.read(content_length)
        if not raw_body:
            return {}
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ApiError(400, f"请求体不是合法 JSON: {exc}") from exc
        if not isinstance(payload, dict):
            raise ApiError(400, "请求体必须是 JSON 对象。")
        return payload

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.end_headers()

    def do_HEAD(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in {"/api/health", "/api/dashboard", "/api/checkin-records"}:
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        try:
            path = urlparse(self.path).path
            if path == "/api/health":
                self.send_json(200, {"ok": True, "now": scheduler.now_beijing().isoformat()})
                return
            if path == "/api/dashboard":
                with API_LOCK:
                    self.send_json(200, {"ok": True, "dashboard": build_dashboard()})
                return
            if path == "/api/checkin-records":
                with API_LOCK:
                    records = read_checkin_records()
                    self.send_json(200, {"ok": True, "records": records})
                return
            raise ApiError(404, f"未找到接口: {path}")
        except ApiError as exc:
            self.send_json(exc.status_code, {"ok": False, "message": exc.message})
        except Exception as exc:  # pragma: no cover - defensive fallback
            self.send_json(500, {"ok": False, "message": str(exc)})

    def do_POST(self) -> None:  # noqa: N802
        try:
            path = urlparse(self.path).path
            payload = self.read_json_body()

            with API_LOCK:
                if path == "/api/config":
                    result = save_config_from_payload(payload)
                elif path == "/api/actions/reroll":
                    result = reroll_schedule()
                elif path == "/api/actions/doctor":
                    result = run_cli_command("doctor")
                    if not result["ok"]:
                        raise ApiError(500, result["output"])
                elif path == "/api/actions/adb-install":
                    result = install_adb()
                elif path == "/api/actions/adb-connect":
                    result = connect_remote_adb()
                elif path == "/api/actions/adb-disconnect":
                    result = disconnect_remote_adb()
                elif path == "/api/actions/adb-diagnose":
                    result = diagnose_remote_adb()
                elif path == "/api/actions/remote-adb-targets/delete":
                    result = delete_remote_adb_target(str(payload.get("target") or ""))
                elif path == "/api/actions/adb-restart":
                    result = restart_adb()
                elif path == "/api/actions/run-once":
                    result = run_once()
                elif path == "/api/actions/start":
                    result = start_scheduler_process(str(payload.get("mode") or "run"))
                elif path == "/api/actions/stop":
                    result = stop_scheduler_process()
                elif path == "/api/checkin-records":
                    # POST for adding a new record manually
                    recorded_at = scheduler.now_beijing()
                    record = {
                        "date": str(payload.get("date") or recorded_at.strftime("%Y-%m-%d")),
                        "time": str(payload.get("time") or recorded_at.strftime("%H:%M:%S")),
                        "type": normalize_checkin_type(payload.get("type") or "手动记录"),
                        "status": str(payload.get("status") or "成功"),
                        "remark": str(payload.get("remark") or ""),
                    }
                    save_checkin_record(record)
                    records = read_checkin_records()
                    self.send_json(200, {"ok": True, "message": "记录已添加", "records": records})
                    return
                elif path == "/api/checkin-records/delete":
                    # POST for deleting records by index
                    index = parse_required_int_from_payload(
                        payload,
                        "index",
                        missing_message="缺少记录索引 index。",
                        invalid_message="记录索引 index 必须是整数。",
                    )
                    records = read_checkin_records()
                    if 0 <= index < len(records):
                        deleted = records.pop(index)
                        CHECKIN_RECORDS_FILE.parent.mkdir(parents=True, exist_ok=True)
                        CHECKIN_RECORDS_FILE.write_text(
                            json.dumps({"records": records}, indent=2, ensure_ascii=False) + "\n",
                            encoding="utf-8",
                        )
                        self.send_json(200, {"ok": True, "message": "记录已删除", "deleted": deleted, "records": records})
                        return
                    raise ApiError(400, "无效的记录索引")
                else:
                    raise ApiError(404, f"未找到接口: {path}")

                dashboard = build_dashboard(allow_auto_remote_connect=False)
                self.send_json(200, {"ok": True, **result, "dashboard": dashboard})
        except ApiError as exc:
            self.send_json(exc.status_code, {"ok": False, "message": exc.message})
        except Exception as exc:  # pragma: no cover - defensive fallback
            self.send_json(500, {"ok": False, "message": str(exc)})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="HTTP API for the DingTalk scheduler console.")
    parser.add_argument(
        "--host",
        default=os.environ.get("HOST", "127.0.0.1"),
        help="Host to bind. Default: HOST env or 127.0.0.1",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("PORT", "8000")),
        help="Port to bind. Default: PORT env or 8000",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    save_console_config(load_console_config())
    with ThreadingHTTPServer((args.host, args.port), ApiHandler) as server:
        print(f"DingTalk console API listening on http://{args.host}:{args.port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("DingTalk console API stopped.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
