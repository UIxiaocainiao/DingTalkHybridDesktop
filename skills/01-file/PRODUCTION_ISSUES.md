# 生产环境问题记录

## 2026-04-13 17:42 CST 排查记录

检查对象：
- 前端公网域名：`https://www.dingtalk.pengshz.cn`
- Railway 前端源站配置参数：`https://dingtalk-web-production.up.railway.app`
- Railway API：`https://dingtalk-api-production.up.railway.app`
- Railway 当前 CLI 链接：project `perceptive-fulfillment` / environment `production` / service `dingtalk-web`

### 结论

1. 前端公网域名当前不可正常渲染。
   - 首页 HTML 可访问，返回 `200`。
   - 首页引用的静态资源不可访问：
     - `https://www.dingtalk.pengshz.cn/assets/index-CeYyhsxp.js` 返回 `404`
     - `https://www.dingtalk.pengshz.cn/assets/index-DCSFO2Y0.css` 返回 `404`
   - 404 响应体是后端 API 风格：`{"ok": false, "message": "未找到接口: /assets/..."}`。
   - 影响：浏览器加载首页时 JS/CSS 缺失，页面大概率空白或无法进入控制台。

2. `dingtalk-web-production.up.railway.app` 现在实际指向后端 API，不是前端静态站。
   - `https://dingtalk-web-production.up.railway.app/` 返回 `404`，响应体：`{"ok": false, "message": "未找到接口: /"}`
   - `https://dingtalk-web-production.up.railway.app/api/health` 返回 `200`。
   - 影响：仓库发布脚本中用于 `railway_web_domain` 的默认值当前不是有效前端源站，CDN 回源到该域名会拿到后端 API 的 404。

3. 生产 API 健康检查通过，但业务运行状态异常。
   - `https://dingtalk-api-production.up.railway.app/api/health` 返回 `{"ok": true, ...}`。
   - `dashboard` 返回：
     - 调度器 `running: false`
     - 设备连接器 `adbAvailable: false`
     - `scrcpyAvailable: false`
     - 设备数 `deviceCount: 0`
     - 告警包含“调度器未启动”和“设备连接器异常”
   - 生产配置中的 `state_file` 仍是本机路径：`/Users/pengshz/DingTalkHybridDesktop/backend/logs/dingtalk-random-scheduler.state.json`。
   - 影响：即使 API 可访问，也无法执行钉钉打卡任务；需要在可访问本机 ADB/USB 设备的设备连接器环境运行，或修正生产环境变量/配置。

4. 原有 `scripts/verify_public_deploy.sh` 会误判通过，现已补强。
   - 补强前执行结果：脚本通过。
   - 原因：脚本只检查 API health、前端 HTML 和 CORS，没有检查 HTML 中引用的 JS/CSS 是否返回 `200`。
   - 补强后复测结果：脚本失败在 `https://www.dingtalk.pengshz.cn/assets/index-CeYyhsxp.js`，返回 `404`。

### 进一步排查结论

1. Railway `dingtalk-web` 服务被部署成后端 API。
   - `railway logs --build f6d10efd-b9da-4cdc-94e7-1b5f67df8dbe --lines 200` 显示构建使用 `python:3.11-slim` Dockerfile。
   - `railway logs --lines 100` 显示容器启动日志为 `DingTalk console API listening on http://0.0.0.0:8080`。
   - `railway logs --http --status 404 --lines 20` 能看到 `/assets/index-*.js` 和 `/assets/index-*.css` 请求打到了该 Railway 服务并返回 `404`。

2. `www.dingtalk.pengshz.cn` 是七牛 CDN 域名，但当前回源链路指向已经变成后端的 `dingtalk-web`。
   - DNS CNAME：`www.dingtalk.pengshz.cn` -> `www-dingtalk-pengshz-cn-idvrchc.qiniudns.com`。
   - 首页返回头包含 `X-Qnm-Cache: Hit`，说明 HTML 是七牛缓存命中。
   - 静态资源 404 返回头包含 `X-Qnm-Cache: Miss` 和 `X-Railway-Request-Id`，说明资源未命中七牛缓存后回源到了 Railway 后端 API。

3. 七牛 bucket 内容与线上缓存、本地构建存在三套不同版本。
   - 可疑 bucket：`dingtalkpengshzz2`，公有空间，`index.html` 上传时间为 `2026-04-12 16:08:01 +0800`。
   - bucket 里存在旧资源：
     - `assets/index-Bz5wS6Hh.js`
     - `assets/index-BlJ8QU9z.css`
   - bucket 里不存在线上 HTML 引用的资源：
     - `assets/index-CeYyhsxp.js`
     - `assets/index-DCSFO2Y0.css`
   - bucket 里也不存在本地当前 `frontend/dist` 引用的资源：
     - `assets/index-CBFxO396.js`
   - 线上 `www` HTML 引用：`index-CeYyhsxp.js` / `index-DCSFO2Y0.css`。
   - 本地 `frontend/dist/index.html` 引用：`index-CBFxO396.js` / `index-DCSFO2Y0.css`。

4. 发布流程存在设计不一致。
   - README 说明前端使用七牛静态托管，但 `scripts/deploy_frontend_with_cache_refresh.sh` 只部署 Railway 并刷新七牛 CDN，没有把 `frontend/dist` 上传到七牛 bucket。
   - 如果 `www` 的七牛 CDN 是以 Railway 为源站，必须保证 `dingtalk-web` 是前端静态站；如果 `www` 应该使用七牛 Kodo bucket，发布脚本需要增加 `frontend/dist` 全量上传步骤。

### 建议处理顺序

1. 先修复前端源站/CDN：
   - 确认 `dingtalk-web-production.up.railway.app` 是否应为前端服务；如果是，重新将 Railway service 指向 `frontend` 根目录并使用 `frontend/Dockerfile`。
   - 如果 `www.dingtalk.pengshz.cn` 使用七牛静态托管，重新上传 `frontend/dist` 全量产物，至少包含当前 HTML 引用的 JS/CSS。
   - 修复后再次验证首页和所有 `index-*.js` / `index-*.css` 静态资源均返回 `200`。

2. 再修复业务运行环境：
   - 在设备连接器所在机器运行后端，或为生产 API 配置可用的 `DINGTALK_ADB_BIN` / `adb_bin` 与设备序列号。
   - 启动调度器后复查 dashboard：`running: true`、`adbAvailable: true`、至少一个在线授权设备。

3. 补强验收脚本：
   - 已在 `scripts/verify_public_deploy.sh` 中解析首页的 `index-*.js` / `index-*.css` 并逐个请求，任何非 `200` 都会失败。

### 本次执行过的关键检查

- `bash scripts/verify_public_deploy.sh www.dingtalk.pengshz.cn dingtalk-api-production.up.railway.app`
- `curl -i https://www.dingtalk.pengshz.cn/`
- `curl --http1.1 -i https://www.dingtalk.pengshz.cn/assets/index-CeYyhsxp.js`
- `curl --http1.1 -i https://www.dingtalk.pengshz.cn/assets/index-DCSFO2Y0.css`
- `curl -i https://dingtalk-web-production.up.railway.app/`
- `curl -i https://dingtalk-web-production.up.railway.app/api/health`
- `curl -fsS https://dingtalk-api-production.up.railway.app/api/dashboard`
- `railway status`
- `railway service status`
- `railway logs --build f6d10efd-b9da-4cdc-94e7-1b5f67df8dbe --lines 200`
- `railway logs --http --status 404 --lines 20`
- `dig +short CNAME www.dingtalk.pengshz.cn`
- `qshell buckets`
- `qshell domains dingtalkpengshzz2 --detail`
- `qshell listbucket dingtalkpengshzz2 -p assets/`
- `qshell stat dingtalkpengshzz2 index.html`
- `qshell stat dingtalkpengshzz2 assets/index-CeYyhsxp.js`
- `qshell stat dingtalkpengshzz2 assets/index-DCSFO2Y0.css`
- `qshell stat dingtalkpengshzz2 assets/index-CBFxO396.js`

## 2026-04-13 18:26 CST 修复记录

已完成：
- GitHub `main` 已推送提交 `ffc03844`。
- 重新将 `frontend/` 显式部署到 Railway `dingtalk-web` 服务：
  - Deployment ID：`22a0d1d0-af1a-411d-acd1-8277b2f266ec`
  - 状态：`SUCCESS`
  - 构建镜像：`node:20-alpine`
  - 运行日志：`INFO  Accepting connections at http://localhost:8080`
- Railway 前端源站已恢复：
  - `https://dingtalk-web-production.up.railway.app/` 返回 `200`
  - `https://dingtalk-web-production.up.railway.app/assets/index-CeYyhsxp.js` 返回 `200`
  - `https://dingtalk-web-production.up.railway.app/assets/index-DCSFO2Y0.css` 返回 `200`
- 已执行七牛 CDN 刷新：
  - `bash scripts/deploy_frontend_with_cache_refresh.sh www.dingtalk.pengshz.cn dingtalk-web-production.up.railway.app --skip-deploy`
  - 刷新结果：`CDN refresh Code: 200, FlowInfo: success`
  - 资源指纹：`index-CeYyhsxp.js` / `index-DCSFO2Y0.css`
- 已执行公网验收：
  - `bash scripts/verify_public_deploy.sh www.dingtalk.pengshz.cn dingtalk-api-production.up.railway.app`
  - 结果：通过

仍存在：
- 生产 API 仍显示业务执行环境未就绪：
  - 调度器 `running: false`
  - `adbAvailable: false`
  - `scrcpyAvailable: false`
  - 设备数 `deviceCount: 0`
- 这部分不是前端发布问题，需要在可访问本机 USB/ADB 的设备连接器环境中修复配置并启动调度器。
