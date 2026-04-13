#!/usr/bin/env python3
"""HTTP API for the DingTalk automation console."""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
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
WINDOW_LABELS = {
    "morning": "上午窗口",
    "evening": "下午窗口",
}
API_LOCK = threading.Lock()


class ApiError(RuntimeError):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def default_console_config() -> dict[str, Any]:
    return {
        "serial": "",
        "package": scheduler.DEFAULT_PACKAGE,
        "app_label": scheduler.DEFAULT_APP_LABEL,
        "delay_after_launch": scheduler.DEFAULT_DELAY_AFTER_LAUNCH,
        "poll_interval": scheduler.DEFAULT_POLL_INTERVAL,
        "scrcpy_launch_cooldown": scheduler.DEFAULT_SCRCPY_LAUNCH_COOLDOWN,
        "state_file": scheduler.DEFAULT_STATE_FILE,
        "workday_api_url": scheduler.DEFAULT_WORKDAY_API_URL,
        "workday_api_timeout_ms": int(scheduler.DEFAULT_WORKDAY_API_TIMEOUT * 1000),
        "enable_scrcpy_watch": False,
        "notify_on_success": False,
        "enable_workday_check": True,
        "adb_bin": "",
        "scrcpy_bin": "",
        "windows": {
            window.name: {
                "start": window.start.strftime("%H:%M"),
                "end": window.end.strftime("%H:%M"),
            }
            for window in scheduler.WINDOWS
        },
    }


def normalize_console_config(payload: Any) -> dict[str, Any]:
    defaults = default_console_config()
    if not isinstance(payload, dict):
        return defaults

    normalized = default_console_config()

    for key in ("serial", "package", "app_label", "state_file", "workday_api_url", "adb_bin", "scrcpy_bin"):
        if key in payload and payload[key] is not None:
            normalized[key] = str(payload[key]).strip()

    for key, minimum in (
        ("delay_after_launch", 1),
        ("poll_interval", 1),
        ("scrcpy_launch_cooldown", 1),
        ("workday_api_timeout_ms", 1000),
    ):
        if key in payload and payload[key] is not None:
            normalized[key] = max(minimum, int(payload[key]))

    for key in ("enable_scrcpy_watch", "notify_on_success", "enable_workday_check"):
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
    return scheduler.load_scheduler_state(state_file, datetime.now())


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
    return records if isinstance(records, list) else []


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
    now = datetime.now()
    record = {
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H:%M:%S"),
        "type": WINDOW_LABELS.get(window_name, window_name),
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
            "label": "调试中" if mode == "debug" else "运行中",
            "detail": f"受控进程 PID {pid}，模式 {mode}。",
        }

    PROCESS_FILE.unlink(missing_ok=True)
    return {
        "running": False,
        "pid": None,
        "mode": None,
        "startedAt": "",
        "label": "未启动",
        "detail": "当前没有受控制台托管的调度进程。",
    }


def serialize_workday_result(result: scheduler.WorkdayCheckResult | None, error: str | None) -> dict[str, Any]:
    if not result:
        return {
            "enabled": False,
            "checkedDate": "",
            "isWorkday": None,
            "note": "",
            "source": "",
            "checkedAt": "",
            "error": error or "",
        }
    return {
        "enabled": True,
        "checkedDate": result.checked_date.isoformat(),
        "isWorkday": result.is_workday,
        "note": result.note,
        "source": result.source,
        "checkedAt": result.checked_at.isoformat(),
        "error": error or "",
    }


def resolve_workday_snapshot(
    config: dict[str, Any],
    state: scheduler.SchedulerState,
) -> tuple[scheduler.WorkdayCheckResult | None, str | None]:
    if not config["enable_workday_check"]:
        return None, None

    today = date.today()
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


def resolve_device_snapshot(config: dict[str, Any]) -> dict[str, Any]:
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

    if adb_bin:
        try:
            statuses = scheduler.list_device_statuses()
        except subprocess.CalledProcessError as exc:
            error = summarize_adb_connection_error(scheduler.describe_process_error(exc))
        except Exception as exc:
            error = summarize_adb_connection_error(str(exc))
    else:
        error = (
            "设备连接器缺少 adb：请运行 python3 scripts/install_platform_tools.py，"
            "或在前台配置 adb_bin 为 platform-tools/adb 的绝对路径。"
        )

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

    device_count = len(statuses)
    online_count = len([item for item in statuses if item.state == "device"])
    unauthorized_count = len([item for item in statuses if item.state == "unauthorized"])
    offline_count = len([item for item in statuses if item.state == "offline"])
    device_list = [
        {"serial": item.serial, "state": item.state, "usbConnected": item.usb_connected}
        for item in statuses[:5]
    ]

    return {
        "serial": selected_serial,
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
        "adbInstallHint": "python3 scripts/install_platform_tools.py",
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
            "ADB 未安装或路径不可执行：请运行 python3 scripts/install_platform_tools.py，"
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


def derive_last_success(state: scheduler.SchedulerState) -> dict[str, str]:
    latest_window = ""
    latest_date: date | None = None
    for window in scheduler.WINDOWS:
        completed = state.last_completed_dates.get(window.name)
        if completed and (latest_date is None or completed > latest_date):
            latest_date = completed
            latest_window = window.name

    if not latest_date:
        return {"window": "", "date": "", "label": "暂无执行记录"}

    window_label = WINDOW_LABELS.get(latest_window, latest_window)
    return {
        "window": latest_window,
        "date": latest_date.isoformat(),
        "label": f"{latest_date.isoformat()} {window_label}",
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
                "completed": last_completed.isoformat() if last_completed else "未执行",
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
            "title": "还没有后端日志",
            "detail": "启动调度器、自检或试运行后，这里会展示真实的后端日志。",
            "status": "信息",
        }
    ]


def build_timeline(logs: list[dict[str, str]], windows: list[dict[str, str]], workday: dict[str, Any]) -> list[str]:
    items: list[str] = []
    for entry in reversed(logs[:4]):
        items.append(f"{entry['time']} {entry['title']}")

    if workday.get("enabled") and workday.get("checkedDate") and workday.get("note"):
        items.append(f"{workday['checkedDate']} 工作日校验 {workday['note']}")

    for window in windows:
        items.append(f"{window['title']} 下一次计划 {window['selectedAt']}")

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


def build_dashboard() -> dict[str, Any]:
    config = load_console_config()
    apply_console_windows(config)
    state = load_scheduler_state(config)
    process_state = get_scheduler_process_state()
    workday_result, workday_error = resolve_workday_snapshot(config, state)
    device = resolve_device_snapshot(config)
    windows = build_window_items(config, state)
    logs = read_recent_logs()
    workday = serialize_workday_result(workday_result, workday_error)

    return {
        "generatedAt": datetime.now().isoformat(),
        "config": config,
        "scheduler": process_state,
        "device": device,
        "workday": workday,
        "windows": windows,
        "lastSuccess": derive_last_success(state),
        "scheduleSummary": " / ".join(window["selected"] for window in windows),
        "toggles": [
            f"scrcpy 观察模式 {'已开启' if config['enable_scrcpy_watch'] else '已关闭'}",
            f"成功通知 {'已开启' if config['notify_on_success'] else '已关闭'}",
            f"工作日校验 {'已开启' if config['enable_workday_check'] else '已关闭'}",
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
            "started_at": datetime.now().isoformat(),
            "command": [sys.executable, str(SCRIPT_PATH), mode, "--config-file", str(CONFIG_FILE)],
        }
    )
    return {
        "message": "调度器已启动",
        "detail": f"已启动 {mode} 模式，PID {process.pid}。",
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

    try:
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
    except subprocess.CalledProcessError as exc:
        raise ApiError(400, scheduler.describe_process_error(exc)) from exc
    except Exception as exc:
        raise ApiError(400, str(exc)) from exc

    if not scheduler.is_device_ready(status):
        raise ApiError(409, f"设备 {serial} 当前不可执行，状态为 {scheduler.status_summary(status)}。")

    scheduler.log("Manual run triggered from web console.")

    # 确定当前是哪个打卡窗口
    now = datetime.now()
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
        "detail": " ".join(filter(None, [f"设备 {serial} 已执行一次手动动作链路。", scrcpy_note])),
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


def reroll_schedule() -> dict[str, Any]:
    config = load_console_config()
    apply_console_windows(config)
    now = datetime.now()
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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
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

    def do_GET(self) -> None:  # noqa: N802
        try:
            path = urlparse(self.path).path
            if path == "/api/health":
                self.send_json(200, {"ok": True, "now": datetime.now().isoformat()})
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
                    record = {
                        "date": str(payload.get("date") or datetime.now().strftime("%Y-%m-%d")),
                        "time": str(payload.get("time") or datetime.now().strftime("%H:%M:%S")),
                        "type": str(payload.get("type") or "手动记录"),
                        "status": str(payload.get("status") or "成功"),
                        "remark": str(payload.get("remark") or ""),
                    }
                    save_checkin_record(record)
                    records = read_checkin_records()
                    self.send_json(200, {"ok": True, "message": "记录已添加", "records": records})
                    return
                elif path == "/api/checkin-records/delete":
                    # POST for deleting records by index
                    index = int(payload.get("index") or -1)
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

                dashboard = build_dashboard()
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
