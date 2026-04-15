# 部署说明

## 0) 一键拉取仓库代码

```bash
bash scripts/pull_repo.sh \
  --repo-url git@github.com:UIxiaocainiao/DingTalkHybridDesktop.git \
  --branch main \
  --target-dir ./DingTalkHybridDesktop
```

## 1) 一键部署到莱卡云

推荐使用一键部署脚本：

```bash
bash scripts/deploy_laika_full.sh --help
```

完整部署 skill 文档：`skills/laika-cloud-full-deploy/SKILL.md`

## 2) Railway / 容器部署补充

如果后端部署在 Railway 或其他会重建容器的环境，建议把运行时数据放到持久卷中：

1. 给后端服务挂载一个持久 Volume。
2. 挂载路径优先使用 `/app/backend/runtime`。
3. 如果挂载路径不是 `/app/backend/runtime`，设置环境变量：

```bash
DINGTALK_PLATFORM_TOOLS_DIR=<VOLUME_MOUNT_PATH>/platform-tools
```

说明：

- 网页端“在线安装 ADB”会把 platform-tools 下载到运行时目录。
- 若未使用持久卷，容器重建或重新部署后，已安装的 ADB 可能丢失。
