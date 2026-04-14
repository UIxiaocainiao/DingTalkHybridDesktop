#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
一键拉取仓库代码（首次 clone，后续 pull）

用法:
  bash scripts/pull_repo.sh \
    --repo-url <REPO_URL> \
    [--branch <BRANCH>] \
    [--target-dir <DIR>] \
    [--remote <REMOTE>]

示例:
  # 在当前目录拉取本项目到 ./DingTalk-automatic-check-in
  bash scripts/pull_repo.sh \
    --repo-url git@github.com:UIxiaocainiao/DingTalk-automatic-check-in.git \
    --branch main \
    --target-dir ./DingTalk-automatic-check-in

  # 在已有仓库目录更新到 main
  bash scripts/pull_repo.sh \
    --repo-url git@github.com:UIxiaocainiao/DingTalk-automatic-check-in.git \
    --branch main \
    --target-dir .

参数说明:
  --repo-url     仓库地址（必填）
  --branch       分支名，默认 main
  --target-dir   目标目录，默认当前目录
  --remote       远程名，默认 origin
USAGE
}

log() {
  printf '[%s] %s\n' "$(date '+%F %T')" "$*"
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

REPO_URL=""
BRANCH="main"
TARGET_DIR="."
REMOTE_NAME="origin"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-url)
      REPO_URL="${2:-}"
      shift 2
      ;;
    --branch)
      BRANCH="${2:-}"
      shift 2
      ;;
    --target-dir)
      TARGET_DIR="${2:-}"
      shift 2
      ;;
    --remote)
      REMOTE_NAME="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "未知参数: $1"
      ;;
  esac
done

[[ -n "$REPO_URL" ]] || die "--repo-url 必填"

need_cmd git

TARGET_DIR="$(cd "$(dirname "$TARGET_DIR")" && pwd)/$(basename "$TARGET_DIR")"

if [[ ! -e "$TARGET_DIR" ]]; then
  log "目录不存在，执行 clone -> $TARGET_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
else
  if [[ ! -d "$TARGET_DIR/.git" ]]; then
    die "目标目录存在但不是 git 仓库: $TARGET_DIR"
  fi

  log "检测到已有仓库，执行 fetch + checkout + pull"

  current_remote_url="$(git -C "$TARGET_DIR" remote get-url "$REMOTE_NAME" 2>/dev/null || true)"
  if [[ -z "$current_remote_url" ]]; then
    die "仓库中不存在远程 '$REMOTE_NAME'"
  fi

  if [[ "$current_remote_url" != "$REPO_URL" ]]; then
    die "远程 '$REMOTE_NAME' 地址不匹配:\n  current: $current_remote_url\n  expected: $REPO_URL"
  fi

  git -C "$TARGET_DIR" fetch "$REMOTE_NAME" --prune

  if git -C "$TARGET_DIR" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git -C "$TARGET_DIR" checkout "$BRANCH"
  else
    git -C "$TARGET_DIR" checkout -b "$BRANCH" "$REMOTE_NAME/$BRANCH"
  fi

  git -C "$TARGET_DIR" pull --ff-only "$REMOTE_NAME" "$BRANCH"
fi

LATEST_COMMIT="$(git -C "$TARGET_DIR" rev-parse --short HEAD)"
log "完成: $TARGET_DIR @ $LATEST_COMMIT ($BRANCH)"
