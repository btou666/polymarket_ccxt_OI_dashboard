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

- `GET /api/rankings?sortHours=6&limit=500` 一级总览榜单（含 1h/3h/6h/12h 环比，默认按 6h 环比倒序）
- `GET /api/collect` 手动触发采集（可选 `symbol` 或 `symbols` 参数）
- `GET /api/cron/collect` 定时采集入口（用于 Vercel Cron）
- `GET /api/debug/exchanges` 最近一次采集的交易所统计（tracked/collected/failed）
- `GET /api/symbols` 获取交易对列表
- `GET /api/series?symbol=BTC/USDT:USDT&limit=240` 获取折线图时序

说明：当部分交易所仅返回 `amount` 而非 `value` 时，系统会尝试用 ticker 价格折算为 `value` 并计入聚合；面板会展示每个交易所是否被计入。

## 页面结构

- 一级页面 `/`：所有币对展示 1h/3h/6h/12h 环比，按 6h 环比倒序
- 二级页面 `/symbol?symbol=BTC/USDT:USDT`：单币对详情（折线图按小时横轴）

## 自动更新

- 数据采集由 `oi-collector` 进程自动循环执行，默认每 60 秒抓取一次（无需手动触发）
- 前端页面默认每 60 秒自动刷新榜单和详情数据
- 可通过 `.env` 的 `COLLECT_INTERVAL_MS` 调整采集周期（毫秒）

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
- 未启用 Upstash 时，项目会在 Vercel 使用 `/tmp/binance-oi-dashboard` 作为可写临时目录。
- 若 Binance `exchangeInfo` 返回 451，系统会自动回退到其他交易所市场列表生成锚定合约（保证采集不中断）。

## 外部 Cron（每分钟）

可使用 `cron-job.org`、`EasyCron` 等外部调度服务，每分钟请求一次：

- URL：`https://你的域名/api/collect?token=你的COLLECT_TOKEN`
- 方法：`GET`
- 频率：每 1 分钟

建议：
- 在 Vercel 环境变量里设置 `COLLECT_TOKEN`，避免接口被公开滥用。
- 若调度平台支持自定义 Header，也可改用 `/api/cron/collect` 并传 `Authorization: Bearer CRON_SECRET`。

## 服务器部署

推荐环境：Ubuntu 22.04+, Node.js 20+, PM2, Nginx

### 1. 连接服务器并安装依赖

```bash
ssh root@124.156.129.145
apt update && apt install -y git curl nginx build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm i -g pm2
```

### 2. 拉取项目并配置环境变量

```bash
cd /opt
git clone https://github.com/btou666/polymarket_ccxt_OI_dashboard.git
cd polymarket_ccxt_OI_dashboard
cp .env.example .env
```

关键建议：
- `SYMBOL_LIMIT=0`：抓 Binance 全部 USDT 永续合约
- `AGG_EXCHANGES=binanceusdm,bybit,okx,bitget,gateio,kucoinfutures,mexc,bingx`
- 生产建议设置 `COLLECT_TOKEN`

### 3. 构建并启动（PM2）

```bash
npm install
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

### 4. 配置 Nginx 反向代理

```bash
cp deploy/nginx-oi-dashboard.conf /etc/nginx/sites-available/oi-dashboard.conf
ln -sf /etc/nginx/sites-available/oi-dashboard.conf /etc/nginx/sites-enabled/oi-dashboard.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
```

### 5. 验证服务

```bash
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/symbols
```

如果返回 JSON，说明服务正常，再访问公网 IP：
- `http://124.156.129.145`
