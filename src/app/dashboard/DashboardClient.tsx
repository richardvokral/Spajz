"use client";

import { useCallback, useEffect, useState } from "react";
import type { RohlikDebug } from "@/lib/rohlik/types";
import { BarChart } from "@/components/Charts";

interface Metrics {
  dbConfigured: boolean;
  currency: string;
  monthly: { month: string; label: string; total: number; count: number }[];
  avgOrderValue: number;
  totalOrders: number;
  totalSpent: number;
  favouriteDay: { day: string; count: number } | null;
  byWeekday: { day: string; count: number }[];
}

interface PantryItem {
  name: string;
  mcpCategory: string | null;
  packageCount: number;
  contentAmount: number | null;
  contentUnit: string | null;
  textualAmount: string | null;
  unit: string | null;
  lastBought: string | null;
}

interface PantryCategory {
  category: string;
  packageTotal: number;
  content: { unit: string; amount: number }[];
  items: PantryItem[];
}

function formatContent(content: { unit: string; amount: number }[]): string {
  return content.map((c) => `${c.amount} ${c.unit}`).join(" · ");
}

function money(amount: number, currency: string): string {
  return `${Math.round(amount).toLocaleString("en-US")} ${currency}`;
}

const STATUS_TEXT: Record<string, string> = {
  connected: "Connected to Rohlik.",
  oauth_init: "Could not start Rohlik sign-in (network?). Please try again.",
  oauth_state: "Rohlik sign-in could not be verified. Please try again.",
  oauth_exchange: "Could not complete Rohlik sign-in. Please try again.",
  oauth_notokens: "Rohlik did not return an access token. Please try again.",
};

export default function DashboardClient({
  logtoOn,
  userName,
  connected,
  pendingAuthUrl,
  status,
  statusDetail,
}: {
  logtoOn: boolean;
  userName: string | null;
  connected: boolean;
  pendingAuthUrl: string | null;
  status: string | null;
  statusDetail: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [debug, setDebug] = useState<RohlikDebug | null>(null);
  const [copied, setCopied] = useState(false);

  const [pantry, setPantry] = useState<PantryCategory[]>([]);
  const [mode, setMode] = useState<"package" | "content">("package");
  const [pantryReady, setPantryReady] = useState(false);
  const [dbConfigured, setDbConfigured] = useState(true);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  const loadPantry = useCallback(async () => {
    try {
      const res = await fetch("/api/pantry");
      const data = await res.json();
      setDbConfigured(Boolean(data.dbConfigured));
      setPantry(Array.isArray(data.categories) ? data.categories : []);
      setMode(data.pantryQuantityMode === "content" ? "content" : "package");
    } catch {
      setPantry([]);
    } finally {
      setPantryReady(true);
    }
  }, []);

  const loadMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/metrics");
      const data = (await res.json()) as Metrics;
      setMetrics(data);
    } catch {
      setMetrics(null);
    }
  }, []);

  useEffect(() => {
    loadPantry();
    loadMetrics();
  }, [loadPantry, loadMetrics]);

  async function handleImport() {
    setLoading(true);
    setError(null);
    setNote(null);
    setDebug(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "last" }),
      });
      const data = await res.json();
      setDebug(data.debug ?? null);
      if (data.ok === false) {
        setError(data.error ?? "Import failed.");
        return;
      }
      setNote(
        `Imported ${data.ordersImported} order(s), ${data.itemsImported} item(s).`
      );
      await Promise.all([loadPantry(), loadMetrics()]);
    } catch {
      setError("Network error talking to the server.");
    } finally {
      setLoading(false);
    }
  }

  const statusText = status ? (STATUS_TEXT[status] ?? `Error: ${status}`) : null;
  const isError = status != null && status !== "connected";

  return (
    <main>
      <header
        style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
      >
        <h1>Spajz</h1>
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          <a href="/ask">Ask my pantry</a>
          {" · "}
          <a href="/admin">Admin</a>
          {" · "}
          {logtoOn ? (
            <>
              {userName} · <a href="/sign-out">Sign out</a>
            </>
          ) : (
            "login disabled"
          )}
        </span>
      </header>
      <p className="muted">Import your Rohlik orders into the pantry.</p>

      {statusText && (
        <div className={isError ? "error" : "notice"}>
          <p style={{ margin: 0 }}>{statusText}</p>
          {isError && statusDetail && (
            <pre style={{ margin: "0.5rem 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "0.75rem" }}>
              {statusDetail}
            </pre>
          )}
        </div>
      )}

      <h2>1 · Connect to Rohlik</h2>
      <div className="card">
        {connected ? (
          <div className="row" style={{ alignItems: "center" }}>
            <span>✅ Connected to Rohlik.</span>
            <button className="primary" onClick={handleImport} disabled={loading}>
              {loading ? "Importing…" : "Import last order"}
            </button>
            <a href="/api/rohlik/disconnect" className="muted">
              Disconnect
            </a>
          </div>
        ) : pendingAuthUrl ? (
          <div>
            <p style={{ marginTop: 0 }}>
              <strong>Step 1.</strong> Open the Rohlik sign-in page and log in:
            </p>
            <p>
              <a href={pendingAuthUrl} target="_blank" rel="noreferrer">
                <button className="primary" type="button">
                  Open Rohlik sign-in ↗
                </button>
              </a>
            </p>
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              After you approve, your browser will try to open a <code>localhost</code>{" "}
              page that won&apos;t load — that is expected. Copy the <code>code</code>{" "}
              value from that page&apos;s address bar (the part after <code>code=</code>),
              or paste the whole URL below.
            </p>
            <form method="post" action="/api/rohlik/oauth/finish" className="row">
              <div style={{ flex: "1 1 320px" }}>
                <label htmlFor="code">
                  <strong>Step 2.</strong> Paste the code (or the redirected URL)
                </label>
                <input id="code" name="code" type="text" autoComplete="off" required />
              </div>
              <button className="primary" type="submit">
                Finish connecting
              </button>
              <a href="/api/rohlik/disconnect" className="muted">
                Cancel
              </a>
            </form>
          </div>
        ) : (
          <div>
            <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
              Sign in with your Rohlik account. You authorize on Rohlik&apos;s own page —
              Spajz never sees your password.
            </p>
            <a href="/api/rohlik/oauth/start">
              <button className="primary">Connect Rohlik</button>
            </a>
          </div>
        )}
        {note && <p className="notice" style={{ marginBottom: 0 }}>{note}</p>}
        {error && <p className="error" style={{ marginBottom: 0 }}>{error}</p>}
      </div>

      {debug && (
        <details style={{ marginTop: "0.75rem" }}>
          <summary className="muted" style={{ cursor: "pointer", fontSize: "0.85rem" }}>
            Diagnostics (what Rohlik returned) — copy this if import fails
          </summary>
          <div style={{ marginTop: "0.5rem" }}>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(JSON.stringify(debug, null, 2));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copied ✓" : "Copy diagnostics"}
            </button>
          </div>
          <pre
            style={{
              overflow: "auto",
              fontSize: "0.75rem",
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              padding: "0.75rem",
              marginTop: "0.5rem",
            }}
          >
            {JSON.stringify(debug, null, 2)}
          </pre>
        </details>
      )}

      {metrics && metrics.dbConfigured && metrics.totalOrders > 0 && (
        <>
          <h2>Insights</h2>
          <div className="metrics-grid">
            <div className="stat">
              <span className="stat-num">{money(metrics.avgOrderValue, metrics.currency)}</span>
              <span className="muted stat-label">Average purchase</span>
            </div>
            <div className="stat">
              <span className="stat-num">{metrics.totalOrders}</span>
              <span className="muted stat-label">Total purchases</span>
            </div>
            <div className="stat">
              <span className="stat-num">{money(metrics.totalSpent, metrics.currency)}</span>
              <span className="muted stat-label">Total spent</span>
            </div>
            <div className="stat">
              <span className="stat-num">{metrics.favouriteDay?.day ?? "—"}</span>
              <span className="muted stat-label">
                Favourite day{metrics.favouriteDay ? ` (${metrics.favouriteDay.count}×)` : ""}
              </span>
            </div>
          </div>

          <div className="chart card">
            <strong style={{ fontSize: "0.95rem" }}>Spending — last 6 months</strong>
            <div style={{ marginTop: "0.5rem" }}>
              <BarChart
                points={metrics.monthly.map((m) => ({ label: m.label, value: m.total }))}
                valueFormat={(v) => money(v, metrics.currency)}
              />
            </div>
          </div>

          <div className="chart card" style={{ marginTop: "0.75rem" }}>
            <strong style={{ fontSize: "0.95rem" }}>Purchases per month</strong>
            <div style={{ marginTop: "0.5rem" }}>
              <BarChart points={metrics.monthly.map((m) => ({ label: m.label, value: m.count }))} />
            </div>
          </div>

          <div className="chart card" style={{ marginTop: "0.75rem" }}>
            <strong style={{ fontSize: "0.95rem" }}>Purchases by weekday</strong>
            <div style={{ marginTop: "0.5rem" }}>
              <BarChart points={metrics.byWeekday.map((d) => ({ label: d.day, value: d.count }))} />
            </div>
          </div>
        </>
      )}

      <h2>Pantry</h2>
      {!dbConfigured ? (
        <p className="muted">
          Database not configured (set <code>DATABASE_URL</code>). The pantry lives in Neon.
        </p>
      ) : !pantryReady ? (
        <p className="muted">Loading…</p>
      ) : pantry.length === 0 ? (
        <p className="muted">
          Your pantry is empty. Connect Rohlik and import an order (or use the{" "}
          <a href="/admin">admin</a> to import 1–6 months). If you just deployed, apply
          DB migrations in the admin first.
        </p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
            Showing <strong>{mode === "content" ? "content amount" : "package count"}</strong>{" "}
            (change in <a href="/admin">admin</a>).
          </p>
          {pantry.map((cat) => (
            <div className="card" key={cat.category} style={{ marginBottom: "0.75rem" }}>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
              >
                <h3 style={{ margin: 0, fontSize: "1.05rem" }}>{cat.category}</h3>
                <span className="muted" style={{ fontSize: "0.85rem" }}>
                  {mode === "content" && cat.content.length > 0
                    ? formatContent(cat.content)
                    : `${cat.packageTotal} pkg`}
                </span>
              </div>
              <table style={{ marginTop: "0.5rem" }}>
                <tbody>
                  {cat.items.map((it, i) => (
                    <tr key={i}>
                      <td>
                        {it.name}
                        {it.mcpCategory && (
                          <span className="muted" style={{ fontSize: "0.72rem" }}>
                            {" "}
                            · {it.mcpCategory}
                          </span>
                        )}
                      </td>
                      <td className="num">
                        {mode === "content" && it.contentAmount != null
                          ? `${it.contentAmount} ${it.contentUnit}`
                          : `${it.packageCount} × ${it.textualAmount ?? it.unit ?? "?"}`}
                      </td>
                      <td style={{ fontSize: "0.75rem" }} className="muted">
                        {it.lastBought
                          ? new Date(it.lastBought).toLocaleDateString()
                          : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </main>
  );
}
