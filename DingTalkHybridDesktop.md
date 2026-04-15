DingTalk-automatic-check-in
Electron 混合版目录结构 + 启动流程方案

一、目标
在不推翻现有项目的前提下，把当前项目封装成：
“Electron 桌面应用 + React 前端控制台 + Python 本地后端 + ADB 调度器”

二、核心思路
1. 保留现有 frontend
2. 保留现有 backend
3. 新增 desktop 目录用于 Electron 壳
4. Electron 负责启动窗口、拉起 Python 后端、系统托盘、自启动、通知
5. React 页面继续作为控制台 UI
6. Python 后端继续作为核心业务执行层
7. ADB / scrcpy 继续负责设备交互和执行动作

三、推荐目录结构

DingTalk-automatic-check-in/
├── desktop/                             # Electron 桌面端
│   ├── main/                            # 主进程代码
│   │   ├── index.js                     # Electron 主入口
│   │   ├── window.js                    # 窗口管理
│   │   ├── tray.js                      # 系统托盘
│   │   ├── backend.js                   # 启动/关闭 Python 后端
│   │   ├── updater.js                   # 更新能力（后期可选）
│   │   ├── startup.js                   # 启动流程控制
│   │   └── paths.js                     # 路径管理
│   ├── preload/
│   │   └── index.js                     # preload 桥接
│   ├── assets/
│   │   ├── icon.icns
│   │   ├── icon.ico
│   │   └── trayTemplate.png
│   ├── package.json
│   └── electron-builder.json
│
├── frontend/                            # React 前端控制台
│   ├── public/
│   ├── src/
│   │   ├── api/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── router/
│   │   ├── store/
│   │   ├── styles/
│   │   ├── utils/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── dist/                            # 前端打包产物
│   ├── package.json
│   ├── vite.config.js
│   └── README.md
│
├── backend/                             # Python 后端
│   ├── api_server.py                    # 本地 API 服务入口
│   ├── dingtalk_random_scheduler.py     # 调度器
│   ├── runtime/                         # 配置文件 / 状态文件
│   ├── logs/                            # 日志目录
│   ├── src/                             # 预留扩展结构
│   ├── test_api_integrity.py
│   └── README.md
│
├── scripts/                             # 脚本工具
│   ├── dev-start.sh
│   ├── dev-stop.sh
│   ├── build-frontend.sh
│   ├── build-desktop.sh
│   ├── package-app.sh
│   └── doctor.sh
│
├── docs/
│   ├── architecture.md
│   ├── desktop-plan.md
│   ├── deploy.md
│   └── adb-device-setup.md
│
├── .gitignore
├── README.md
└── LICENSE

四、各目录职责说明

1. desktop/main/index.js
作用：
Electron 主进程入口，负责初始化整个桌面应用。

包含职责：
- 应用启动
- 单实例控制
- 创建主窗口
- 启动 Python 后端
- 注册托盘
- 监听应用关闭逻辑

2. desktop/main/window.js
作用：
统一管理桌面窗口。

包含职责：
- 创建主窗口
- 设置窗口大小、最小尺寸
- 控制关闭行为
- 最小化到托盘
- 打开开发者工具（开发环境）

3. desktop/main/backend.js
作用：
管理 Python 后端进程。

包含职责：
- 检查本地 8000 端口
- 自动启动 api_server.py
- 健康检查 /api/health
- 停止后端进程
- 记录 stdout/stderr 日志

4. desktop/main/tray.js
作用：
管理系统托盘。

包含职责：
- 创建托盘图标
- 托盘菜单
- 打开控制台
- 启动调度
- 停止调度
- 退出应用

5. desktop/main/startup.js
作用：
控制应用启动顺序。

包含职责：
- 启动前检查环境
- 初始化路径
- 拉起 Python 服务
- 等待健康检查通过
- 打开主窗口

6. desktop/preload/index.js
作用：
在渲染进程和主进程之间做安全桥接。

适合暴露：
- 打开日志目录
- 打开配置目录
- 获取应用版本
- 触发桌面通知
- 调用主进程特定方法

五、推荐启动流程

标准启动顺序：

步骤1
用户双击桌面应用

步骤2
Electron 主进程启动

步骤3
执行启动前检查
- 是否已有实例运行
- 路径是否存在
- Python 是否可用
- 后端端口是否已被占用

步骤4
检查本地后端是否已启动
- 检查 http://127.0.0.1:8000/api/health
- 若已启动则直接复用
- 若未启动则进入下一步

步骤5
自动启动 Python 后端
执行：
python3 backend/api_server.py

步骤6
轮询健康检查
- 每隔 1 秒请求一次 /api/health
- 成功后进入下一步
- 超时则弹出错误提示

步骤7
创建主窗口
开发环境：
加载 http://127.0.0.1:5173
生产环境：
加载 frontend/dist/index.html

步骤8
初始化托盘
- 创建托盘图标
- 绑定菜单
- 支持恢复主窗口

步骤9
应用进入可用状态
- 用户可配置调度
- 用户可查看设备状态、日志、记录

六、推荐关闭流程

方式一：点击窗口关闭按钮
处理逻辑：
1. 不直接退出应用
2. 隐藏主窗口
3. 保持后端和调度继续运行
4. 托盘提示“程序仍在后台运行”

方式二：托盘菜单点击退出
处理逻辑：
1. 询问是否同时关闭调度器
2. 停止 Python 后端
3. 销毁托盘
4. 退出 Electron 应用

七、开发环境流程

启动顺序建议：

方式一：手动联调
1. 启动 frontend
2. 启动 backend
3. 启动 Electron

方式二：统一脚本
1. scripts/dev-start.sh 同时启动前端、后端、桌面端

开发环境页面加载地址：
http://127.0.0.1:5173

后端接口地址：
http://127.0.0.1:8000

优点：
1. 调试方便
2. 前后端修改实时生效
3. Electron 仅作为壳参与联调

八、生产环境流程

打包顺序建议：

步骤1
构建前端
cd frontend
npm install
npm run build

步骤2
准备 Electron 生产配置
- 主窗口加载 frontend/dist/index.html
- 后端脚本路径指向打包后的项目路径

步骤3
打包桌面应用
- 使用 electron-builder
- 输出 macOS / Windows 安装包

生产运行时逻辑：
1. 用户双击应用
2. Electron 启动
3. 自动拉起 Python 后端
4. 加载本地前端 dist 页面
5. 前端请求本地 API
6. 用户开始使用

九、前端接口调用约定

推荐保持现有模式不变：

前端调用：
http://127.0.0.1:8000/api/*

例如：
- /api/health
- /api/dashboard
- /api/config
- /api/actions/start
- /api/actions/stop
- /api/actions/doctor
- /api/checkin-records

这样做的好处：
1. 与现有项目一致
2. 减少改动
3. 前后端边界清晰
4. 便于独立排错

十、桌面端与前端协作边界

Electron 负责：
- 启动应用
- 启动后端
- 系统托盘
- 开机自启
- 文件目录打开
- 原生通知
- 应用退出逻辑

React 前端负责：
- 页面 UI
- 状态展示
- 表单配置
- 日志查看
- 调度控制
- 记录管理

Python 后端负责：
- 核心业务逻辑
- 配置读写
- 调度执行
- ADB 调用
- 自检与设备检查
- 日志落盘
- 打卡记录持久化

十一、推荐的启动判断逻辑

应用启动时执行：

1. 先检查本地 API 是否可访问
2. 若可访问：
   - 直接打开窗口
   - 不重复启动后端
3. 若不可访问：
   - 尝试启动 Python 后端
   - 等待健康检查通过
4. 若健康检查失败：
   - 展示错误页
   - 提示用户检查 Python / ADB / 配置路径

十二、推荐增加的错误页内容

当启动失败时，桌面端不要只弹系统报错，建议提供一个可视化错误页。

错误页建议显示：
1. 后端启动失败
2. Python 未找到
3. ADB 未安装
4. 端口被占用
5. 配置目录不可写
6. 设备未连接

建议操作按钮：
- 重试启动
- 打开日志目录
- 打开配置目录
- 查看帮助文档

十三、推荐托盘菜单结构

DingTalk 自动打卡助手
├── 打开控制台
├── 查看当前状态
├── 启动调度
├── 停止调度
├── 一键自检
├── 打开日志目录
├── 打开配置目录
├── 重启后端服务
└── 退出程序

十四、推荐脚本设计

scripts/dev-start.sh
作用：
一键启动开发环境前端 + 后端 + Electron

scripts/build-frontend.sh
作用：
构建 React 前端产物

scripts/build-desktop.sh
作用：
打包 Electron 桌面端

scripts/package-app.sh
作用：
统一打包安装程序

scripts/doctor.sh
作用：
一键检查 Python、ADB、端口、配置路径、设备连接状态

十五、最小可行落地版本

第一版只需要做到：

1. 新增 desktop 目录
2. Electron 能打开窗口
3. Electron 能自动启动 Python 后端
4. 页面能显示 React 控制台
5. 前端能正常请求本地 API
6. 能手动启动和停止调度
7. 能查看设备状态和日志

做到这一步，就已经是一个真正的混合版产品雏形。

十六、后续增强版本

第二版补充：
1. 托盘
2. 最小化后台运行
3. 开机自启
4. 原生通知
5. 打开日志目录
6. 打开配置目录

第三版补充：
1. 安装包
2. 软件图标
3. 版本号管理
4. 自动更新
5. 错误页
6. 多设备支持

十七、一句话结论

最稳的实现方式不是重写项目，而是在现有
“frontend + backend/api_server.py + dingtalk_random_scheduler.py”
外层新增一个 desktop/Electron 壳，把启动、托盘、自启动、通知、打包这些桌面能力补上，就能快速形成一个真正可安装、可使用、可扩展的混合版产品。