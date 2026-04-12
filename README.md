# Binance Futures OI Dashboard (ccxt)

每分钟抓取 Binance U 本位永续合约列表，并聚合多个交易所的 OI（Open Interest）后展示折线图。

## 功能

- 使用 `ccxt` 抓取合约 OI
- 定时采集（Vercel Cron 每分钟 / 服务器循环任务）
- 折线图可视化（按交易对查看）
- 以 Binance USDT 永续合约为基准，聚合多交易所 OI
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
- `AGG_EXCHANGES`：参与聚合的交易所（ccxt id，逗号分隔）
- `EXCHANGE_TIMEOUT_MS`：单交易所请求超时时间
- `FALLBACK_SINGLE_FETCH_THRESHOLD`：批量接口缺失过多时是否跳过逐个查询
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
3. 部署后，使用外部 Cron 服务按分钟调用你的采集接口（见下方说明）。

说明：
- Vercel Hobby 只支持“每天一次”的内置 Cron，不支持每分钟。
- Binance Futures 在部分地域（尤其美国）可能受限，已在 API 配置亚洲优先区域；若仍失败建议使用自建服务器部署。
- Vercel 无本地持久化磁盘，生产建议启用 Upstash Redis。

## 外部 Cron（每分钟）

可使用 `cron-job.org`、`EasyCron` 等外部调度服务，每分钟请求一次：

- URL：`https://你的域名/api/collect?token=你的COLLECT_TOKEN`
- 方法：`GET`
- 频率：每 1 分钟

建议：
- 在 Vercel 环境变量里设置 `COLLECT_TOKEN`，避免接口被公开滥用。
- 若调度平台支持自定义 Header，也可改用 `/api/cron/collect` 并传 `Authorization: Bearer CRON_SECRET`。

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
