# 词间 Wordloop · 腾讯云云托管版

双人实时联机链式联想小游戏。前端保留原版页面，后端已从 Cloudflare Workers / Durable Objects 迁移为 Node.js + WebSocket，可通过 Dockerfile 上传至腾讯云 CloudBase Run（云托管）。

## 项目结构

```
teamplay/
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── server.js
├── package.json
├── Dockerfile
└── .dockerignore
```

## 腾讯云云托管部署

1. 将本项目根目录内的文件夹内容压缩为 ZIP（不要把最外层文件夹再套一层）。
2. 在腾讯云 CloudBase 云托管创建服务，选择“上传代码包”。
3. 上传 ZIP，Dockerfile 使用根目录默认的 `Dockerfile`。
4. 服务监听端口填写 `3000`（程序同时会读取平台注入的 `PORT` 环境变量）。
5. 启动命令由 Dockerfile 执行：`npm start`。
6. 首次部署建议将实例最小数、最大数都设为 1，避免多实例之间房间内存不共享。
7. 部署完成后访问服务域名，使用两台设备或两个浏览器窗口测试创建房间、加入房间和完整游戏流程。

## 本地运行

需要 Node.js 20 或更高版本。

```bash
npm install
npm start
```

浏览器访问 `http://localhost:3000`。

## 重要运行说明

- WebSocket 地址使用页面同源的 `/ws`，HTTPS 域名下浏览器会自动使用 WSS，不需要填写固定域名。
- `/health` 提供健康检查，返回 JSON。
- 当前版本使用 Node.js 进程内存保存房间状态；容器重启后房间会清空。
- **必须保持单实例运行**。如果扩容到多个实例，不同玩家可能连接到不同实例，无法共享房间。若以后需要多实例，应把房间状态和消息协调迁移到 Redis 等共享存储。
- 原有 `src/index.js`、`wrangler.jsonc` 是 Cloudflare 版本遗留文件；腾讯云部署不再使用它们。
- 原前端的游戏页面、样式、动物选择、表情、计时和联想逻辑均保留。

## 部署前检查

- 根目录存在 `Dockerfile`、`package.json`、`server.js`。
- `public/index.html`、`public/style.css`、`public/app.js` 存在。
- 云托管监听端口为 3000。
- 实例数保持 1。
