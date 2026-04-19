# DingTalk Web 自动打卡控制台

基于 `React + Python + ADB` 的钉钉自动打卡网页控制台，支持上午/下午双时间窗口随机执行、工作日校验、设备连接管理、日志与记录管理。

## 功能亮点

- 双窗口随机调度：上午、下午独立配置，自动抽取下一次执行时间。
- 状态持久化：重启后保留排期和完成状态，避免同一窗口重复执行。
- 多种设备接入：支持本地 USB ADB 与远程 ADB/TCP。
- 可视化控制台：支持启动/停止调度、自检、试运行、日志与记录查看。

## 技术架构

```text
Frontend (React/Vite)
  └─ /api/*
Backend API (backend/api_server.py)
  ├─ 配置读写
  ├─ 调度进程管理（start/stop/run-once）
  └─ 健康检查与记录管理
Scheduler (backend/dingtalk_random_scheduler.py)
  ├─ ADB 设备交互
  ├─ 随机排期
  ├─ 工作日判断
  └─ 打卡记录持久化
```

## 项目结构

```text
DingTalkHybridDesktop/
├── frontend/                          # React 控制台
├── backend/                           # Python API + 调度器
├── scripts/                           # 辅助脚本
├── docs/                              # 项目文档
├── .github/workflows/                 # CI/CD
├── package.json                       # workspace 入口（仅 frontend）
└── README.md
```

## 环境要求

- Python `3.11+`
- Node.js `20+`
- 已安装并可用的 ADB（或通过控制台“在线安装 ADB”）
- Android 设备已开启 USB 调试并完成授权

## 快速开始

### 1. 克隆仓库

```bash
git clone git@github.com:UIxiaocainiao/DingTalkHybridDesktop.git
cd DingTalkHybridDesktop
```

### 2. 启动 Web 控制台（推荐）

```bash
npm install
npm run dev
```

访问：`http://127.0.0.1:5173`

说明：

- `npm run dev` 会同时启动前端（Vite）和后端（Python API）。
- 如需单独启动：`npm run dev:frontend` / `npm run dev:backend`。

## Scheduler CLI 常用命令

```bash
# 启动调度（默认）
python3 backend/dingtalk_random_scheduler.py run

# 调试模式
python3 backend/dingtalk_random_scheduler.py debug

# 查看状态
python3 backend/dingtalk_random_scheduler.py status

# 查看排期
python3 backend/dingtalk_random_scheduler.py schedule

# 环境自检
python3 backend/dingtalk_random_scheduler.py doctor

# 手动指定下一次执行时间
python3 backend/dingtalk_random_scheduler.py set-next --window morning --time 09:06:30
python3 backend/dingtalk_random_scheduler.py set-next --window evening --time 18:08:15
```

## Web API 概览

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/dashboard` | 控制台聚合数据 |
| GET | `/api/checkin-records` | 获取打卡记录 |
| POST | `/api/config` | 保存配置 |
| POST | `/api/actions/reroll` | 重新抽取执行时间 |
| POST | `/api/actions/doctor` | 执行后端自检 |
| POST | `/api/actions/adb-restart` | 重启 ADB server |
| POST | `/api/actions/run-once` | 立即执行一次 |
| POST | `/api/actions/start` | 启动调度 |
| POST | `/api/actions/stop` | 停止调度 |

## 配置文件

默认配置文件：`backend/runtime/console-config.json`

示例：

```json
{
  "serial": "",
  "remote_adb_target": "",
  "remote_adb_target_name": "",
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

## 关键环境变量

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

### Frontend

- `VITE_API_BASE_URL`
- `VITE_PLAYBACK_API_BASE_URL`（默认 `http://127.0.0.1:4000`）

## PlaybackE2E 平级项目联动

左侧导航现已支持平级项目切换：

- 自动钉钉打卡
- 自动刷视频（PlaybackE2E）

如需在本仓库内统一启动/检查 PlaybackE2E 相关服务，可使用：

```bash
# 安装 PlaybackE2E 前后端依赖
npm run playback:bootstrap

# 启动 PlaybackE2E 后台服务（frontend + backend）
npm run playback:start

# 查看运行状态
npm run playback:status

# 停止服务
npm run playback:stop
```

说明：

- 默认查找目录：`../PlaybackE2E`
- 可通过环境变量覆盖：`PLAYBACK_DIR=/absolute/path/to/PlaybackE2E`

## 测试

### API 完整性测试

```bash
python3 backend/test_api_integrity.py
```

## 部署参考

- 后端部署说明：`docs/deploy.md`
- API 说明：`docs/api.md`
- 设备接入说明：`docs/adb-device-setup.md`
- 项目结构说明：`docs/project-structure.md`

## 常见问题

- `adb not found`：在控制台点击“在线安装 ADB”，或在配置中指定 `adb_bin`。
- 设备 `unauthorized`：在手机上重新确认 USB 调试授权。
- 多设备冲突：在配置中显式设置 `serial`。
- 前端请求失败：确认 `backend/api_server.py` 正在运行，或检查 `VITE_API_BASE_URL`。

## 合规声明

本项目仅用于个人设备自动化与学习研究。请确保使用方式符合所在组织制度、平台规则和当地法律法规。

## License

MIT License. See [LICENSE](./LICENSE).
