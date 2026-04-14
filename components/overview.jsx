"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const REFRESH_MS = 60_000;

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function formatPct(value) {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
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
  return { error: text.slice(0, 200) };
}

export default function Overview() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generatedAt, setGeneratedAt] = useState(0);
  const [sortState, setSortState] = useState({ key: "pct6h", direction: "desc" });

  const loadRankings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/rankings?sortHours=6&limit=800", { cache: "no-store" });
      const data = await readApiPayload(res);
      if (!res.ok) throw new Error(data.error || `获取榜单失败 (HTTP ${res.status})`);
      setRows(data.rows || []);
      setGeneratedAt(data.generatedAt || Date.now());
    } catch (err) {
      setError(err.message || "读取榜单失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRankings().catch(() => {});
    const timer = setInterval(() => {
      loadRankings().catch(() => {});
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadRankings]);

  const onSort = useCallback((key) => {
    setSortState((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "desc" ? "asc" : "desc" };
      }
      return { key, direction: "desc" };
    });
  }, []);

  const topRows = useMemo(() => {
    const sorted = [...rows];
    const { key, direction } = sortState;

    sorted.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      const aValid = Number.isFinite(av);
      const bValid = Number.isFinite(bv);

      if (aValid !== bValid) return aValid ? -1 : 1;
      if (!aValid && !bValid) return (b.latestOi ?? -Infinity) - (a.latestOi ?? -Infinity);
      if (av === bv) return (b.latestOi ?? -Infinity) - (a.latestOi ?? -Infinity);
      return direction === "desc" ? bv - av : av - bv;
    });

    return sorted;
  }, [rows, sortState]);

  const sortMark = useCallback(
    (key) => {
      if (sortState.key !== key) return "";
      return sortState.direction === "desc" ? " v" : " ^";
    },
    [sortState],
  );

  return (
    <main className="main">
      <header className="header">
        <div>
          <h1 className="title">OI 环比总览</h1>
          <p className="subtitle">展示 1h/3h/6h/12h 环比，支持点击列头排序，点击币对进入详情</p>
        </div>
        <div className="badge">刷新周期: 60 秒</div>
      </header>

      <section className="card">
        <div className="panel-head" style={{ marginBottom: 10 }}>
          <div className="panel-meta" style={{ margin: 0 }}>
            <span>币对数: {topRows.length}</span>
            <span>榜单时间: {formatTs(generatedAt)}</span>
          </div>
          <button type="button" onClick={loadRankings} disabled={loading}>
            {loading ? "刷新中..." : "刷新榜单"}
          </button>
        </div>

        <div className="table-wrap" style={{ maxHeight: 640 }}>
          <table className="mini-table overview-table">
            <thead>
              <tr>
                <th>#</th>
                <th>币对</th>
                <th>1h 增量</th>
                <th>
                  <button type="button" className="table-sort-btn" onClick={() => onSort("pct1h")}>
                    1h 环比{sortMark("pct1h")}
                  </button>
                </th>
                <th>
                  <button type="button" className="table-sort-btn" onClick={() => onSort("pct3h")}>
                    3h 环比{sortMark("pct3h")}
                  </button>
                </th>
                <th>
                  <button type="button" className="table-sort-btn" onClick={() => onSort("pct6h")}>
                    6h 环比{sortMark("pct6h")}
                  </button>
                </th>
                <th>
                  <button type="button" className="table-sort-btn" onClick={() => onSort("pct12h")}>
                    12h 环比{sortMark("pct12h")}
                  </button>
                </th>
                <th>当前 OI</th>
                <th>交易所(计入/总)</th>
                <th>最近点时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {topRows.map((row, idx) => {
                const up1h = (row.pct1h ?? 0) >= 0;
                const up3h = (row.pct3h ?? 0) >= 0;
                const up6h = (row.pct6h ?? 0) >= 0;
                const up12h = (row.pct12h ?? 0) >= 0;
                return (
                  <tr key={row.symbol}>
                    <td>{idx + 1}</td>
                    <td>{row.symbol}</td>
                    <td style={{ color: up1h ? "#7f9b8c" : "#b18678" }}>{formatNumber(row.delta1h)}</td>
                    <td style={{ color: up1h ? "#7f9b8c" : "#b18678" }}>{formatPct(row.pct1h)}</td>
                    <td style={{ color: up3h ? "#7f9b8c" : "#b18678" }}>{formatPct(row.pct3h)}</td>
                    <td style={{ color: up6h ? "#7f9b8c" : "#b18678" }}>{formatPct(row.pct6h)}</td>
                    <td style={{ color: up12h ? "#7f9b8c" : "#b18678" }}>{formatPct(row.pct12h)}</td>
                    <td>{formatNumber(row.latestOi)}</td>
                    <td>
                      {row.includedExchanges}/{row.totalExchanges}
                    </td>
                    <td>{formatTs(row.latestTs)}</td>
                    <td>
                      <Link
                        className="link-btn"
                        href={{ pathname: "/symbol", query: { symbol: row.symbol } }}
                      >
                        查看详情
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {error ? <div className="error">{error}</div> : null}
      </section>
    </main>
  );
}
