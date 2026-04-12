# 钉钉自动打卡调度器

一个基于 `Python + ADB` 的自动打卡项目。  
核心目标：在设定时间窗口内随机执行打卡，支持工作日判断、状态持久化和可视化前端配置。

## 项目结构

- `backend/`：后端项目（调度脚本、HTTP API、LaunchAgent、日志）
  - `backend/dingtalk_random_scheduler.py`
  - `backend/api_server.py`
  - `backend/com.pengshz.dingtalk-random-scheduler.plist`
  - `backend/logs/`
  - `backend/runtime/`
- `frontend/`：前端项目（React 控制台）

## 这个项目怎么工作

1. 启动脚本后，读取/生成今日排期（上午、下午各一个随机时间）。
2. 到达排期时，通过 ADB 拉起钉钉并执行打卡流程。
3. 执行结果写入日志和状态文件，避免重启后重复抽签。
4. 可选：调用在线 API 判断是否为中国工作日，非工作日自动跳过。

## 快速开始（4 步）

### 1) 环境准备

- Python 3.11+
- ADB 可用（`adb version`）
- Android 设备已开启 USB 调试并授权（`adb devices`）

### 2) 先做环境自检

```bash
python3 backend/dingtalk_random_scheduler.py doctor
```

### 3) 启动控制台 API

```bash
python3 backend/api_server.py
```

默认监听：`http://127.0.0.1:8000`

### 4) 启动前端控制台

```bash
cd frontend
npm install
npm run dev
```

Vite 已配置 `/api` 代理到本地 `8000` 端口。前端页面打开后会直接读取后端真实状态、排期、日志和告警。

## 常用命令

```bash
# 运行调度器
python3 backend/dingtalk_random_scheduler.py run

# 调试模式（含 scrcpy 观察）
python3 backend/dingtalk_random_scheduler.py debug

# 查看状态
python3 backend/dingtalk_random_scheduler.py status

# 查看排期
python3 backend/dingtalk_random_scheduler.py schedule

# 手动指定下一次执行时间（HH:MM 或 HH:MM:SS）
python3 backend/dingtalk_random_scheduler.py set-next --window morning --time 09:06:30
python3 backend/dingtalk_random_scheduler.py set-next --window evening --time 18:08:15

# 启动本地控制台 API
python3 backend/api_server.py
```

## 常用参数

```bash
# 开启 scrcpy 重连观察
--enable-scrcpy-watch

# 打卡成功后发送 macOS 通知
--notify-on-success

# 禁用工作日检查（每天都执行）
--disable-workday-check
```

## 默认配置（当前代码）

- 时间窗口（`WINDOWS`）：
  - `morning`: `09:05-09:10`
  - `evening`: `18:05-18:15`
- 状态文件：`backend/logs/dingtalk-random-scheduler.state.json`
- 轮询间隔：`5s`
- 启动后停留时长：`5s`
- 工作日 API：`https://holiday.dreace.top?date={date}`
- 控制台配置文件：`backend/runtime/console-config.json`（前端保存配置后生成）

## 前端控制台与后端的关系

前端不是直接执行 ADB，而是通过本地 HTTP API 调用后端现有能力：

- `GET /api/dashboard`
  - 返回设备状态、排期、日志、告警、工作日结果、当前进程状态
- `POST /api/config`
  - 保存前端页面中的基础参数、布尔开关和下一次执行时间
- `POST /api/actions/doctor`
  - 执行后端 `doctor`
- `POST /api/actions/start`
  - 启动后端 `run` 或 `debug`
- `POST /api/actions/stop`
  - 停止当前受控调度进程
- `POST /api/actions/run-once`
  - 立即执行一次动作链路
- `POST /api/actions/reroll`
  - 重新抽取上午 / 下午下一次执行时间

前端页面里保存的配置会落到 `backend/runtime/console-config.json`，后端调度脚本启动时会优先读取这个文件。如果文件还不存在，第一次从前端保存配置时会自动生成。

## 接口完整性测试

可以执行下面这条命令，对本地控制台 API 跑一轮端到端完整性检查：

```bash
python3 backend/test_api_integrity.py
```

这个脚本会：

- 使用临时配置文件和临时日志目录
- 启动一份隔离的本地 API 服务
- 校验 `health / dashboard / config / reroll / doctor / run-once / start / stop` 等主接口
- 测试完成后自动清理临时环境，不覆盖正式运行配置

## 单独运行前端控制台

```bash
cd frontend
npm install
npm run dev
```

## 公网部署（阿里云域名 + 七牛前端 + Railway 后端）

目标建议：

- `www.example.com` -> 七牛静态站（前端）
- `api.example.com` -> Railway（后端 API）

### 1) Railway 部署后端

在 Railway 新建服务并连接仓库后，设置：

- Root Directory: `backend`
- Start Command: `python3 api_server.py --host 0.0.0.0 --port ${PORT:-8000}`
- Health Check: `/api/health`

部署完成后先确认 `https://<railway-domain>/api/health` 可访问，再绑定 `api.example.com`。

### 2) 前端改用公网 API 并打包

生产构建前，在 `frontend/` 下创建 `.env.production`（可参考 `.env.production.example`）：

```bash
VITE_API_BASE_URL=https://api.example.com
```

然后打包：

```bash
cd frontend
npm install
npm run build
```

构建产物目录：`frontend/dist`。

也可以直接用脚本自动写入并构建：

```bash
bash scripts/build_frontend_for_public.sh api.example.com
```

### 3) 七牛上传前端静态资源

- 创建公开读空间
- 上传 `frontend/dist` 里的所有文件
- 配置静态首页 `index.html`（可选配置 404）
- 绑定 `www.example.com` 并开启 HTTPS

### 4) 阿里云 DNS 解析

在阿里云云解析中添加：

- `www` CNAME -> 七牛提供的目标域名
- `api` CNAME -> Railway 提供的目标域名

生效后即可通过公网访问前后端。

### 5) 一键验收（可选）

可使用脚本快速检查前后端公网可用性：

```bash
bash scripts/verify_public_deploy.sh www.example.com api.example.com
```

可配合 `DEPLOY_PUBLIC_TEMPLATE.md` 记录你的实际部署参数。

## macOS 后台自启动（可选）

```bash
ln -s "$(pwd)/backend/com.pengshz.dingtalk-random-scheduler.plist" ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.pengshz.dingtalk-random-scheduler.plist
```

使用前请先把 plist 里的 `/ABSOLUTE/PATH/TO/...` 替换成你自己的项目绝对路径。

常用管理命令：

```bash
launchctl start com.pengshz.dingtalk-random-scheduler
launchctl stop com.pengshz.dingtalk-random-scheduler
launchctl unload ~/Library/LaunchAgents/com.pengshz.dingtalk-random-scheduler.plist
```

## 日志与状态

- 运行日志：`backend/logs/dingtalk-random-scheduler.log`
- 错误日志：`backend/logs/dingtalk-random-scheduler.err.log`
- 排期状态：`backend/logs/dingtalk-random-scheduler.state.json`（运行后生成）
- 控制台配置：`backend/runtime/console-config.json`
- 受控进程记录：`backend/logs/dingtalk-random-scheduler.process.json`

## License

MIT
