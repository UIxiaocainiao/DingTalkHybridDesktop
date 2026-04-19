#!/usr/bin/env bash
set -euo pipefail

# Keep remote ADB target connected in public/cloud deployment.
# Usage:
#   REMOTE_ADB_TARGET=1.2.3.4:5555 bash scripts/remote_adb_keepalive.sh
# or
#   bash scripts/remote_adb_keepalive.sh 1.2.3.4:5555

TARGET="${REMOTE_ADB_TARGET:-${1:-}}"
ADB_BIN="${ADB_BIN:-adb}"
INTERVAL_SECONDS="${REMOTE_ADB_KEEPALIVE_INTERVAL_SECONDS:-30}"
STARTUP_DELAY_SECONDS="${REMOTE_ADB_KEEPALIVE_STARTUP_DELAY_SECONDS:-2}"
RESTART_ON_FAILURE="${REMOTE_ADB_KEEPALIVE_RESTART_ADB_ON_FAILURE:-1}"

if [[ -z "${TARGET}" ]]; then
  echo "ERROR: REMOTE_ADB_TARGET is empty. Example: REMOTE_ADB_TARGET=192.168.1.8:5555" >&2
  exit 1
fi

if ! [[ "${INTERVAL_SECONDS}" =~ ^[0-9]+$ ]] || [[ "${INTERVAL_SECONDS}" -lt 5 ]]; then
  echo "ERROR: REMOTE_ADB_KEEPALIVE_INTERVAL_SECONDS must be an integer >= 5." >&2
  exit 1
fi

if ! [[ "${STARTUP_DELAY_SECONDS}" =~ ^[0-9]+$ ]]; then
  echo "ERROR: REMOTE_ADB_KEEPALIVE_STARTUP_DELAY_SECONDS must be an integer >= 0." >&2
  exit 1
fi

log() {
  printf '[%s] [remote-adb-keepalive] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

ensure_adb() {
  if [[ "${ADB_BIN}" == */* ]]; then
    [[ -x "${ADB_BIN}" ]] || return 1
    return 0
  fi
  command -v "${ADB_BIN}" >/dev/null 2>&1
}

device_state_for_target() {
  local output
  output="$("${ADB_BIN}" devices 2>/dev/null || true)"
  awk -v target="${TARGET}" '
    $1 == target && $2 != "" { print $2; found=1; exit }
    END { if (!found) print "" }
  ' <<<"${output}"
}

connect_target() {
  local output
  output="$("${ADB_BIN}" connect "${TARGET}" 2>&1 || true)"
  output="$(echo "${output}" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//')"
  echo "${output}"
}

restart_adb() {
  "${ADB_BIN}" kill-server >/dev/null 2>&1 || true
  "${ADB_BIN}" start-server >/dev/null 2>&1 || true
}

log "target=${TARGET} adb_bin=${ADB_BIN} interval=${INTERVAL_SECONDS}s"
sleep "${STARTUP_DELAY_SECONDS}"

while true; do
  if ! ensure_adb; then
    log "adb not found (${ADB_BIN}), retry in ${INTERVAL_SECONDS}s."
    sleep "${INTERVAL_SECONDS}"
    continue
  fi

  state="$(device_state_for_target)"
  if [[ "${state}" == "device" ]]; then
    log "${TARGET} already connected."
    sleep "${INTERVAL_SECONDS}"
    continue
  fi

  if [[ "${RESTART_ON_FAILURE}" == "1" ]]; then
    restart_adb
  fi

  result="$(connect_target)"
  state_after="$(device_state_for_target)"

  if [[ "${state_after}" == "device" ]]; then
    log "connect ok: ${result}"
  elif [[ "${state_after}" == "unauthorized" ]]; then
    log "connect unauthorized: approve wireless debugging on phone. adb says: ${result}"
  else
    log "connect failed: ${result:-no output}"
  fi

  sleep "${INTERVAL_SECONDS}"
done
