#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
用法:
  bash scripts/deploy_laika_full.sh \
    --server-ip <SERVER_IP> \
    --ssh-port <SSH_PORT> \
    --ssh-user <SSH_USER> \
    --repo-url <REPO_URL> \
    --branch <BRANCH> \
    --root-domain <ROOT_DOMAIN> \
    --app-rr <APP_RR> \
    --email <LETSENCRYPT_EMAIL>

示例:
  bash scripts/deploy_laika_full.sh \
    --server-ip 154.201.77.53 \
    --ssh-port 22737 \
    --ssh-user root \
    --repo-url https://github.com/UIxiaocainiao/DingTalkHybridDesktop.git \
    --branch main \
    --root-domain pengshz.cn \
    --app-rr dingtalk \
    --email pengshaozu0101@gmail.com

可选参数:
  --app-dir <path>       默认: /opt/dingtalk-automatic-check-in
  --api-port <port>      默认: 18000
  --service-name <name>  默认: dingtalk-api-laika.service
  --skip-dns             跳过阿里云 DNS 变更
  --skip-https           跳过 certbot 证书签发

认证说明:
  1) 推荐使用 SSH 密钥免密登录
  2) 如需密码登录，可在执行前设置环境变量 SSH_PASS

前置依赖:
  - 本机: ssh curl
  - 若不加 --skip-dns: aliyun CLI 且已登录
  - 若设置 SSH_PASS: expect
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
  local c="$1"
  command -v "$c" >/dev/null 2>&1 || die "缺少命令: $c"
}

SERVER_IP=""
SSH_PORT=""
SSH_USER=""
REPO_URL=""
BRANCH=""
ROOT_DOMAIN=""
APP_RR=""
LETSENCRYPT_EMAIL=""
APP_DIR="/opt/dingtalk-automatic-check-in"
API_PORT="18000"
SERVICE_NAME="dingtalk-api-laika.service"
SKIP_DNS=0
SKIP_HTTPS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-ip)
      SERVER_IP="${2:-}"; shift 2 ;;
    --ssh-port)
      SSH_PORT="${2:-}"; shift 2 ;;
    --ssh-user)
      SSH_USER="${2:-}"; shift 2 ;;
    --repo-url)
      REPO_URL="${2:-}"; shift 2 ;;
    --branch)
      BRANCH="${2:-}"; shift 2 ;;
    --root-domain)
      ROOT_DOMAIN="${2:-}"; shift 2 ;;
    --app-rr)
      APP_RR="${2:-}"; shift 2 ;;
    --email)
      LETSENCRYPT_EMAIL="${2:-}"; shift 2 ;;
    --app-dir)
      APP_DIR="${2:-}"; shift 2 ;;
    --api-port)
      API_PORT="${2:-}"; shift 2 ;;
    --service-name)
      SERVICE_NAME="${2:-}"; shift 2 ;;
    --skip-dns)
      SKIP_DNS=1; shift ;;
    --skip-https)
      SKIP_HTTPS=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      die "未知参数: $1" ;;
  esac
done

[[ -n "$SERVER_IP" ]] || die "--server-ip 必填"
[[ -n "$SSH_PORT" ]] || die "--ssh-port 必填"
[[ -n "$SSH_USER" ]] || die "--ssh-user 必填"
[[ -n "$REPO_URL" ]] || die "--repo-url 必填"
[[ -n "$BRANCH" ]] || die "--branch 必填"
[[ -n "$ROOT_DOMAIN" ]] || die "--root-domain 必填"
[[ -n "$APP_RR" ]] || die "--app-rr 必填"
[[ -n "$LETSENCRYPT_EMAIL" ]] || die "--email 必填"

APP_DOMAIN="${APP_RR}.${ROOT_DOMAIN}"

need_cmd ssh
need_cmd curl
if [[ "$SKIP_DNS" -eq 0 ]]; then
  need_cmd aliyun
  need_cmd python3
fi
if [[ -n "${SSH_PASS:-}" ]]; then
  need_cmd expect
fi

run_remote() {
  local remote_cmd="$1"
  if [[ -n "${SSH_PASS:-}" ]]; then
    SSH_PORT="$SSH_PORT" SSH_USER="$SSH_USER" SERVER_IP="$SERVER_IP" REMOTE_CMD="$remote_cmd" expect <<'EXP'
      set timeout 1200
      set pass $env(SSH_PASS)
      set cmd $env(REMOTE_CMD)
      spawn ssh -tt -o StrictHostKeyChecking=no -p $env(SSH_PORT) $env(SSH_USER)@$env(SERVER_IP) "$cmd"
      expect {
        -re "(?i)password:" {
          send "$pass\r"
          exp_continue
        }
        eof
      }
      catch wait result
      set exit_status [lindex $result 3]
      exit $exit_status
EXP
  else
    ssh -tt -o StrictHostKeyChecking=no -p "$SSH_PORT" "$SSH_USER@$SERVER_IP" "$remote_cmd"
  fi
}

ensure_dns_record() {
  local json record_id record_type record_value

  log "检查 DNS 记录: ${APP_DOMAIN}"
  json="$(aliyun alidns DescribeSubDomainRecords --SubDomain "$APP_DOMAIN" --DomainName "$ROOT_DOMAIN")"

  read -r record_id record_type record_value < <(
    python3 -c 'import json,sys
j=json.load(sys.stdin)
recs=j.get("DomainRecords",{}).get("Record",[])
if not recs:
    print("", "", "")
else:
    r=recs[0]
    print(r.get("RecordId",""), r.get("Type",""), r.get("Value",""))
' <<< "$json"
  )

  if [[ -z "$record_id" ]]; then
    log "新增 DNS A 记录: ${APP_DOMAIN} -> ${SERVER_IP}"
    aliyun alidns AddDomainRecord \
      --DomainName "$ROOT_DOMAIN" \
      --RR "$APP_RR" \
      --Type A \
      --Value "$SERVER_IP" \
      --TTL 600 >/dev/null
    return
  fi

  if [[ "$record_type" == "A" && "$record_value" == "$SERVER_IP" ]]; then
    log "DNS 已是目标值，无需变更"
    return
  fi

  log "更新 DNS 记录(${record_id}): ${record_type}/${record_value} -> A/${SERVER_IP}"
  aliyun alidns UpdateDomainRecord \
    --RecordId "$record_id" \
    --RR "$APP_RR" \
    --Type A \
    --Value "$SERVER_IP" \
    --TTL 600 >/dev/null
}

verify_dns_doh() {
  local doh
  doh="$(curl -fsSL "https://dns.google/resolve?name=${APP_DOMAIN}&type=A")"
  if [[ "$doh" == *"\"data\":\"${SERVER_IP}\""* ]]; then
    log "DoH 解析正常: ${APP_DOMAIN} -> ${SERVER_IP}"
  else
    log "警告: DoH 暂未返回目标 IP，可能是 DNS 传播延迟"
    echo "$doh"
  fi
}

remote_deploy() {
  log "远程初始化与部署"

  local cmd
  cmd="set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git nginx
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v20\\.'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

APP_DIR='${APP_DIR}'
REPO_URL='${REPO_URL}'
BRANCH='${BRANCH}'
APP_DOMAIN='${APP_DOMAIN}'
API_PORT='${API_PORT}'
SERVICE_NAME='${SERVICE_NAME}'

if [ -d \"\$APP_DIR/.git\" ]; then
  git -C \"\$APP_DIR\" fetch --all --prune
  git -C \"\$APP_DIR\" checkout \"\$BRANCH\"
  git -C \"\$APP_DIR\" pull --ff-only origin \"\$BRANCH\"
else
  rm -rf \"\$APP_DIR\"
  git clone \"\$REPO_URL\" \"\$APP_DIR\"
  git -C \"\$APP_DIR\" checkout \"\$BRANCH\"
fi

cd \"\$APP_DIR\"
bash scripts/build_frontend_for_public.sh \"\$APP_DOMAIN\"

cat > /etc/systemd/system/\$SERVICE_NAME <<'UNIT'
[Unit]
Description=DingTalk API Server (Laika)
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}/backend
ExecStart=/usr/bin/python3 api_server.py --host 127.0.0.1 --port ${API_PORT}
Restart=always
RestartSec=5
User=root
Environment=HOST=127.0.0.1
Environment=PORT=${API_PORT}

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/nginx/sites-available/\$APP_DOMAIN <<'NGINX'
server {
  listen 80;
  listen [::]:80;
  server_name ${APP_DOMAIN};

  root ${APP_DIR}/frontend/dist;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:${API_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location / {
    try_files \$uri \$uri/ /index.html;
  }
}
NGINX

ln -sfn /etc/nginx/sites-available/\$APP_DOMAIN /etc/nginx/sites-enabled/\$APP_DOMAIN
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl daemon-reload
systemctl enable --now \$SERVICE_NAME
systemctl restart \$SERVICE_NAME
systemctl enable --now nginx
systemctl restart nginx
curl -fsS http://127.0.0.1:\$API_PORT/api/health >/dev/null
"

  run_remote "$cmd"
}

remote_enable_https() {
  log "远程签发 HTTPS 证书"

  local cmd
  cmd="set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get install -y certbot python3-certbot-nginx
APP_DOMAIN='${APP_DOMAIN}'
LETSENCRYPT_EMAIL='${LETSENCRYPT_EMAIL}'

certbot --nginx -d \"\$APP_DOMAIN\" --non-interactive --agree-tos -m \"\$LETSENCRYPT_EMAIL\" --redirect || \
certbot --nginx -d \"\$APP_DOMAIN\" --non-interactive --agree-tos -m \"\$LETSENCRYPT_EMAIL\" --redirect

systemctl reload nginx
"

  run_remote "$cmd"
}

verify_remote() {
  log "远程最终验收"
  local scheme='https'
  if [[ "$SKIP_HTTPS" -eq 1 ]]; then
    scheme='http'
  fi

  run_remote "set -euo pipefail
APP_DOMAIN='${APP_DOMAIN}'
API_PORT='${API_PORT}'
SERVICE_NAME='${SERVICE_NAME}'
SCHEME='${scheme}'
echo backend_enabled=\$(systemctl is-enabled \"\$SERVICE_NAME\")
echo backend_active=\$(systemctl is-active \"\$SERVICE_NAME\")
echo nginx_enabled=\$(systemctl is-enabled nginx)
echo nginx_active=\$(systemctl is-active nginx)
curl -fsS http://127.0.0.1:\$API_PORT/api/health
echo
curl -fsS \$SCHEME://\$APP_DOMAIN/api/health
echo
curl -fsSI \$SCHEME://\$APP_DOMAIN | sed -n '1,8p'
"
}

verify_local_force_resolve() {
  if [[ "$SKIP_HTTPS" -eq 1 ]]; then
    log "本地验收 (HTTP, --skip-https)"
    curl -fsSI --resolve "${APP_DOMAIN}:80:${SERVER_IP}" "http://${APP_DOMAIN}" | sed -n '1,8p'
    curl -fsS --resolve "${APP_DOMAIN}:80:${SERVER_IP}" "http://${APP_DOMAIN}/api/health"
    echo
    return
  fi

  log "本地强制解析验收（绕过本地 DNS 干扰）"
  curl -fsSI --resolve "${APP_DOMAIN}:443:${SERVER_IP}" "https://${APP_DOMAIN}" | sed -n '1,8p'
  curl -fsS --resolve "${APP_DOMAIN}:443:${SERVER_IP}" "https://${APP_DOMAIN}/api/health"
  echo
}

log "部署参数: app_domain=${APP_DOMAIN}, server=${SSH_USER}@${SERVER_IP}:${SSH_PORT}, branch=${BRANCH}"

if [[ "$SKIP_DNS" -eq 0 ]]; then
  ensure_dns_record
  verify_dns_doh
else
  log "跳过 DNS 变更 (--skip-dns)"
fi

remote_deploy

final_scheme="https"
if [[ "$SKIP_HTTPS" -eq 0 ]]; then
  remote_enable_https
else
  final_scheme="http"
  log "跳过 HTTPS 签发 (--skip-https)"
fi

verify_remote
verify_local_force_resolve

log "完成: ${final_scheme}://${APP_DOMAIN}"
