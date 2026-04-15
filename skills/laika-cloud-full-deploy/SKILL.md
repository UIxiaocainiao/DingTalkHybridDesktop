---
name: laika-cloud-full-deploy
description: >-
  Deploy DingTalkHybridDesktop to a Laika VPS end-to-end (frontend + backend +
  Nginx + systemd), configure Alibaba Cloud DNS A record, issue Let's Encrypt HTTPS,
  and complete acceptance checks with rollback guidance. Use when user asks to deploy this
  project to Laika cloud/VPS or replicate production deployment.
---
# Laika Cloud Full Deploy (DingTalkHybridDesktop)

## Scope

This skill is for **this repo only**: `DingTalkHybridDesktop`.

Target result:

- Frontend: `https://<APP_DOMAIN>/`
- API health: `https://<APP_DOMAIN>/api/health`
- Backend process managed by `systemd`
- Nginx serving static frontend and proxying `/api`

## Standard Architecture

- OS: Debian 12+
- App dir: `/opt/dingtalk-automatic-check-in`
- Backend service: `dingtalk-api-laika.service`
- Backend bind: `127.0.0.1:18000`
- Frontend build output: `frontend/dist`
- Reverse proxy: Nginx (`/api/* -> 127.0.0.1:18000`)

## Required Inputs

Collect these values before execution:

1. `SERVER_IP` (example `154.201.77.53`)
2. `SSH_PORT` (example `22737`)
3. `SSH_USER` (usually `root`)
4. `REPO_URL` (example `https://github.com/UIxiaocainiao/DingTalkHybridDesktop.git`)
5. `BRANCH` (usually `main`)
6. `ROOT_DOMAIN` (example `pengshz.cn`)
7. `APP_RR` (example `dingtalk`)
8. `APP_DOMAIN` (`<APP_RR>.<ROOT_DOMAIN>`, example `dingtalk.pengshz.cn`)
9. `LETSENCRYPT_EMAIL` (certificate contact email)

## Preferred Path: One-Command Deployment

Use script: `scripts/deploy_laika_full.sh`

### Local prerequisites

- `ssh`
- `curl`
- `aliyun` CLI (if DNS is not skipped)
- `python3` (used by script to parse DNS response)
- `expect` (only if using password login via `SSH_PASS`)

Quick check:

```bash
python3 --version
```

If this deployment also includes local device debugging, use this operator order:

1. Confirm `python3` on computer first.
2. Complete phone-side USB debugging authorization.
3. Return to computer and run `install_platform_tools.py` / `doctor`.

### Example

```bash
bash scripts/deploy_laika_full.sh \
  --server-ip 154.201.77.53 \
  --ssh-port 22737 \
  --ssh-user root \
  --repo-url https://github.com/UIxiaocainiao/DingTalkHybridDesktop.git \
  --branch main \
  --root-domain pengshz.cn \
  --app-rr dingtalk \
  --email pengshaozu0101@gmail.com
```

### Optional flags

- `--app-dir <path>` (default `/opt/dingtalk-automatic-check-in`)
- `--api-port <port>` (default `18000`)
- `--service-name <name>` (default `dingtalk-api-laika.service`)
- `--skip-dns` (skip Alibaba DNS changes)
- `--skip-https` (skip certbot issuance; verification uses HTTP)

### Authentication notes

- Preferred: SSH key login.
- Password mode:

```bash
export SSH_PASS='your_ssh_password'
bash scripts/deploy_laika_full.sh ...
```

## What the Script Does

In order:

1. Validates parameters and local dependencies.
2. Ensures Alibaba DNS record `<APP_DOMAIN> -> <SERVER_IP>` (unless `--skip-dns`).
3. SSH to server and installs/ensures `git`, `nginx`, `nodejs` (Node 20).
4. Clones or updates repo in app dir.
5. Runs `scripts/build_frontend_for_public.sh <APP_DOMAIN>`.
6. Writes and restarts `systemd` backend service.
7. Writes and enables Nginx site for `<APP_DOMAIN>`.
8. Issues HTTPS certificate via certbot (unless `--skip-https`).
9. Runs remote and local acceptance checks.

## Manual Fallback (No Script)

Use this only when script cannot be used.

### 1) Server bootstrap

```bash
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs certbot python3-certbot-nginx
```

### 2) Pull code and build frontend

```bash
APP_DIR=/opt/dingtalk-automatic-check-in
REPO_URL=<REPO_URL>
BRANCH=<BRANCH>
APP_DOMAIN=<APP_DOMAIN>

if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
  git -C "$APP_DIR" checkout "$BRANCH"
fi

cd "$APP_DIR"
bash scripts/build_frontend_for_public.sh "$APP_DOMAIN"
```

### 3) systemd backend service

Create `/etc/systemd/system/dingtalk-api-laika.service`:

```ini
[Unit]
Description=DingTalk API Server (Laika)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/dingtalk-automatic-check-in/backend
ExecStart=/usr/bin/python3 api_server.py --host 127.0.0.1 --port 18000
Restart=always
RestartSec=5
User=root
Environment=HOST=127.0.0.1
Environment=PORT=18000

[Install]
WantedBy=multi-user.target
```

Apply:

```bash
systemctl daemon-reload
systemctl enable --now dingtalk-api-laika.service
systemctl restart dingtalk-api-laika.service
```

### 4) Nginx site

Create `/etc/nginx/sites-available/<APP_DOMAIN>`:

```nginx
server {
  listen 80;
  listen [::]:80;
  server_name <APP_DOMAIN>;

  root /opt/dingtalk-automatic-check-in/frontend/dist;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:18000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

Enable:

```bash
ln -sfn /etc/nginx/sites-available/<APP_DOMAIN> /etc/nginx/sites-enabled/<APP_DOMAIN>
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl restart nginx
```

### 5) Alibaba DNS

Check existing record:

```bash
aliyun alidns DescribeSubDomainRecords --SubDomain <APP_DOMAIN> --DomainName <ROOT_DOMAIN>
```

Add A record if missing:

```bash
aliyun alidns AddDomainRecord \
  --DomainName <ROOT_DOMAIN> \
  --RR <APP_RR> \
  --Type A \
  --Value <SERVER_IP> \
  --TTL 600
```

Update if IP changed:

```bash
aliyun alidns UpdateDomainRecord \
  --RecordId <RECORD_ID> \
  --RR <APP_RR> \
  --Type A \
  --Value <SERVER_IP> \
  --TTL 600
```

Verify with DoH:

```bash
curl -fsSL "https://dns.google/resolve?name=<APP_DOMAIN>&type=A"
```

### 6) HTTPS issuance

```bash
certbot --nginx -d <APP_DOMAIN> --non-interactive --agree-tos -m <LETSENCRYPT_EMAIL> --redirect
```

## Acceptance Checklist (Must Pass)

Run on server:

```bash
systemctl is-enabled dingtalk-api-laika.service
systemctl is-active dingtalk-api-laika.service
systemctl is-enabled nginx
systemctl is-active nginx
curl -fsS http://127.0.0.1:18000/api/health
curl -fsS https://<APP_DOMAIN>/api/health
curl -fsSI https://<APP_DOMAIN>
```

Run from local (bypass polluted DNS):

```bash
curl -fsSI --resolve <APP_DOMAIN>:443:<SERVER_IP> https://<APP_DOMAIN>
curl -fsS  --resolve <APP_DOMAIN>:443:<SERVER_IP> https://<APP_DOMAIN>/api/health
```

## Daily Update Procedure

```bash
cd /opt/dingtalk-automatic-check-in
git fetch --all --prune
git checkout <BRANCH>
git pull --ff-only origin <BRANCH>
bash scripts/build_frontend_for_public.sh <APP_DOMAIN>
systemctl restart dingtalk-api-laika.service
systemctl reload nginx
curl -fsS https://<APP_DOMAIN>/api/health
```

## Rollback Procedure

```bash
cd /opt/dingtalk-automatic-check-in
git log --oneline -n 20
git reset --hard <GOOD_COMMIT_SHA>
bash scripts/build_frontend_for_public.sh <APP_DOMAIN>
systemctl restart dingtalk-api-laika.service
systemctl reload nginx
```

## Troubleshooting

1. Browser cannot open site, but `curl --resolve` succeeds.
Cause: local DNS pollution/interception.
Action: verify with `--resolve`; switch DNS resolver or temporary hosts override.

2. `/api/health` returns `502`.
Cause: backend service not running or wrong port.
Action: `systemctl status dingtalk-api-laika.service`; verify `127.0.0.1:18000` listening.

3. Certbot failed.
Cause: DNS not propagated or port 80 conflict.
Action: check `/var/log/letsencrypt/letsencrypt.log`, ensure DNS A record and Nginx `listen 80`.

4. Frontend loads but API points to old domain.
Cause: stale frontend build.
Action: rerun `bash scripts/build_frontend_for_public.sh <APP_DOMAIN>` and restart service.

## Definition of Done

Deployment is complete only when all are true:

1. `https://<APP_DOMAIN>/` returns HTTP `200`.
2. `https://<APP_DOMAIN>/api/health` contains `"ok": true`.
3. DNS DoH query returns `SERVER_IP`.
4. `dingtalk-api-laika.service` is `enabled` and `active`.
5. `nginx` is `enabled` and `active`.
6. TLS cert is valid and `certbot.timer` exists.
