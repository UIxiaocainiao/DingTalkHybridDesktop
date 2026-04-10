# DingTalk Scheduler

This directory contains the DingTalk automation files.

Files:
- `dingtalk_random_scheduler.py`: main background scheduler
- `com.pengshz.dingtalk-random-scheduler.plist`: LaunchAgent definition
- `logs/`: scheduler stdout and stderr logs

The active LaunchAgent entry in `~/Library/LaunchAgents/` is a symlink to the plist in this directory.
