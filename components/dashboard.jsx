"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const REFRESH_MS = 60_000;

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function formatTs(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

async function readApiPayload(res) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json().catch(() => ({}));
  }

  const text = await res.text().catch(() => "");
  return { error: text.slice(0, 180) };
}

function buildHttpError(prefix, res, payload) {
  const detail = payload?.error || payload?.message || "";
  return new Error(detail || `${prefix} (HTTP ${res.status})`);
}

export default function Dashboard() {
  const [symbols, setSymbols] = useState([]);
  const [symbol, setSymbol] = useState("");
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  const loadSymbols = useCallback(async () => {
    const res = await fetch("/api/symbols", { cache: "no-store" });
    const data = await readApiPayload(res);
    if (!res.ok) throw buildHttpError("获取交易对失败", res, data);
    setSymbols(data.symbols || []);
    if (!symbol && data.symbols?.length) {
      setSymbol(data.symbols[0]);
    } else if (!data.symbols?.length) {
      throw new Error(data.error || "未获取到可用交易对");
    }
  }, [symbol]);

  const loadSeries = useCallback(
    async (targetSymbol) => {
      if (!targetSymbol) return;
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/series?symbol=${encodeURIComponent(targetSymbol)}&limit=240`, {
          cache: "no-store",
        });
        const data = await readApiPayload(res);
        if (!res.ok) throw buildHttpError("获取时序数据失败", res, data);
        setPoints(data.points || []);
        setLastUpdated(data.updatedAt || "");
      } catch (err) {
        setError(err.message || "读取数据失败");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const collectNow = useCallback(async () => {
    setCollecting(true);
    setError("");
    try {
      const res = await fetch(`/api/collect?symbol=${encodeURIComponent(symbol)}`, {
        cache: "no-store",
      });
      const data = await readApiPayload(res);
      if (!res.ok) throw buildHttpError("触发采集失败", res, data);
      await loadSeries(symbol);
    } catch (err) {
      setError(err.message || "触发采集失败");
    } finally {
      setCollecting(false);
    }
  }, [loadSeries, symbol]);

  useEffect(() => {
    loadSymbols().catch((err) => setError(err.message || "初始化失败"));
  }, [loadSymbols]);

  useEffect(() => {
    if (!symbol) return;
    loadSeries(symbol).catch((err) => setError(err.message || "读取失败"));
    const timer = setInterval(() => {
      loadSeries(symbol).catch((err) => setError(err.message || "自动刷新失败"));
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadSeries, symbol]);

  const chartData = useMemo(() => {
    return {
      labels: points.map((p) => new Date(p.ts).toLocaleTimeString("zh-CN", { hour12: false })),
      datasets: [
        {
          label: `${symbol || "合约"} OI`,
          data: points.map((p) => p.oi),
          borderColor: "#4ec5ff",
          backgroundColor: "rgba(78, 197, 255, 0.22)",
          borderWidth: 2,
          tension: 0.25,
          pointRadius: 0,
          fill: true,
        },
      ],
    };
  }, [points, symbol]);

  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#d8e8ff" } },
      },
      scales: {
        x: {
          ticks: { color: "#a8c0e6", maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
          grid: { color: "rgba(133, 168, 209, 0.12)" },
        },
        y: {
          ticks: { color: "#a8c0e6", callback: (v) => formatNumber(v) },
          grid: { color: "rgba(133, 168, 209, 0.12)" },
        },
      },
    };
  }, []);

  const latest = points.length ? points[points.length - 1] : null;
  const latestExchangeCount = latest?.exchanges?.length || 0;

  return (
    <main className="main">
      <header className="header">
        <div>
          <h1 className="title">Binance 合约跨交易所 OI 监控</h1>
          <p className="subtitle">以 Binance USDT 合约为基准，聚合多交易所 OI</p>
        </div>
        <div className="badge">刷新周期: 60 秒</div>
      </header>

      <section className="card">
        <div className="controls">
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {symbols.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => loadSeries(symbol)} disabled={loading || !symbol}>
            {loading ? "刷新中..." : "刷新数据"}
          </button>
          <button type="button" onClick={collectNow} disabled={collecting || !symbol}>
            {collecting ? "采集中..." : "立即采集"}
          </button>
        </div>

        <div style={{ height: 420 }}>
          <Line data={chartData} options={chartOptions} />
        </div>

        <div className="meta">
          <span>当前交易对: {symbol || "-"}</span>
          <span>最近聚合 OI: {formatNumber(latest?.oi)}</span>
          <span>聚合交易所数: {latestExchangeCount || "-"}</span>
          <span>计量: {latest?.metric === "value" ? "notional/value" : "amount"}</span>
          <span>最近点时间: {formatTs(latest?.ts)}</span>
          <span>接口更新时间: {formatTs(lastUpdated)}</span>
        </div>

        {error ? <div className="error">{error}</div> : null}
      </section>
    </main>
  );
}
