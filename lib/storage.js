import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = process.env.OI_DATA_DIR
  ? path.resolve(process.env.OI_DATA_DIR)
  : process.env.VERCEL
    ? path.join("/tmp", "binance-oi-dashboard")
    : path.join(process.cwd(), "data");
const LOCAL_FILE = path.join(DATA_DIR, "oi.json");
const LOCAL_STATS_FILE = path.join(DATA_DIR, "last-collect.json");

function hasUpstash() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function upstashCommand(args) {
  const res = await fetch(process.env.KV_REST_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Upstash request failed: ${res.status}`);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(`Upstash error: ${data.error}`);
  }

  return data.result;
}

async function ensureLocalFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(LOCAL_FILE);
  } catch {
    await fs.writeFile(LOCAL_FILE, JSON.stringify({}, null, 2), "utf8");
  }
}

async function ensureLocalStatsFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(LOCAL_STATS_FILE);
  } catch {
    await fs.writeFile(LOCAL_STATS_FILE, JSON.stringify({}, null, 2), "utf8");
  }
}

async function readLocalStore() {
  await ensureLocalFile();
  const raw = await fs.readFile(LOCAL_FILE, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeLocalStore(store) {
  await fs.writeFile(LOCAL_FILE, JSON.stringify(store, null, 2), "utf8");
}

async function readLocalCollectStats() {
  await ensureLocalStatsFile();
  const raw = await fs.readFile(LOCAL_STATS_FILE, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeLocalCollectStats(stats) {
  await ensureLocalStatsFile();
  await fs.writeFile(LOCAL_STATS_FILE, JSON.stringify(stats, null, 2), "utf8");
}

export async function appendSnapshots(snapshots, { retentionMs, maxPointsPerSymbol }) {
  if (!snapshots.length) return;

  if (hasUpstash()) {
    for (const item of snapshots) {
      const key = `oi:${item.symbol}`;
      await upstashCommand(["SADD", "oi:symbols", item.symbol]);
      await upstashCommand([
        "ZADD",
        key,
        item.ts,
        JSON.stringify({
          ts: item.ts,
          oi: item.oi,
          metric: item.metric || "amount",
          exchanges: item.exchanges || [],
        }),
      ]);
      await upstashCommand(["ZREMRANGEBYSCORE", key, "-inf", item.ts - retentionMs]);
      await upstashCommand(["ZREMRANGEBYRANK", key, 0, -(maxPointsPerSymbol + 1)]);
    }
    return;
  }

  const store = await readLocalStore();

  for (const item of snapshots) {
    if (!store[item.symbol]) {
      store[item.symbol] = [];
    }

    store[item.symbol].push({
      ts: item.ts,
      oi: item.oi,
      metric: item.metric || "amount",
      exchanges: item.exchanges || [],
    });

    const cutoff = item.ts - retentionMs;
    store[item.symbol] = store[item.symbol]
      .filter((point) => point.ts >= cutoff)
      .sort((a, b) => a.ts - b.ts)
      .slice(-maxPointsPerSymbol);
  }

  await writeLocalStore(store);
}

export async function listSymbols() {
  if (hasUpstash()) {
    const symbols = (await upstashCommand(["SMEMBERS", "oi:symbols"])) || [];
    return symbols.sort((a, b) => a.localeCompare(b));
  }

  const store = await readLocalStore();
  return Object.keys(store).sort((a, b) => a.localeCompare(b));
}

export async function readSeries(symbol, limit = 240) {
  const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 240));

  if (hasUpstash()) {
    const key = `oi:${symbol}`;
    const rows = (await upstashCommand(["ZRANGE", key, -safeLimit, -1])) || [];
    return rows
      .map((row) => {
        try {
          return JSON.parse(row);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.ts - b.ts);
  }

  const store = await readLocalStore();
  const rows = store[symbol] || [];
  return rows.slice(-safeLimit);
}

export async function readSeriesBatch(symbols, limit = 240) {
  const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 240));
  const uniqueSymbols = Array.from(new Set((symbols || []).filter(Boolean)));
  const result = {};

  if (!uniqueSymbols.length) return result;

  if (hasUpstash()) {
    for (const symbol of uniqueSymbols) {
      const key = `oi:${symbol}`;
      const rows = (await upstashCommand(["ZRANGE", key, -safeLimit, -1])) || [];
      result[symbol] = rows
        .map((row) => {
          try {
            return JSON.parse(row);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => a.ts - b.ts);
    }
    return result;
  }

  const store = await readLocalStore();
  for (const symbol of uniqueSymbols) {
    const rows = store[symbol] || [];
    result[symbol] = rows.slice(-safeLimit);
  }
  return result;
}

export async function saveCollectStats(stats) {
  if (!stats) return;

  if (hasUpstash()) {
    await upstashCommand(["SET", "oi:lastCollect", JSON.stringify(stats)]);
    return;
  }

  await writeLocalCollectStats(stats);
}

export async function readCollectStats() {
  if (hasUpstash()) {
    const raw = await upstashCommand(["GET", "oi:lastCollect"]);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  return readLocalCollectStats();
}
