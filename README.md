# DingTalk Automatic Scheduler

这个目录现在不只是“自动拉起脚本”，而是一个更完整的后台自动化服务，重点优化了三件事：

- 调度稳定：每日随机时间会持久化，进程重启后不会重新抽签。
- 流程透明：增加了 `status`、`schedule`、`doctor` 命令，不需要翻日志猜当前状态。
- 生产和调试分离：正式运行默认只依赖 `adb`，只有调试模式才启用 `scrcpy`。
- 工作日感知：自动打卡前会联网判断今天是否为中国工作日，节假日和休息日自动跳过。

## Files

- `dingtalk_random_scheduler.py`: 主脚本，支持 `run / debug / status / schedule / doctor`
- `com.pengshz.dingtalk-random-scheduler.plist`: macOS LaunchAgent 定义
- `logs/`: 日志目录

当前 `~/Library/LaunchAgents/` 中使用的 LaunchAgent 仍然是指向本目录 plist 的软链接。

## Commands

查看当前固定排期：

```bash
python3 dingtalk_random_scheduler.py schedule
```

查看当前排期 + 设备状态：

```bash
python3 dingtalk_random_scheduler.py status
```

做一次环境自检：

```bash
python3 dingtalk_random_scheduler.py doctor
```

作为后台服务运行，默认只走 `adb`，不拉起 `scrcpy`：

```bash
python3 dingtalk_random_scheduler.py run
```

如果你在排查问题，想看手机镜像和重连行为：

```bash
python3 dingtalk_random_scheduler.py debug
```

如果你想在 `run` 模式下临时启用 `scrcpy` 观察：

```bash
python3 dingtalk_random_scheduler.py run --enable-scrcpy-watch
```

如果你想在每次计划执行成功后收到 macOS 通知：

```bash
python3 dingtalk_random_scheduler.py run --notify-on-success
```

如果你想关闭联网工作日判断：

```bash
python3 dingtalk_random_scheduler.py run --disable-workday-check
```

## State

脚本会把调度状态保存到：

```text
logs/dingtalk-random-scheduler.state.json
```

这个文件记录：

- 下一个 morning / evening 的固定执行时间
- 每个窗口最近一次成功完成的日期
- 最近一次联网工作日判断的结果

这样即使 LaunchAgent 重启进程，也不会打乱当天计划。

## Workday Check

正式运行时，脚本会先查询中国工作日接口：

```text
https://holiday.dreace.top?date=YYYY-MM-DD
```

行为规则：

- 如果今天是中国工作日，按正常计划执行。
- 如果今天不是工作日，今天的 morning / evening 计划会自动顺延，不执行打卡动作。
- 如果接口临时失败，脚本默认继续按本地计划运行，避免因为网络波动导致漏打卡。
