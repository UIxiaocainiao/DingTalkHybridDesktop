# 项目结构说明（基础版对齐）

本文档按你给的基础版目录模板整理，并标注当前项目的真实运行入口。

## 关键结论

- 前端可运行入口：`frontend/src/main.jsx` + `frontend/src/App.jsx`
- 后端可运行入口：`backend/api_server.py`（Python）
- `backend/src/**` 为 Node 分层迁移骨架（占位，不参与当前现网）

## 目录结构（已对齐）

```text
DingTalkHybridDesktop/
├── frontend/
│   ├── public/
│   │   ├── favicon.ico
│   │   └── logo.png
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   │   ├── Layout/
│   │   │   ├── Navbar/
│   │   │   └── DeviceCard/
│   │   ├── pages/
│   │   │   ├── Home/
│   │   │   ├── Login/
│   │   │   ├── Dashboard/
│   │   │   ├── Devices/
│   │   │   ├── Tasks/
│   │   │   ├── Logs/
│   │   │   └── Settings/
│   │   ├── router/
│   │   │   └── index.jsx
│   │   ├── api/
│   │   │   ├── request.js
│   │   │   ├── auth.js
│   │   │   ├── device.js
│   │   │   ├── task.js
│   │   │   ├── log.js
│   │   │   └── index.js
│   │   ├── store/
│   │   │   ├── authStore.js
│   │   │   └── deviceStore.js
│   │   ├── utils/
│   │   │   ├── auth.js
│   │   │   ├── storage.js
│   │   │   └── format.js
│   │   ├── styles/
│   │   │   ├── global.css
│   │   │   └── variables.css
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── .env.example
│   ├── package.json
│   ├── vite.config.js
│   └── README.md
│
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── db.js
│   │   │   ├── env.js
│   │   │   └── jwt.js
│   │   ├── controllers/
│   │   │   ├── authController.js
│   │   │   ├── deviceController.js
│   │   │   ├── taskController.js
│   │   │   └── logController.js
│   │   ├── models/
│   │   │   ├── User.js
│   │   │   ├── Device.js
│   │   │   ├── CheckInTask.js
│   │   │   └── CheckInLog.js
│   │   ├── routes/
│   │   │   ├── authRoutes.js
│   │   │   ├── deviceRoutes.js
│   │   │   ├── taskRoutes.js
│   │   │   ├── logRoutes.js
│   │   │   └── index.js
│   │   ├── middleware/
│   │   │   ├── authMiddleware.js
│   │   │   ├── errorMiddleware.js
│   │   │   └── validateMiddleware.js
│   │   ├── services/
│   │   │   ├── authService.js
│   │   │   ├── deviceService.js
│   │   │   ├── taskService.js
│   │   │   ├── logService.js
│   │   │   ├── adbService.js
│   │   │   └── dingtalkService.js
│   │   ├── jobs/
│   │   │   ├── scheduler.js
│   │   │   └── checkInJob.js
│   │   ├── utils/
│   │   │   ├── response.js
│   │   │   ├── logger.js
│   │   │   ├── hash.js
│   │   │   └── time.js
│   │   ├── app.js
│   │   └── server.js
│   ├── api_server.py
│   ├── dingtalk_random_scheduler.py
│   ├── .env.example
│   ├── package.json
│   └── README.md
│
├── scripts/
│   ├── start-frontend.sh
│   ├── start-backend.sh
│   ├── deploy.sh
│   ├── backup.sh
│   └── deploy_laika_full.sh
│
├── database/
│   ├── schema.sql
│   ├── seed.sql
│   └── migrations/
│
├── docs/
│   ├── api.md
│   ├── deploy.md
│   ├── adb-device-setup.md
│   └── project-structure.md
│
├── .gitignore
├── docker-compose.yml
├── nginx.conf
├── README.md
└── LICENSE
```

## 迁移状态说明

1. `frontend/src/api/**` 已接入真实接口（从旧 `lib/api.js` 迁移到模块化）。
2. `frontend/src/lib/api.js` 保留为兼容层，避免旧引用失效。
3. `backend/src/**` 仅为结构骨架；当前业务逻辑仍在 Python 后端文件中。
