# 部署说明

## 0) 一键拉取仓库代码

```bash
bash scripts/pull_repo.sh \
  --repo-url git@github.com:UIxiaocainiao/DingTalk-automatic-check-in.git \
  --branch main \
  --target-dir ./DingTalk-automatic-check-in
```

## 1) 一键部署到莱卡云

推荐使用一键部署脚本：

```bash
bash scripts/deploy_laika_full.sh --help
```

完整部署 skill 文档：`skills/laika-cloud-full-deploy/SKILL.md`
