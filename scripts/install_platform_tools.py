#!/usr/bin/env python3
"""Install Android platform-tools into the backend vendor directory."""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import stat
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_INSTALL_ROOT = PROJECT_DIR / "backend/vendor/platform-tools"
DOWNLOAD_URLS = {
    "darwin": "https://dl.google.com/android/repository/platform-tools-latest-darwin.zip",
    "linux": "https://dl.google.com/android/repository/platform-tools-latest-linux.zip",
    "windows": "https://dl.google.com/android/repository/platform-tools-latest-windows.zip",
}


def host_os_name() -> str:
    if sys.platform == "darwin":
        return "darwin"
    if sys.platform.startswith("linux"):
        return "linux"
    if sys.platform.startswith(("win32", "cygwin", "msys")):
        return "windows"
    raise RuntimeError(f"Unsupported platform for platform-tools: {sys.platform}")


def host_platform_key(os_name: str) -> str:
    machine = platform.machine().lower()
    if machine in {"arm64", "aarch64"}:
        arch = "arm64"
    elif machine in {"x86_64", "amd64"}:
        arch = "x64"
    else:
        arch = machine or "unknown"
    return f"{os_name}-{arch}"


def adb_executable_name(os_name: str) -> str:
    return "adb.exe" if os_name == "windows" else "adb"


def make_executable(path: Path) -> None:
    if os.name == "nt":
        return
    current_mode = path.stat().st_mode
    path.chmod(current_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def install_platform_tools(install_root: Path, force: bool) -> Path:
    os_name = host_os_name()
    platform_key = host_platform_key(os_name)
    target_dir = install_root.expanduser() / platform_key
    adb_path = target_dir / "platform-tools" / adb_executable_name(os_name)

    if adb_path.exists() and not force:
        return adb_path

    with tempfile.TemporaryDirectory(prefix="platform-tools-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        archive_path = temp_dir / "platform-tools.zip"
        urllib.request.urlretrieve(DOWNLOAD_URLS[os_name], archive_path)

        extract_dir = temp_dir / "extract"
        extract_dir.mkdir()
        with zipfile.ZipFile(archive_path) as archive:
            archive.extractall(extract_dir)

        extracted_platform_tools = extract_dir / "platform-tools"
        extracted_adb = extracted_platform_tools / adb_executable_name(os_name)
        if not extracted_adb.exists():
            raise RuntimeError(f"Downloaded archive did not contain {adb_executable_name(os_name)}")

        if target_dir.exists():
            shutil.rmtree(target_dir)
        target_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(extracted_platform_tools, target_dir / "platform-tools")

    make_executable(adb_path)
    return adb_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Install official Android platform-tools for this project.")
    parser.add_argument(
        "--install-root",
        default=str(DEFAULT_INSTALL_ROOT),
        help=f"Install root directory. Default: {DEFAULT_INSTALL_ROOT}",
    )
    parser.add_argument("--force", action="store_true", help="Reinstall even when adb already exists.")
    args = parser.parse_args()

    try:
        adb_path = install_platform_tools(Path(args.install_root), args.force)
    except Exception as exc:
        print(f"FAIL platform-tools install failed: {exc}", file=sys.stderr)
        return 1

    print(f"OK adb installed: {adb_path}")
    print("Next: python3 backend/dingtalk_random_scheduler.py doctor")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
