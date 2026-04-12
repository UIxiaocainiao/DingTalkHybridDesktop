#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "用法: $0 <api_domain>"
  echo "示例: $0 api.example.com"
  exit 1
fi

API_DOMAIN="$1"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="${PROJECT_ROOT}/frontend"
ENV_FILE="${FRONTEND_DIR}/.env.production"

echo "写入 ${ENV_FILE}"
cat > "${ENV_FILE}" <<EOF
VITE_API_BASE_URL=https://${API_DOMAIN}
EOF

echo "安装并构建前端"
npm --prefix "${FRONTEND_DIR}" install
npm --prefix "${FRONTEND_DIR}" run build

echo "构建完成，产物目录: ${FRONTEND_DIR}/dist"
