#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_PLAYBACK_DIR="${ROOT_DIR%/DingTalkHybridDesktop}/PlaybackE2E"
PLAYBACK_DIR="${PLAYBACK_DIR:-$DEFAULT_PLAYBACK_DIR}"

if [[ ! -d "$PLAYBACK_DIR" ]]; then
  echo "[playback] 未找到 PlaybackE2E 目录: $PLAYBACK_DIR"
  echo "[playback] 你可以先设置环境变量 PLAYBACK_DIR=/absolute/path/to/PlaybackE2E"
  exit 1
fi

echo "[playback] using project: $PLAYBACK_DIR"
echo "[playback] installing backend dependencies..."
npm install --prefix "$PLAYBACK_DIR/backend"
echo "[playback] installing frontend dependencies..."
npm install --prefix "$PLAYBACK_DIR/frontend"
echo "[playback] bootstrap done"
