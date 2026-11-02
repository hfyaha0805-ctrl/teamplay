# 词间 Wordloop · Cloudflare 版

双人实时联机链式联想小游戏。前端由 Cloudflare Workers Static Assets 托管；房间实时状态和 WebSocket 由 Durable Objects 管理。

## Cloudflare 部署（推荐从 GitHub 导入）

仓库根目录必须直接包含 `package.json`、`wrangler.jsonc`、`src/` 和 `public/`。

1. 将本项目文件上传到 GitHub 仓库根目录。
2. 登录 Cloudflare Dashboard，打开 **Workers & Pages**。
3. 选择 **Create application** → **Worker** → **Import a repository**（界面名称可能略有不同）。
4. 连接 GitHub 并选择你的仓库。
5. 如果要求配置构建：
   - Build command：留空
   - Deploy command：`npx wrangler deploy`（或 `npm run deploy`）
   - Root directory：留空
6. 创建并部署。首次部署时 Cloudflare 会提示授权 GitHub 仓库访问。

## 本地开发

需要 Node.js 18+。

```bash
npm install
npm run dev
```

部署命令：

```bash
npx wrangler login
npm run deploy
```

配置文件已声明 SQLite-backed Durable Object 迁移。首次部署需要在 Cloudflare 账户中启用 Workers 和 Durable Objects。

## 说明

- 房间码为 5 位；每个房间最多两名玩家。
- WebSocket 由 Durable Objects 的 Hibernation API 管理。
- 每轮 20 秒，服务器通过 Durable Object Alarm 结束回合；揭晓间隔 3.2 秒。
- 房间数据写入 Durable Object SQLite storage，不依赖 Worker 实例内存。
- 当前版本尚未实现玩家断线后的身份恢复/重新加入。网络中断后，该玩家会显示连接中断；重新开始新局可创建新房间。
- 对外公开前建议补充房间过期清理、滥用限流和更完整的重连机制。
