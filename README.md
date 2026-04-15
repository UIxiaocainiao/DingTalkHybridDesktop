# DingTalk Hybrid Desktop 自动打卡助手

基于 `Electron + React + Python + ADB` 的钉钉自动打卡桌面应用，支持上午/下午双时间窗口随机执行、工作日校验、设备连接管理、日志与记录管理。

## 功能亮点

- 双窗口随机调度：上午、下午独立配置，自动抽取下一次执行时间。
- 状态持久化：重启后保留排期和完成状态，避免同一窗口重复执行。
- 多种设备接入：支持本地 USB ADB 与远程 ADB/TCP。
- 可视化控制台：支持启动/停止调度、自检、试运行、日志与记录查看。
- 桌面化能力：Electron 托盘、后台运行、安装包分发。
- 自动发布：推送 `v*` 标签后自动构建 macOS/Windows 安装包并上传 Release。

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
Desktop Shell (desktop/*)
  ├─ Electron 主进程
  ├─ 后端拉起与守护
  └─ 托盘与本地运行时桥接
```

## 项目结构

```text
DingTalkHybridDesktop/
├── desktop/                           # Electron 桌面端
│   ├── main/
│   ├── preload/
│   ├── assets/
│   ├── package.json
│   └── electron-builder.json
├── frontend/                          # React 控制台
├── backend/                           # Python API + 调度器
├── scripts/                           # 辅助脚本
├── docs/                              # 项目文档
├── .github/workflows/                 # CI/CD（含 release-desktop.yml）
├── package.json                       # workspace 入口
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

### 2. 启动桌面联调模式（推荐）

```bash
npm install --prefix frontend
npm install --prefix desktop
npm run dev --prefix desktop
```

该模式会同时启动：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:8000`
- Electron 桌面窗口

### 3. 仅启动 Web 模式（可选）

```bash
python3 backend/api_server.py
npm install --prefix frontend
npm run dev --prefix frontend
```

### 4. 构建桌面安装包

```bash
npm run dist --prefix desktop
```

产物目录：`desktop/release/`

## GitHub Release 自动发布

### 工作流说明

- 工作流文件：`.github/workflows/release-desktop.yml`
- 触发条件：推送标签 `v*`（例如 `v1.0.1`）
- 产物：
  - macOS：`.dmg`
  - Windows：`.exe`

### 发布步骤

```bash
git tag v1.0.2
git push origin v1.0.2
```

发布完成后，到 GitHub Actions 查看 `Release Desktop Installers`，安装包会自动上传到对应 Release。

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
- Release 无安装包：确认推送的是 `v*` 标签，并检查 Actions 中 `Release Desktop Installers` 是否成功。

## 合规声明

本项目仅用于个人设备自动化与学习研究。请确保使用方式符合所在组织制度、平台规则和当地法律法规。

## License

MIT License. See [LICENSE](./LICENSE).
