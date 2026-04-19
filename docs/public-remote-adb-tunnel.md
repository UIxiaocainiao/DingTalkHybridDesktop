# 公网远程 ADB 接入方案（稳定版）

适用场景：后端部署在公网云服务器，手机不在同一局域网，需要长期稳定显示设备状态并执行自动化。

## 目标

1. 云服务器能访问一个稳定的 `host:port`（作为 `remote_adb_target`）。
2. 后端在首次进入页面时可自动连接，并在断线后自动恢复。
3. 即使无人操作页面，也能持续保活连接。

## 推荐架构

### 方案 A（推荐）：Tailscale

1. 云服务器安装并登录 Tailscale。
2. 手机端运行可提供 ADB over TCP 的端（或同网段中转机）也接入同一 Tailnet。
3. 在控制台配置 `remote_adb_target=<tailscale-ip>:5555`。

优点：NAT 穿透和网络稳定性较好，地址相对固定，运维成本低。

### 方案 B：FRP（frps + frpc）

1. 公网服务器部署 `frps`，开放例如 `7000`（控制）和 `15555`（映射 ADB）。
2. 手机侧同网段中转机运行 `frpc`，把本地 `5555` 映射到云端 `15555`。
3. 在控制台配置 `remote_adb_target=<公网服务器IP或域名>:15555`。

优点：可控性强；缺点是需要维护 FRP 进程和端口策略。

## 本项目内置能力（已支持）

1. 仪表盘自动连接：配置了 `remote_adb_target` 且当前无在线设备时，`GET /api/dashboard` 会自动尝试 `adb connect`。
2. 自动重试冷却：失败后进入冷却窗口，默认 30 秒后重试。
3. 配置开关：
  - 前台：`远程 ADB 自动连接`
  - 后端配置字段：`enable_auto_remote_adb_connect`
4. 环境变量：
  - `DINGTALK_AUTO_REMOTE_ADB_CONNECT=1|0`
  - `DINGTALK_AUTO_REMOTE_ADB_CONNECT_COOLDOWN_SECONDS=30`

## 无人值守保活（建议生产开启）

项目提供脚本：

```bash
REMOTE_ADB_TARGET=192.168.1.8:5555 \
ADB_BIN=/opt/dingtalk-automatic-check-in/backend/runtime/platform-tools/adb \
bash scripts/remote_adb_keepalive.sh
```

可配环境变量：

- `REMOTE_ADB_KEEPALIVE_INTERVAL_SECONDS`（默认 `30`）
- `REMOTE_ADB_KEEPALIVE_STARTUP_DELAY_SECONDS`（默认 `2`）
- `REMOTE_ADB_KEEPALIVE_RESTART_ADB_ON_FAILURE`（默认 `1`）

## systemd 托管

方式 1：使用安装脚本（推荐）

```bash
bash scripts/install_remote_adb_keepalive_service.sh \
  --target 192.168.1.8:5555 \
  --workdir /opt/dingtalk-automatic-check-in \
  --user www-data
```

方式 2：手动模板（保留）

```bash
sudo cp scripts/remote_adb_keepalive.service.example /etc/systemd/system/remote-adb-keepalive.service
# 然后手动修改 User / WorkingDirectory / REMOTE_ADB_TARGET / ADB_BIN
sudo systemctl daemon-reload
sudo systemctl enable --now remote-adb-keepalive.service
sudo systemctl status remote-adb-keepalive.service
```

## 排障顺序

1. 网络连通：云服务器到目标 `host:port` 必须可达。
2. ADB 服务：`adb devices` 能正常返回（非 daemon 错误）。
3. 手机授权：出现 `unauthorized` 时，在手机端确认无线调试授权。
4. 页面验证：进入“监控页面/设备管理”，查看 `remoteAdb.detail` 和设备状态。
5. 如需快速定位问题，可在前台执行“远程连通诊断”（对应 `POST /api/actions/adb-diagnose`）。
