# API 文档（当前 Python 后端）

- 健康检查: `GET /api/health`
- 控制台聚合: `GET /api/dashboard`
- 配置保存: `POST /api/config`
  - `config.recent_remote_adb_targets` 会保留最近使用过的远程目标列表，结构为 `[{ "name": "...", "target": "host:port" }]`
  - `config.remote_adb_target_name` 可为当前远程目标设置显示名称
  - `config.enable_auto_remote_adb_connect` 控制是否在 `GET /api/dashboard` 阶段自动尝试远程 ADB 连接（默认开启）
- 打卡记录: `GET /api/checkin-records`, `POST /api/checkin-records`, `POST /api/checkin-records/delete`
- 动作接口:
  - `POST /api/actions/reroll`
  - `POST /api/actions/doctor`
  - `POST /api/actions/adb-install`
  - `POST /api/actions/adb-connect`
  - `POST /api/actions/adb-disconnect`
  - `POST /api/actions/adb-diagnose`
  - `POST /api/actions/remote-adb-targets/delete`
  - `POST /api/actions/adb-restart`
  - `POST /api/actions/run-once`
  - `POST /api/actions/start`
  - `POST /api/actions/stop`

## POST /api/actions/adb-install

- 用途：在当前服务器执行 `scripts/install_platform_tools.py`，安装官方 Android platform-tools。
- 成功：返回 `message` 和 `detail`，并附带最新 `dashboard`。
- 失败：通常是服务器网络无法下载、安装目录无写权限，或脚本执行失败。

## POST /api/actions/adb-connect

- 用途：对已保存的 `remote_adb_target` 执行 `adb connect`。
- 前置条件：配置中已保存 `remote_adb_target`，格式通常为 `host:port`。
- 成功：返回 `message` 和 `detail`，并附带最新 `dashboard`。
- 失败：常见原因是目标为空、网络不通、端口不可达，或目标设备未开启无线调试/ADB TCP。

## POST /api/actions/adb-disconnect

- 用途：对已保存的 `remote_adb_target` 执行 `adb disconnect`。
- 前置条件：配置中已保存 `remote_adb_target`。
- 成功：返回 `message` 和 `detail`，并附带最新 `dashboard`。
- 失败：常见原因是目标为空，或 ADB 本身不可用。

## POST /api/actions/adb-diagnose

- 用途：对当前 `remote_adb_target` 执行链路诊断（目标格式、DNS 解析、TCP 可达性、adb 设备列表状态）。
- 成功：返回 `message`、`detail`，并附带 `diagnostics` 结构化结果和最新 `dashboard`。
- 失败：常见原因是未配置 `remote_adb_target` 或目标格式不合法。

## POST /api/actions/remote-adb-targets/delete

- 用途：从 `config.recent_remote_adb_targets` 中删除一个历史目标。
- 请求体：`{"target":"host:port"}`
- 成功：返回 `message` 和 `detail`，并附带最新 `dashboard`。
- 说明：如果删除的是当前 `remote_adb_target`，后端会同时清空当前目标值。

## 时间字段约定

- 后端运行与记录时间统一按北京时间生成。
- 原始字段继续保留，便于程序处理：
  - `generatedAt`
  - `startedAt`
  - `checkedAt`
  - `selectedAt`
  - `date`
  - `completed`
- 展示字段统一补充 `Label` 版本，供前端直接显示：
  - `generatedAtLabel`
  - `startedAtLabel`
  - `checkedDateLabel`
  - `checkedAtLabel`
  - `selectedAtLabel`
  - `completedLabel`
  - `dateLabel`
  - `timeLabel`
- `*Label` 字段会直接带上 `北京时间` 文案，例如：
  - `2026-04-15 09:06:12 北京时间`
  - `2026-04-15 北京时间`
  - `04-15 09:06 北京时间`

## GET /api/dashboard

关键时间相关字段如下：

- `generatedAt`: 仪表盘生成时间
- `generatedAtLabel`: 仪表盘生成时间的北京时间展示值
- `scheduler.startedAt`: 调度进程启动时间
- `scheduler.startedAtLabel`: 调度进程启动时间的北京时间展示值
- `workday.checkedDate`: 最近一次工作日校验日期
- `workday.checkedDateLabel`: 最近一次工作日校验日期的北京时间展示值
- `workday.checkedAt`: 最近一次工作日校验时间
- `workday.checkedAtLabel`: 最近一次工作日校验时间的北京时间展示值
- `windows[].selectedAt`: 窗口下一次执行时间
- `windows[].selectedAtLabel`: 窗口下一次执行时间的北京时间展示值
- `windows[].completed`: 窗口最近完成日期
- `windows[].completedLabel`: 窗口最近完成日期的北京时间展示值
- `lastSuccess.date`: 最近成功执行日期
- `lastSuccess.dateLabel`: 最近成功执行日期的北京时间展示值
- `remoteAdb.target`: 最近一次远程 ADB 动作对应的目标
- `remoteAdb.action`: 最近一次远程 ADB 动作，`connect` 或 `disconnect`
- `remoteAdb.ok`: 最近一次远程 ADB 动作是否成功
- `remoteAdb.detail`: 最近一次远程 ADB 动作结果说明
- `remoteAdb.checkedAt`: 最近一次远程 ADB 动作时间
- `remoteAdb.checkedAtLabel`: 最近一次远程 ADB 动作时间的北京时间展示值
- `device.autoRemoteAdbConnectEnabled`: 是否开启“无在线设备时自动尝试远程 ADB 连接”
- `device.autoRemoteAdbConnectNote`: 本次自动连接的结果说明（成功、失败或冷却提示）
- `config.remote_adb_target_name`: 当前远程目标的显示名称，例如 `办公室测试机`
- `config.recent_remote_adb_targets`: 最近使用过的远程目标对象列表，按最近使用排序
  - 结构为 `[{ "name": "办公室测试机", "target": "192.168.1.8:5555" }]`
- `logs[].time`: 日志短时间
- `logs[].timeLabel`: 日志短时间的北京时间展示值
