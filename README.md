# DingTalk Automatic Check-in Scheduler

基于 `Python + ADB` 的钉钉自动打卡调度系统，支持“上午/下午双时间窗口随机执行”、工作日判断、状态持久化、Web 控制台和运行日志/打卡记录管理。

## Features

- 双窗口随机调度：上午、下午窗口独立配置，自动抽取下一次执行时间。
- 状态持久化：重启后保留排期与完成状态，不会重复执行同一窗口。
- 设备连接管理：自动识别 ADB 设备，支持多设备提示与串号绑定。
- 工作日校验：可接入在线节假日接口，非工作日自动跳过并顺延。
- Web 控制台：配置参数、查看状态、启动/停止任务、手动试运行。
- 打卡记录中心：支持查看、筛选、导出与手动增删记录。
- 运行自检：内置 `doctor` 命令和 API 完整性测试脚本。

## Repository Structure

已按“基础版”完成目录整理，当前结构如下：

```text
DingTalkHybridDesktop/
├── frontend/                          # 前端页面
│   ├── public/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── router/
│   │   ├── api/
│   │   ├── store/
│   │   ├── utils/
│   │   ├── styles/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   ├── vite.config.js
│   └── README.md
├── backend/                           # 后端服务
│   ├── src/                           # 基础版 Node 分层骨架（迁移预留）
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── middleware/
│   │   ├── services/
│   │   ├── jobs/
│   │   ├── utils/
│   │   ├── app.js
│   │   └── server.js
│   ├── api_server.py                  # 当前生产后端入口（Python）
│   ├── dingtalk_random_scheduler.py   # 调度器（Python）
│   ├── package.json                   # 结构对齐占位
│   └── README.md
├── scripts/                           # 运维脚本 / 启动脚本
│   ├── start-frontend.sh
│   ├── start-backend.sh
│   ├── deploy.sh
│   ├── backup.sh
│   └── ...
├── database/
│   ├── schema.sql
│   ├── seed.sql
│   └── migrations/
├── docs/
│   ├── api.md
│   ├── deploy.md
│   ├── adb-device-setup.md
│   └── project-structure.md
├── docker-compose.yml
├── nginx.conf
├── README.md
└── LICENSE
```

说明：

- 现网运行链路保持不变（`backend/api_server.py` + `frontend/src/App.jsx`）。
- `backend/src/**` 是按基础版目录补齐的迁移骨架，不参与当前生产运行。

## Architecture

```text
Frontend (React/Vite)
  └─ calls /api/*
Backend API (api_server.py)
  ├─ manages scheduler process (start/stop/run-once)
  ├─ reads/writes runtime config & state
  └─ delegates to scheduler CLI/runtime
Scheduler (dingtalk_random_scheduler.py)
  ├─ ADB / scrcpy interaction
  ├─ random window scheduling
  ├─ workday check
  └─ check-in record persistence
```

## Prerequisites

- Python `3.11+`
- Node.js `20+`（推荐）
- Android 设备已开启 USB 调试并完成授权
- 运行 ADB 的机器必须能实际访问该手机：
  - 最常见是手机通过 USB 连接到这台机器
  - 或者已经配置好远程 ADB/TCP 连接
- macOS/Linux/Windows（ADB 可用即可）

> 后端依赖 Python 标准库；前端依赖通过 `npm install` 安装。

## Quick Start

### 一键拉取仓库代码（首次 clone / 后续 pull）

```bash
bash scripts/pull_repo.sh \
  --repo-url git@github.com:UIxiaocainiao/DingTalkHybridDesktop.git \
  --branch main \
  --target-dir ./DingTalkHybridDesktop
```

如需在当前目录更新：

```bash
bash scripts/pull_repo.sh \
  --repo-url git@github.com:UIxiaocainiao/DingTalkHybridDesktop.git \
  --branch main \
  --target-dir .
```

### 0) 云服务器先准备 Python3（部署时完成）

```bash
python3 --version
```

若云服务器不存在请先安装：

- macOS: `brew install python`
- Ubuntu/Debian: `sudo apt-get update && sudo apt-get install -y python3`

### 1) 手机端先准备

- 开启开发者模式
- 开启 USB 调试
- 连接电脑后在手机端点击“允许 USB 调试”

### 2) 在网页端安装 ADB

- 登录控制台后点击“在线安装 ADB”。
- 安装动作会在当前云服务器执行，不需要本地终端手动运行脚本。
- 这一步只解决“服务器有没有 ADB”，不解决“服务器能不能看到你的手机”。
- 如果手机实际上插在你本地电脑上，而后端跑在 Railway/云服务器，那么仅安装 ADB 仍然无法发现设备。

### 3) 在网页端执行自检

- 安装完成后点击“一键自检”。
- 设备状态显示为 `device` 时，再继续试运行或正式启动。

### 4) 设备接入约束

- 如果后端运行在云服务器，手机也必须接在这台云服务器可访问的设备连接器环境上。
- Railway 这类托管容器通常不能直接访问你本地电脑上的 USB 手机。
- 如果你要保留云端控制台，常见可行方案只有两类：
  - 后端和手机放在同一台可直连 USB 的机器上
  - 先自行打通远程 ADB/TCP，再把该地址交给运行中的 ADB 环境

远程 ADB/TCP 的最小接入顺序：

1. 在控制台保存 `remote_adb_target=host:port`
2. 可选填写 `remote_adb_target_name=设备别名`
3. 点击“连接远程 ADB”
4. 点击“刷新设备状态”
5. 确认 dashboard 中设备状态进入 `device`

常见两种远程接入方式：

1. Android 11+ 无线调试：直接在手机开发者选项里拿到无线调试地址，再填入 `remote_adb_target`
2. 传统 `adb tcpip 5555`：先 USB 授权，再把手机切到 TCP 模式，最后填 `手机IP:5555`

更详细步骤见 [docs/adb-device-setup.md](/Users/pengshz/DingTalkHybridDesktop/docs/adb-device-setup.md)。

### 5) 启动后端 API

```bash
python3 backend/api_server.py
```

默认监听：`http://127.0.0.1:8000`

### 5) 启动前端控制台

```bash
cd frontend
npm install
npm run dev
```

默认访问：`http://127.0.0.1:5173`

本地开发时，Vite 已将 `/api` 代理到 `http://127.0.0.1:8000`。

## Scheduler CLI Usage

### 常用命令

```bash
# 启动调度（默认命令）
python3 backend/dingtalk_random_scheduler.py run

# 调试模式（不会隐式启用 scrcpy 观察）
python3 backend/dingtalk_random_scheduler.py debug

# 查看当前排期和设备状态
python3 backend/dingtalk_random_scheduler.py status

# 仅查看排期
python3 backend/dingtalk_random_scheduler.py schedule

# 环境自检
python3 backend/dingtalk_random_scheduler.py doctor

# 手动指定下一次执行时间
python3 backend/dingtalk_random_scheduler.py set-next --window morning --time 09:06:30
python3 backend/dingtalk_random_scheduler.py set-next --window evening --time 18:08:15
```

### 关键参数

- `--serial`：指定设备序列号（多设备场景必填）。
- `--adb-bin` / `--scrcpy-bin`：指定绝对路径。
- `--enable-scrcpy-watch`：设备重连后自动拉起 scrcpy。
- `--state-file`：调度状态文件路径。
- `--config-file`：运行配置文件路径（默认 `backend/runtime/console-config.json`）。
- `--disable-workday-check`：禁用工作日校验。
- `--workday-api-url` / `--workday-api-timeout`：工作日接口配置。
- `--notify-on-success`：窗口执行成功后触发 macOS 通知。

## Web API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/dashboard` | 控制台聚合数据（状态/排期/日志/告警） |
| GET | `/api/checkin-records` | 获取打卡记录 |
| POST | `/api/config` | 保存配置与下一次执行时间 |
| POST | `/api/actions/reroll` | 重新抽取上午/下午下一次执行时间 |
| POST | `/api/actions/doctor` | 执行后端 `doctor` |
| POST | `/api/actions/adb-restart` | 重启 ADB server |
| POST | `/api/actions/run-once` | 立即执行一次动作链路 |
| POST | `/api/actions/start` | 启动调度进程（`run`/`debug`） |
| POST | `/api/actions/stop` | 停止调度进程 |
| POST | `/api/checkin-records` | 手动新增记录 |
| POST | `/api/checkin-records/delete` | 按索引删除记录 |

## Runtime Configuration

控制台配置文件默认位置：`backend/runtime/console-config.json`

示例：

```json
{
  "serial": "",
  "package": "com.alibaba.android.rimet",
  "app_label": "钉钉",
  "delay_after_launch": 5,
  "poll_interval": 5,
  "scrcpy_launch_cooldown": 15,
  "state_file": "backend/logs/dingtalk-random-scheduler.state.json",
  "workday_api_url": "https://holiday.dreace.top?date={date}",
  "workday_api_timeout_ms": 5000,
  "enable_scrcpy_watch": false,
  "notify_on_success": false,
  "enable_workday_check": true,
  "adb_bin": "",
  "scrcpy_bin": "",
  "windows": {
    "morning": { "start": "09:05", "end": "09:10" },
    "evening": { "start": "18:05", "end": "18:15" }
  }
}
```

## Environment Variables

### Backend API

- `HOST`（默认 `127.0.0.1`）
- `PORT`（默认 `8000`）
- `DINGTALK_CONSOLE_CONFIG_FILE`
- `DINGTALK_CONSOLE_PROCESS_FILE`
- `DINGTALK_CONSOLE_LOG_FILE`
- `DINGTALK_CONSOLE_ERR_LOG_FILE`
- `DINGTALK_CONSOLE_CHECKIN_RECORDS_FILE`

### Scheduler

- `DINGTALK_PLATFORM_TOOLS_DIR`
- `DINGTALK_ADB_BIN`
- `DINGTALK_SCRCPY_BIN`

`DINGTALK_PLATFORM_TOOLS_DIR` 用于控制 ADB/platform-tools 的安装与查找目录。
在 Railway 上，如果服务挂载了 Volume，运行时会自动提供 `RAILWAY_VOLUME_MOUNT_PATH`；当前项目会优先把 platform-tools 安装到该挂载目录下的 `platform-tools/`，这样重部署后不会丢失。

### Frontend

- `VITE_API_BASE_URL`（生产环境推荐显式配置）

## Testing

### API 完整性测试

```bash
python3 backend/test_api_integrity.py
```

该脚本会创建隔离临时目录并自动清理，不影响正式配置。

## Deployment

### Backend (Railway / Container)

`backend/Dockerfile` 已提供基础镜像与启动命令。

推荐启动命令：

```bash
python3 api_server.py --host 0.0.0.0 --port ${PORT:-8000}
```

健康检查：`/api/health`

如果部署在 Railway，建议：

- 给后端服务挂载一个 Volume。
- 挂载路径优先使用 `/app/backend/runtime`。
- 若使用其他挂载路径，显式设置 `DINGTALK_PLATFORM_TOOLS_DIR=<你的挂载路径>/platform-tools`。

这样网页端“在线安装 ADB”下载的 platform-tools 才能在重部署后保留。

### Frontend Build

```bash
cd frontend
npm install
npm run build
```

或使用脚本自动写入生产 API 域名并构建：

```bash
bash scripts/build_frontend_for_public.sh api.example.com
```

### 公网发布与 CDN 刷新

```bash
bash scripts/deploy_frontend_with_cache_refresh.sh <frontend_domain> <railway_domain>
```

发布验收：

```bash
bash scripts/verify_public_deploy.sh <frontend_domain> <api_domain>
```

## macOS LaunchAgent (Optional)

项目提供模板：`backend/com.pengshz.dingtalk-random-scheduler.plist`

使用前请将模板中的 `/ABSOLUTE/PATH/TO/...` 替换为你的绝对路径，然后通过 `launchctl` 加载。

## Troubleshooting

- `adb not found`：在控制台点击“在线安装 ADB”，或在前台配置 `adb_bin`。
- `unauthorized`：手机上确认 USB 调试授权，必要时重插 USB。
- 多设备冲突：在配置中显式填写 `serial`。
- 非工作日不执行：检查 `enable_workday_check` 与工作日接口返回。
- 前端请求失败：确认后端 API 已启动，或检查 `VITE_API_BASE_URL`。

## Security & Compliance

- 本项目仅用于个人设备自动化与学习研究。
- 请确保你的使用方式符合公司制度、钉钉平台规则及所在地区法律法规。
- 建议在受控测试设备上先验证，再用于长期运行环境。

## License

MIT License. See [LICENSE](./LICENSE).
