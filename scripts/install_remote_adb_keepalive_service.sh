#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="remote-adb-keepalive.service"
WORKDIR="/opt/dingtalk-automatic-check-in"
SERVICE_USER="$(id -un)"
REMOTE_TARGET=""
ADB_BIN=""
INTERVAL_SECONDS="30"
INSTALL_MODE="1"

usage() {
  cat <<'EOF'
Install remote ADB keepalive as a systemd service.

Usage:
  bash scripts/install_remote_adb_keepalive_service.sh \
    --target 192.168.1.8:5555 \
    [--workdir /opt/dingtalk-automatic-check-in] \
    [--user www-data] \
    [--adb-bin /opt/dingtalk-automatic-check-in/backend/runtime/platform-tools/adb] \
    [--interval 30] \
    [--service-name remote-adb-keepalive.service] \
    [--dry-run]

EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      REMOTE_TARGET="${2:-}"
      shift 2
      ;;
    --workdir)
      WORKDIR="${2:-}"
      shift 2
      ;;
    --user)
      SERVICE_USER="${2:-}"
      shift 2
      ;;
    --adb-bin)
      ADB_BIN="${2:-}"
      shift 2
      ;;
    --interval)
      INTERVAL_SECONDS="${2:-}"
      shift 2
      ;;
    --service-name)
      SERVICE_NAME="${2:-}"
      shift 2
      ;;
    --dry-run)
      INSTALL_MODE="0"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${REMOTE_TARGET}" ]]; then
  echo "ERROR: --target is required. Example: --target 192.168.1.8:5555" >&2
  exit 1
fi

if [[ -z "${ADB_BIN}" ]]; then
  ADB_BIN="${WORKDIR}/backend/runtime/platform-tools/adb"
fi

if ! [[ "${INTERVAL_SECONDS}" =~ ^[0-9]+$ ]] || [[ "${INTERVAL_SECONDS}" -lt 5 ]]; then
  echo "ERROR: --interval must be an integer >= 5" >&2
  exit 1
fi

UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}"
TMP_FILE="$(mktemp)"
trap 'rm -f "${TMP_FILE}"' EXIT

cat > "${TMP_FILE}" <<EOF
[Unit]
Description=DingTalk Remote ADB Keepalive
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${WORKDIR}
Environment=REMOTE_ADB_TARGET=${REMOTE_TARGET}
Environment=ADB_BIN=${ADB_BIN}
Environment=REMOTE_ADB_KEEPALIVE_INTERVAL_SECONDS=${INTERVAL_SECONDS}
Environment=REMOTE_ADB_KEEPALIVE_RESTART_ADB_ON_FAILURE=1
ExecStart=/bin/bash ${WORKDIR}/scripts/remote_adb_keepalive.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

if [[ "${INSTALL_MODE}" == "0" ]]; then
  echo "==== ${SERVICE_NAME} (dry-run) ===="
  cat "${TMP_FILE}"
  exit 0
fi

if ! command -v sudo >/dev/null 2>&1; then
  echo "ERROR: sudo is required to install ${UNIT_PATH}" >&2
  exit 1
fi

echo "Installing ${UNIT_PATH} ..."
sudo cp "${TMP_FILE}" "${UNIT_PATH}"
sudo systemctl daemon-reload
sudo systemctl enable --now "${SERVICE_NAME}"
sudo systemctl status "${SERVICE_NAME}" --no-pager

echo "Installed and started: ${SERVICE_NAME}"
