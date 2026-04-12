# Binance Futures OI Dashboard (ccxt)

每分钟抓取 Binance U 本位永续合约 OI（Open Interest），并在页面展示折线图。

## 功能

- 使用 `ccxt` 抓取合约 OI
- 定时采集（Vercel Cron 每分钟 / 服务器循环任务）
- 折线图可视化（按交易对查看）
- 支持 `TARGET_SYMBOLS` 指定交易对，或用 `SYMBOL_LIMIT` 自动追踪多币种
- 存储层可选：
  - 本地 `data/oi.json`（适合服务器部署）
  - Upstash Redis（适合 Vercel 持久化）

## 快速开始

```bash
npm install
cp .env.example .env
npm run dev
```

打开 `http://localhost:3000`

## 关键环境变量

- `TARGET_SYMBOLS`：逗号分隔的指定交易对（优先级最高）
- `SYMBOL_LIMIT`：未指定交易对时，自动追踪的合约数量（默认 80）
- `RETENTION_HOURS`：保留历史小时数
- `CRON_SECRET`：Vercel Cron 访问鉴权
- `KV_REST_API_URL` / `KV_REST_API_TOKEN`：Vercel 持久化存储

## 数据接口

- `GET /api/collect` 手动触发采集（可选 `symbol` 或 `symbols` 参数）
- `GET /api/cron/collect` 定时采集入口（用于 Vercel Cron）
- `GET /api/symbols` 获取交易对列表
- `GET /api/series?symbol=BTC/USDT:USDT&limit=240` 获取折线图时序

## Vercel 部署

1. 将代码推到 GitHub 并导入 Vercel。
2. 在 Vercel 环境变量中设置：
   - `CRON_SECRET`（建议）
   - 若要持久化：`KV_REST_API_URL`、`KV_REST_API_TOKEN`
3. `vercel.json` 已配置每分钟触发 `/api/cron/collect`。

说明：Vercel 无本地持久化磁盘，生产建议启用 Upstash Redis。

## 服务器部署

```bash
npm install
npm run build
npm run start
```

再开一个进程做采集循环：

```bash
npm run collect:loop
```

建议使用 `pm2` / `systemd` 守护 `npm run collect:loop`。
