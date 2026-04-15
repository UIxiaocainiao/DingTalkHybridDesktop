# 公网部署参数模板（阿里云域名 + 七牛 + Railway）

按你的实际信息填写：

## 基础域名

- 主域名：`example.com`
- 前端域名（七牛）：`www.example.com`
- 后端域名（Railway）：`api.example.com`

## Railway（后端）

- Git 仓库：`git@github.com:UIxiaocainiao/DingTalkHybridDesktop.git`
- Root Directory：`backend`
- Start Command：`python3 api_server.py --host 0.0.0.0 --port ${PORT:-8000}`
- Healthcheck Path：`/api/health`
- Railway 临时域名：`https://<xxx>.up.railway.app`
- Railway 自定义域名 CNAME 目标：`<railway-cname-target>`

## 前端构建

在 `frontend/.env.production` 写入：

```bash
VITE_API_BASE_URL=https://api.example.com
```

## 七牛（前端）

- 空间名：`<bucket-name>`
- 绑定域名：`www.example.com`
- 七牛 CNAME 目标：`<qiniu-cname-target>`
- 静态页首页：`index.html`

## 阿里云 DNS 记录

- `api` CNAME -> `<railway-cname-target>`
- `www` CNAME -> `<qiniu-cname-target>`

## 验收地址

- 后端健康检查：`https://api.example.com/api/health`
- 前端页面：`https://www.example.com`
