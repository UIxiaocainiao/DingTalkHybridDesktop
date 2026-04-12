---
name: publish-skill
description: >-
  标准化执行生产发布，确保前端上线后不会命中旧缓存版本。Use when the user asks to
  deploy, publish, release, or push the latest code to production/public environment.
---
# 发布skill

## 适用场景

- 用户要求“发布到生产环境 / 公网环境 / 正式环境”
- 用户明确要求“线上必须是最新版本”
- 需要避免“旧 JS/CSS 指纹缓存导致线上不是最新代码”的问题

## 核心原则

1. 不只做部署，还要做缓存刷新与指纹一致性校验。
2. 前端发布统一使用仓库脚本，禁止手动拼接零散命令链。
3. 发布完成后必须给出可核验结果（域名、资源指纹、健康检查）。

## 标准发布流程

### 1) 前置检查

```bash
git status --short
npm --prefix frontend run build
```

### 2) 执行一键发布（标准命令）

```bash
bash scripts/deploy_frontend_with_cache_refresh.sh <frontend_domain> <railway_web_domain>
```

示例（当前项目）：

```bash
bash scripts/deploy_frontend_with_cache_refresh.sh \
  www.dingtalk.pengshz.cn \
  dingtalk-web-production.up.railway.app
```

该脚本会自动完成：
- Railway 前端发布（frontend 目录作为发布根）
- 刷新前端域名 CDN 缓存（首页 + index.html + 最新 js/css）
- 校验 frontend 域名与 railway 域名的资源指纹一致

### 3) 后端与联调验收

```bash
bash scripts/verify_public_deploy.sh <frontend_domain> <api_domain>
```

示例（当前项目）：

```bash
bash scripts/verify_public_deploy.sh \
  www.dingtalk.pengshz.cn \
  dingtalk-api-production.up.railway.app
```

## 故障处理

### A. Railway 构建失败

```bash
railway service status
railway logs --build <deployment_id> --lines 200
```

### B. 前端域名仍显示旧版本

1. 先重跑缓存刷新与一致性校验（不重复部署）：

```bash
bash scripts/deploy_frontend_with_cache_refresh.sh \
  <frontend_domain> \
  <railway_web_domain> \
  --skip-deploy
```

2. 再次检查资源指纹：

```bash
curl -sS https://<frontend_domain> | rg -o 'index-[A-Za-z0-9_-]+\.(js|css)'
curl -sS https://<railway_web_domain> | rg -o 'index-[A-Za-z0-9_-]+\.(js|css)'
```

## 输出要求（发布回报模板）

- 发布目标：`frontend_domain` / `api_domain`
- Railway Deployment ID 与状态（必须是 `SUCCESS`）
- 前端资源指纹（JS/CSS 文件名）
- 验收脚本结果（通过/失败）
- 如有异常：给出失败点和下一步动作

## 本项目默认参数（可直接套用）

- frontend_domain: `www.dingtalk.pengshz.cn`
- railway_web_domain: `dingtalk-web-production.up.railway.app`
- api_domain: `dingtalk-api-production.up.railway.app`

