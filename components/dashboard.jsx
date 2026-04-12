"use client";

import Link from "next/link";
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
const CHART_LINE = "#8e9f95";
const CHART_FILL = "rgba(142, 159, 149, 0.22)";
const CHART_TEXT = "#6e665e";
const CHART_GRID = "rgba(132, 121, 109, 0.22)";

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

function toHourTs(ts) {
  const d = new Date(ts);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

export default function Dashboard({ initialSymbol = "" }) {
  const [symbols, setSymbols] = useState([]);
  const [symbol, setSymbol] = useState(initialSymbol || "");
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [error, setError] = useState("");
  const [debugError, setDebugError] = useState("");
  const [debugStats, setDebugStats] = useState(null);
  const [lastUpdated, setLastUpdated] = useState("");

  const loadSymbols = useCallback(async () => {
    const res = await fetch("/api/symbols", { cache: "no-store" });
    const data = await readApiPayload(res);
    if (!res.ok) throw buildHttpError("获取交易对失败", res, data);
    setSymbols(data.symbols || []);
    if (!symbol && data.symbols?.length) {
      setSymbol(data.symbols[0]);
    } else if (symbol && data.symbols?.length && !data.symbols.includes(symbol)) {
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

  const loadDebugStats = useCallback(async () => {
    setDebugLoading(true);
    setDebugError("");
    try {
      const res = await fetch("/api/debug/exchanges", { cache: "no-store" });
      const data = await readApiPayload(res);
      if (!res.ok) throw buildHttpError("读取采集状态失败", res, data);
      setDebugStats(data);
    } catch (err) {
      setDebugStats(null);
      setDebugError(err.message || "读取采集状态失败");
    } finally {
      setDebugLoading(false);
    }
  }, []);

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
      await loadDebugStats();
    } catch (err) {
      setError(err.message || "触发采集失败");
    } finally {
      setCollecting(false);
    }
  }, [loadDebugStats, loadSeries, symbol]);

  useEffect(() => {
    loadSymbols().catch((err) => setError(err.message || "初始化失败"));
  }, [loadSymbols]);

  useEffect(() => {
    if (!symbol) return;
    loadSeries(symbol).catch((err) => setError(err.message || "读取失败"));
    loadDebugStats().catch(() => {});
    const timer = setInterval(() => {
      loadSeries(symbol).catch((err) => setError(err.message || "自动刷新失败"));
      loadDebugStats().catch(() => {});
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadDebugStats, loadSeries, symbol]);

  const chartData = useMemo(() => {
    const byHour = new Map();
    const ordered = [...points].sort((a, b) => a.ts - b.ts);
    for (const point of ordered) {
      const hourTs = toHourTs(point.ts);
      byHour.set(hourTs, point);
    }
    const hourlyPoints = Array.from(byHour.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, point]) => point);

    return {
      labels: hourlyPoints.map((p) =>
        new Date(toHourTs(p.ts)).toLocaleString("zh-CN", {
          hour12: false,
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
        }),
      ),
      datasets: [
        {
          label: `${symbol || "合约"} OI (小时)`,
          data: hourlyPoints.map((p) => p.oi),
          borderColor: CHART_LINE,
          backgroundColor: CHART_FILL,
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
        legend: { labels: { color: CHART_TEXT } },
      },
      scales: {
        x: {
          ticks: { color: CHART_TEXT, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
          grid: { color: CHART_GRID },
        },
        y: {
          ticks: { color: CHART_TEXT, callback: (v) => formatNumber(v) },
          grid: { color: CHART_GRID },
        },
      },
    };
  }, []);

  const latest = points.length ? points[points.length - 1] : null;
  const latestIncludedExchangeCount =
    latest?.exchanges?.filter((row) => row?.included !== false).length || 0;
  const latestTotalExchangeCount = latest?.exchanges?.length || 0;
  const latestExchanges = useMemo(() => {
    const rows = Array.isArray(latest?.exchanges) ? [...latest.exchanges] : [];
    return rows.sort((a, b) => (b?.value ?? b?.oi ?? 0) - (a?.value ?? a?.oi ?? 0));
  }, [latest]);

  return (
    <main className="main">
      <header className="header">
        <div>
          <div className="crumb">
            <Link href="/" className="link-btn">
              返回总览
            </Link>
          </div>
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
          <span>
            聚合交易所数: {latestIncludedExchangeCount || "-"} / {latestTotalExchangeCount || "-"}
          </span>
          <span>计量: {latest?.metric === "value" ? "notional/value" : "amount"}</span>
          <span>最近点时间: {formatTs(latest?.ts)}</span>
          <span>接口更新时间: {formatTs(lastUpdated)}</span>
        </div>

        <div className="panels">
          <section className="panel">
            <h3 className="panel-title">最近点交易所贡献</h3>
            {latestExchanges.length ? (
              <div className="table-wrap">
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th>交易所</th>
                      <th>原始 OI</th>
                      <th>折算值</th>
                      <th>计量</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestExchanges.map((row) => (
                      <tr key={`${row.exchange}-${row.metric}`}>
                        <td>{row.exchange || "-"}</td>
                        <td>{formatNumber(row.oi)}</td>
                        <td>{row.value != null ? formatNumber(row.value) : "-"}</td>
                        <td>{row.metric || latest?.metric || "-"}</td>
                        <td>{row.included === false ? "未计入汇总" : "已计入"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-note">当前点暂无交易所贡献明细</div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3 className="panel-title">采集状态调试</h3>
              <button type="button" onClick={loadDebugStats} disabled={debugLoading}>
                {debugLoading ? "刷新中..." : "刷新状态"}
              </button>
            </div>

            {debugStats ? (
              <>
                <div className="panel-meta">
                  <span>最近采集: {formatTs(debugStats.at)}</span>
                  <span>交易对: {debugStats.symbols}</span>
                  <span>聚合成功: {debugStats.collected}</span>
                  <span>失败数: {debugStats.failed}</span>
                </div>
                <div className="table-wrap">
                  <table className="mini-table">
                    <thead>
                      <tr>
                        <th>交易所</th>
                        <th>映射</th>
                        <th>采集</th>
                        <th>失败</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(debugStats.exchangeStats || []).map((item) => (
                        <tr key={item.exchange}>
                          <td>{item.exchange}</td>
                          <td>{item.tracked}</td>
                          <td>{item.collected}</td>
                          <td>{item.failed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="empty-note">暂无采集调试数据，请先触发一次采集</div>
            )}
            {debugError ? <div className="small-error">{debugError}</div> : null}
          </section>
        </div>

        {error ? <div className="error">{error}</div> : null}
      </section>
    </main>
  );
}
