# 词间 Wordloop · 腾讯云云托管版

本分支是 `main` 根目录新版游戏的腾讯云云托管适配版。前端页面保留，后端由 Cloudflare Workers / Durable Objects 改为 Node.js + WebSocket。

## 目录

- `public/`：前端页面、样式和浏览器端逻辑
- `server.js`：HTTP 静态文件服务、WebSocket 房间与游戏逻辑
- `package.json`：Node.js 依赖与启动命令
- `Dockerfile`：腾讯云云托管容器构建文件
- `.dockerignore`：构建排除项

## 本地启动

需要 Node.js 20+。

```bash
npm install
npm start
```

打开 `http://localhost:3000`；健康检查地址为 `/health`。

## 腾讯云云托管部署

1. 下载本分支 ZIP 并解压。
2. 将**项目根目录里的内容**压缩成 ZIP，或直接上传解压后的项目文件夹。注意 ZIP 根目录必须直接包含 `Dockerfile`、`package.json`、`server.js` 和 `public/`。
3. 腾讯云 CloudBase 云托管新建服务，选择「上传代码包」。
4. Dockerfile 名称填写 `Dockerfile`，监听端口填写 `3000`。
5. 开启公网访问并发布版本。容器会自动读取平台提供的 `PORT` 环境变量。
6. 首次体验请把实例最小数和最大数都设为 `1`。

## 重要限制

当前房间状态保存在 Node.js 进程内存中，**只适用于单实例体验**。请勿开启多实例扩缩容，否则不同玩家可能被分配到不同实例，无法看到同一房间。容器重启或重新发布也会清空正在进行的房间。正式运营前需要增加 Redis 等共享状态与消息协调、断线重连和房间过期清理。

前端 WebSocket 使用同源 `/ws` 路径；通过 HTTPS 访问时浏览器会自动建立 WSS 连接，无需配置固定域名。

原 `src/index.js`、`wrangler.jsonc` 是 Cloudflare 版本遗留文件，不参与腾讯云 Docker 部署；`workplay/` 是旧版备份，不参与本次部署。
