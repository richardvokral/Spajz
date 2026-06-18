"use client";

import { useCallback, useEffect, useState } from "react";

interface ImportLogRow {
  id: string;
  kind: string;
  status: string;
  ordersSeen: number;
  ordersImported: number;
  itemsImported: number;
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface Status {
  dbConfigured: boolean;
  anthropicConfigured: boolean;
  definedMigrations: string[];
  appliedMigrations: { hash: string; createdAt: number }[];
  migrated: boolean;
  counts: Record<string, number> | null;
  settings: {
    aiCategorizationEnabled: boolean;
    aiParseFallbackEnabled: boolean;
    aiModel: string;
    pantryQuantityMode: string;
  } | null;
  importLogs: ImportLogRow[];
}

const MODELS = ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"];

export default function AdminClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [catDebug, setCatDebug] = useState<string | null>(null);

  // local settings form
  const [aiCat, setAiCat] = useState(false);
  const [aiParse, setAiParse] = useState(false);
  const [model, setModel] = useState("claude-opus-4-8");
  const [qtyMode, setQtyMode] = useState("package");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/status");
    const data = (await res.json()) as Status;
    setStatus(data);
    if (data.settings) {
      setAiCat(data.settings.aiCategorizationEnabled);
      setAiParse(data.settings.aiParseFallbackEnabled);
      setModel(data.settings.aiModel);
      setQtyMode(data.settings.pantryQuantityMode ?? "package");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(label: string, fn: () => Promise<Response>) {
    setBusy(label);
    setMsg(null);
    try {
      const res = await fn();
      const data = await res.json();
      if (data && data.ok === false) {
        setMsg(`${label}: ${data.error ?? "failed"}`);
      } else if (data && typeof data.ordersImported === "number") {
        setMsg(
          `${label}: ${data.ordersImported} order(s), ${data.itemsImported} item(s) imported (saw ${data.ordersSeen}).`
        );
      } else if (data && typeof data.aiCategorized === "number") {
        setMsg(
          `${label}: Rohlik ${data.mcpFetched}, AI ${data.aiCategorized}, fallback ${data.fallbackCategorized}` +
            (data.errors?.length ? ` · errors: ${data.errors.join("; ")}` : "") +
            (data.connectedToRohlik === false
              ? " · (not connected to Rohlik — Rohlik categories skipped)"
              : "")
        );
        setCatDebug(data.debugSample ?? null);
      } else {
        setMsg(`${label}: done.`);
      }
    } catch (e) {
      setMsg(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
      await load();
    }
  }

  const post = (url: string, body?: unknown) =>
    fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

  const pending = status
    ? status.definedMigrations.length - status.appliedMigrations.length
    : 0;

  return (
    <main>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>Spajz admin</h1>
        <a href="/dashboard" className="muted" style={{ fontSize: "0.85rem" }}>
          ← Dashboard
        </a>
      </header>

      {msg && <p className="notice">{msg}</p>}
      {status && !status.dbConfigured && (
        <p className="error">DATABASE_URL is not set — configure Neon to use the database.</p>
      )}

      <h2>Database</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Migrations applied: <strong>{status?.appliedMigrations.length ?? 0}</strong>{" "}
          / defined: <strong>{status?.definedMigrations.length ?? 0}</strong>
          {pending > 0 && <span className="error"> · {pending} pending</span>}
        </p>
        <ul className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
          {status?.definedMigrations.map((m, i) => (
            <li key={m}>
              {m} {i < (status?.appliedMigrations.length ?? 0) ? "✅" : "⏳"}
            </li>
          ))}
        </ul>
        <button
          className="primary"
          disabled={!status?.dbConfigured || busy !== null}
          onClick={() => act("Apply migrations", () => post("/api/admin/migrate"))}
        >
          {busy === "Apply migrations" ? "Applying…" : "Apply migrations"}
        </button>
        {status?.counts && (
          <table style={{ marginTop: "1rem" }}>
            <tbody>
              {Object.entries(status.counts).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="num">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>AI</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
          ANTHROPIC_API_KEY:{" "}
          {status?.anthropicConfigured ? "configured ✅" : "not set — AI features are off"}
        </p>
        <label>
          <input type="checkbox" checked={aiCat} onChange={(e) => setAiCat(e.target.checked)} />{" "}
          Auto-categorize products
        </label>
        <label>
          <input type="checkbox" checked={aiParse} onChange={(e) => setAiParse(e.target.checked)} />{" "}
          Parse-fallback for strange responses
        </label>
        <label htmlFor="model">Model</label>
        <select
          id="model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          style={{ padding: "0.4rem", borderRadius: 6, border: "1px solid var(--border)" }}
        >
          {MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <label htmlFor="qtyMode" style={{ marginTop: "0.75rem" }}>
          Pantry quantity display
        </label>
        <select
          id="qtyMode"
          value={qtyMode}
          onChange={(e) => setQtyMode(e.target.value)}
          style={{ padding: "0.4rem", borderRadius: 6, border: "1px solid var(--border)" }}
        >
          <option value="package">Per package (count of boxes)</option>
          <option value="content">By content amount (parsed size)</option>
        </select>
        <div style={{ marginTop: "0.75rem" }}>
          <button
            className="primary"
            disabled={!status?.dbConfigured || busy !== null}
            onClick={() =>
              act("Save settings", () =>
                post("/api/admin/settings", {
                  aiCategorizationEnabled: aiCat,
                  aiParseFallbackEnabled: aiParse,
                  aiModel: model,
                  pantryQuantityMode: qtyMode,
                })
              )
            }
          >
            Save settings
          </button>
        </div>
      </div>

      <h2>Categorization</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
          Fetch Rohlik categories (needs a connected Rohlik session) and assign AI
          categories to every product that doesn&apos;t have one yet. Safe to run
          repeatedly.
        </p>
        <button
          className="primary"
          disabled={!status?.dbConfigured || busy !== null}
          onClick={() => act("Run categorization", () => post("/api/admin/categorize"))}
        >
          {busy === "Run categorization" ? "Categorizing…" : "Run categorization"}
        </button>
        {catDebug && (
          <details style={{ marginTop: "0.75rem" }}>
            <summary className="muted" style={{ cursor: "pointer", fontSize: "0.85rem" }}>
              Rohlik product sample (confirm category field names)
            </summary>
            <pre
              style={{
                overflow: "auto",
                fontSize: "0.72rem",
                background: "#fff",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                padding: "0.75rem",
              }}
            >
              {catDebug}
            </pre>
          </details>
        )}
      </div>

      <h2>Imports</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
          Requires a connected Rohlik session (see the Dashboard).
        </p>
        <div className="row">
          {(
            [
              ["Import last order", "last"],
              ["Import last 1 month", "1month"],
              ["Import last 6 months", "6months"],
            ] as const
          ).map(([label, kind]) => (
            <button
              key={kind}
              className="primary"
              disabled={!status?.dbConfigured || busy !== null}
              onClick={() => act(label, () => post("/api/import", { kind }))}
            >
              {busy === label ? "Importing…" : label}
            </button>
          ))}
        </div>
      </div>

      <h2>Import log</h2>
      {status && status.importLogs.length > 0 ? (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>Status</th>
                <th className="num">Orders</th>
                <th className="num">Items</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {status.importLogs.map((l) => (
                <tr key={l.id}>
                  <td>{new Date(l.startedAt).toLocaleString()}</td>
                  <td>{l.kind}</td>
                  <td className={l.status === "error" ? "error" : ""}>{l.status}</td>
                  <td className="num">{l.ordersImported}</td>
                  <td className="num">{l.itemsImported}</td>
                  <td style={{ fontSize: "0.75rem" }}>{l.message ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No imports yet.</p>
      )}

      <h2>Danger zone</h2>
      <div className="card">
        <div className="row">
          <button
            disabled={!status?.dbConfigured || busy !== null}
            onClick={() => {
              if (confirm("Delete all orders, items, price history and pantry?"))
                act("Delete orders", () => post("/api/admin/delete", { what: "orders" }));
            }}
          >
            Delete orders &amp; items
          </button>
          <button
            disabled={!status?.dbConfigured || busy !== null}
            onClick={() => {
              if (confirm("Delete EVERYTHING including products and categories?"))
                act("Delete everything", () => post("/api/admin/delete", { what: "all" }));
            }}
          >
            Delete everything
          </button>
        </div>
      </div>
    </main>
  );
}
