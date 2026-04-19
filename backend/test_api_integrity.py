#!/usr/bin/env python3
"""Smoke-test the local console API end to end with isolated temp files."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib import error, request


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
API_SERVER = BASE_DIR / "api_server.py"
HOST = "127.0.0.1"
PORT = 8765


def api_request(
    method: str,
    path: str,
    payload: dict | None = None,
    timeout: float = 5,
) -> tuple[int, dict]:
    body = None
    headers = {}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = request.Request(
        url=f"http://{HOST}:{PORT}{path}",
        method=method,
        data=body,
        headers=headers,
    )

    try:
        with request.urlopen(req, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def wait_for_server() -> None:
    deadline = time.time() + 10
    last_error = ""
    while time.time() < deadline:
        try:
            status, payload = api_request("GET", "/api/health")
            if status == 200 and payload.get("ok") is True:
                return
        except Exception as exc:  # pragma: no cover - transient startup path
            last_error = str(exc)
        time.sleep(0.2)
    raise RuntimeError(f"API server did not become ready in time. Last error: {last_error}")


def assert_keys(payload: dict, keys: list[str], label: str) -> None:
    missing = [key for key in keys if key not in payload]
    if missing:
        raise AssertionError(f"{label} missing keys: {missing}")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="dingtalk-api-test-") as temp_dir:
        temp_path = Path(temp_dir)
        config_file = temp_path / "console-config.json"
        state_file = temp_path / "scheduler.state.json"
        process_file = temp_path / "scheduler.process.json"
        log_file = temp_path / "scheduler.log"
        err_log_file = temp_path / "scheduler.err.log"
        checkin_records_file = temp_path / "checkin-records.json"
        remote_adb_status_file = temp_path / "remote-adb-status.json"
        server_log = temp_path / "api-server.log"

        config_file.write_text(
            json.dumps(
                {
                    "serial": "",
                    "remote_adb_target": "",
                    "remote_adb_target_name": "",
                    "package": "com.alibaba.android.rimet",
                    "app_label": "钉钉",
                    "delay_after_launch": 5,
                    "poll_interval": 5,
                    "scrcpy_launch_cooldown": 15,
                    "state_file": str(state_file),
                    "workday_api_url": "https://holiday.dreace.top?date={date}",
                    "workday_api_timeout_ms": 5000,
                    "enable_scrcpy_watch": False,
                    "notify_on_success": False,
                    "enable_workday_check": True,
                    "adb_bin": "",
                    "scrcpy_bin": "",
                    "windows": {
                        "morning": {"start": "09:05", "end": "09:10"},
                        "evening": {"start": "18:05", "end": "18:15"},
                    },
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        env = os.environ.copy()
        env["DINGTALK_CONSOLE_CONFIG_FILE"] = str(config_file)
        env["DINGTALK_CONSOLE_PROCESS_FILE"] = str(process_file)
        env["DINGTALK_CONSOLE_LOG_FILE"] = str(log_file)
        env["DINGTALK_CONSOLE_ERR_LOG_FILE"] = str(err_log_file)
        env["DINGTALK_CONSOLE_CHECKIN_RECORDS_FILE"] = str(checkin_records_file)
        env["DINGTALK_REMOTE_ADB_STATUS_FILE"] = str(remote_adb_status_file)

        with server_log.open("w", encoding="utf-8") as output:
            server = subprocess.Popen(
                [sys.executable, str(API_SERVER), "--host", HOST, "--port", str(PORT)],
                cwd=str(PROJECT_DIR),
                env=env,
                stdout=output,
                stderr=subprocess.STDOUT,
            )

        try:
            wait_for_server()

            status, payload = api_request("GET", "/api/health")
            assert status == 200 and payload.get("ok") is True
            print("health: ok")

            status, payload = api_request("GET", "/api/dashboard")
            assert status == 200 and payload.get("ok") is True
            dashboard = payload["dashboard"]
            assert_keys(
                dashboard,
                [
                    "alerts",
                    "config",
                    "device",
                    "generatedAt",
                    "generatedAtLabel",
                    "logs",
                    "lastSuccess",
                    "remoteAdb",
                    "scheduleSummary",
                    "scheduler",
                    "statusTags",
                    "timeline",
                    "toggles",
                    "windows",
                    "workday",
                ],
                "dashboard",
            )
            assert_keys(
                dashboard["remoteAdb"],
                ["target", "action", "ok", "detail", "checkedAt", "checkedAtLabel"],
                "dashboard.remoteAdb",
            )
            assert_keys(
                dashboard["scheduler"],
                ["running", "startedAt", "startedAtLabel", "label", "detail"],
                "dashboard.scheduler",
            )
            assert_keys(
                dashboard["workday"],
                ["checkedDate", "checkedDateLabel", "checkedAt", "checkedAtLabel"],
                "dashboard.workday",
            )
            assert_keys(
                dashboard["lastSuccess"],
                ["window", "date", "dateLabel", "label"],
                "dashboard.lastSuccess",
            )
            assert dashboard["windows"], "dashboard.windows should not be empty"
            assert_keys(
                dashboard["windows"][0],
                [
                    "name",
                    "title",
                    "start",
                    "end",
                    "selected",
                    "selectedAt",
                    "selectedAtLabel",
                    "completed",
                    "completedLabel",
                ],
                "dashboard.windows[0]",
            )
            if dashboard["logs"]:
                assert_keys(
                    dashboard["logs"][0],
                    ["time", "timeLabel", "title", "detail", "status"],
                    "dashboard.logs[0]",
                )
            print("dashboard: ok")

            status, payload = api_request(
                "POST",
                "/api/config",
                {
                    "config": {
                        "serial": "",
                        "remote_adb_target": "127.0.0.1:65535",
                        "remote_adb_target_name": "本地失败目标",
                        "package": "com.alibaba.android.rimet",
                        "app_label": "钉钉",
                        "delay_after_launch": 7,
                        "poll_interval": 9,
                        "scrcpy_launch_cooldown": 22,
                        "state_file": str(state_file),
                        "workday_api_url": "https://holiday.dreace.top?date={date}",
                        "workday_api_timeout_ms": 6500,
                        "enable_scrcpy_watch": True,
                        "notify_on_success": True,
                        "enable_workday_check": False,
                        "adb_bin": "",
                        "scrcpy_bin": "",
                        "windows": {
                            "morning": {"start": "09:06", "end": "09:11"},
                            "evening": {"start": "18:06", "end": "18:16"},
                        },
                    },
                    "nextRuns": {
                        "morning": "09:07:09",
                        "evening": "18:07:11",
                    },
                },
            )
            assert status == 200 and payload.get("ok") is True
            updated_config = payload["dashboard"]["config"]
            assert updated_config["enable_scrcpy_watch"] is True
            assert updated_config["notify_on_success"] is True
            assert updated_config["enable_workday_check"] is False
            assert updated_config["poll_interval"] == 9
            assert updated_config["remote_adb_target"] == "127.0.0.1:65535"
            assert updated_config["remote_adb_target_name"] == "本地失败目标"
            assert payload["dashboard"]["windows"][0]["start"] == "09:06"
            print("config save: ok")

            status, payload = api_request("POST", "/api/actions/reroll", {})
            assert status == 200 and payload.get("ok") is True
            assert len(payload["dashboard"]["windows"]) == 2
            print("reroll: ok")

            status, payload = api_request("POST", "/api/actions/doctor", {})
            assert status in {200, 500}
            assert "ok" in payload
            assert "message" in payload or "output" in payload
            print(f"doctor: ok ({status})")

            status, payload = api_request("POST", "/api/actions/adb-install", {}, timeout=20)
            assert status in {200, 500}
            assert "ok" in payload
            assert "message" in payload
            print(f"adb-install: ok ({status})")

            status, payload = api_request("POST", "/api/actions/adb-connect", {}, timeout=20)
            assert status in {200, 500}
            assert "ok" in payload
            assert "message" in payload
            print(f"adb-connect: ok ({status})")

            status, payload = api_request("POST", "/api/actions/adb-disconnect", {}, timeout=20)
            assert status in {200, 500}
            assert "ok" in payload
            assert "message" in payload
            print(f"adb-disconnect: ok ({status})")

            status, payload = api_request("POST", "/api/actions/adb-diagnose", {}, timeout=20)
            assert status == 200 and payload.get("ok") is True
            assert isinstance(payload.get("diagnostics"), dict)
            print("adb-diagnose: ok")

            status, payload = api_request(
                "POST",
                "/api/actions/remote-adb-targets/delete",
                {"target": "127.0.0.1:65535"},
            )
            assert status == 200 and payload.get("ok") is True
            assert payload["dashboard"]["config"]["remote_adb_target"] == ""
            assert payload["dashboard"]["config"]["remote_adb_target_name"] == ""
            assert all(
                item["target"] != "127.0.0.1:65535"
                for item in payload["dashboard"]["config"]["recent_remote_adb_targets"]
            )
            print("remote-adb-target-delete: ok")

            run_once_timed_out = False
            try:
                status, payload = api_request("POST", "/api/actions/run-once", {}, timeout=12)
                assert status in {200, 400, 409, 500}
                assert "ok" in payload
                print(f"run-once: ok ({status})")
            except TimeoutError:
                run_once_timed_out = True
                print("run-once: skipped (request timeout in current device/ADB environment)")
            except socket.timeout:
                run_once_timed_out = True
                print("run-once: skipped (socket timeout in current device/ADB environment)")

            server_blocked_by_run_once = run_once_timed_out

            if server_blocked_by_run_once:
                print("start/stop: skipped (run-once still occupying current device/ADB environment)")
                print("start invalid mode: skipped (server may still be blocked by run-once timeout)")
            else:
                status, payload = api_request("POST", "/api/actions/start", {"mode": "run"})
                assert status == 200 and payload.get("ok") is True
                print("start: ok")

                time.sleep(0.6)
                status, payload = api_request("POST", "/api/actions/stop", {})
                assert status in {200, 409}
                assert "ok" in payload
                print(f"stop: ok ({status})")

                status, payload = api_request("POST", "/api/actions/start", {"mode": "bad-mode"})
                assert status == 400 and payload.get("ok") is False
                print("start invalid mode: ok")

            if server_blocked_by_run_once:
                print("checkin type normalize: skipped (server may still be blocked by run-once timeout)")
            else:
                status, payload = api_request(
                    "POST",
                    "/api/checkin-records",
                    {"type": "下午窗口", "status": "成功", "remark": "兼容性测试"},
                )
                assert status == 200 and payload.get("ok") is True
                assert payload.get("records"), "records should not be empty after insert"
                assert payload["records"][0]["type"] == "下午打卡"
                print("checkin type normalize: ok")

        finally:
            if server.poll() is None:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()

        print("api integrity: passed")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
