"use client";

import { useEffect, useState } from "react";
import type {
  LastOrder,
  LastOrderResponse,
  OrderLineItem,
  RohlikDebug,
} from "@/lib/rohlik/types";
import {
  addItemsToPantry,
  clearPantry,
  isOrderImported,
  loadPantry,
  markOrderImported,
  type Pantry,
} from "@/lib/pantry/storage";

interface Selection {
  checked: boolean;
  qty: number;
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
  status,
  statusDetail,
}: {
  logtoOn: boolean;
  userName: string | null;
  connected: boolean;
  status: string | null;
  statusDetail: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [order, setOrder] = useState<LastOrder | null>(null);
  const [alreadyImported, setAlreadyImported] = useState(false);
  const [selection, setSelection] = useState<Selection[]>([]);
  const [debug, setDebug] = useState<RohlikDebug | null>(null);

  const [pantry, setPantry] = useState<Pantry>({});

  useEffect(() => {
    setPantry(loadPantry());
  }, []);

  async function handleImport() {
    setLoading(true);
    setError(null);
    setOrder(null);
    setDebug(null);

    try {
      const res = await fetch("/api/rohlik/last-order", { method: "POST" });
      const data = (await res.json()) as LastOrderResponse;
      setDebug(data.debug ?? null);

      if (!data.ok) {
        setError(data.error);
        return;
      }

      setOrder(data.order);
      setAlreadyImported(isOrderImported(data.order.orderId));
      setSelection(
        data.order.items.map((it) => ({ checked: true, qty: it.quantity }))
      );
    } catch {
      setError("Network error talking to the server.");
    } finally {
      setLoading(false);
    }
  }

  function toggle(index: number, checked: boolean) {
    setSelection((prev) =>
      prev.map((s, i) => (i === index ? { ...s, checked } : s))
    );
  }

  function setQty(index: number, qty: number) {
    setSelection((prev) => prev.map((s, i) => (i === index ? { ...s, qty } : s)));
  }

  function handleAddToPantry() {
    if (!order) return;

    const items: OrderLineItem[] = order.items
      .map((it, i) => ({ ...it, quantity: selection[i]?.qty ?? it.quantity }))
      .filter((_, i) => selection[i]?.checked);

    const updated = addItemsToPantry(items, order.orderedAt);
    markOrderImported(order.orderId);
    setPantry(updated);
    setAlreadyImported(true);
  }

  function handleClear() {
    if (!confirm("Clear the whole pantry and import history?")) return;
    clearPantry();
    setPantry({});
    setAlreadyImported(false);
  }

  const pantryRows = Object.values(pantry).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const statusText = status ? (STATUS_TEXT[status] ?? `Error: ${status}`) : null;
  const isError = status != null && status !== "connected";

  return (
    <main>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <h1>Spajz</h1>
        {logtoOn ? (
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            {userName} · <a href="/sign-out">Sign out</a>
          </span>
        ) : (
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            login disabled
          </span>
        )}
      </header>
      <p className="muted">Import your last Rohlik order into the pantry.</p>

      {statusText && (
        <div className={isError ? "error" : "notice"}>
          <p style={{ margin: 0 }}>{statusText}</p>
          {isError && statusDetail && (
            <pre
              style={{
                margin: "0.5rem 0 0",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: "0.75rem",
              }}
            >
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
            <button
              className="primary"
              onClick={handleImport}
              disabled={loading}
            >
              {loading ? "Importing…" : "Import last order"}
            </button>
            <a href="/api/rohlik/disconnect" className="muted">
              Disconnect
            </a>
          </div>
        ) : (
          <div>
            <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
              Sign in with your Rohlik account. You authorize on Rohlik&apos;s own
              page — Spajz never sees your password.
            </p>
            <a href="/api/rohlik/oauth/start">
              <button className="primary">Connect Rohlik</button>
            </a>
          </div>
        )}
        {error && (
          <p className="error" style={{ marginBottom: 0 }}>
            {error}
          </p>
        )}
      </div>

      {debug && (
        <details style={{ marginTop: "0.75rem" }}>
          <summary
            className="muted"
            style={{ cursor: "pointer", fontSize: "0.85rem" }}
          >
            Diagnostics (what Rohlik returned) — copy this if import fails
          </summary>
          <pre
            style={{
              overflow: "auto",
              fontSize: "0.75rem",
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              padding: "0.75rem",
            }}
          >
            {JSON.stringify(debug, null, 2)}
          </pre>
        </details>
      )}

      {order && (
        <>
          <h2>2 · Last order</h2>
          {alreadyImported && (
            <p className="notice">
              This order ({order.orderId}) is already in your pantry. Importing
              again is disabled.
            </p>
          )}
          <div className="card">
            <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
              Order {order.orderId}
              {order.orderedAt
                ? ` · ${new Date(order.orderedAt).toLocaleDateString()}`
                : ""}
            </p>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th>Unit</th>
                  <th className="num">Price</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selection[i]?.checked ?? false}
                        disabled={alreadyImported}
                        onChange={(e) => toggle(i, e.target.checked)}
                      />
                    </td>
                    <td>{it.name}</td>
                    <td className="num">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        style={{ width: "5rem", textAlign: "right" }}
                        value={selection[i]?.qty ?? it.quantity}
                        disabled={alreadyImported}
                        onChange={(e) => setQty(i, Number(e.target.value))}
                      />
                    </td>
                    <td>{it.unit ?? ""}</td>
                    <td className="num">
                      {it.price != null ? `${it.price} Kč` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: "1rem" }}>
              <button
                className="primary"
                onClick={handleAddToPantry}
                disabled={alreadyImported}
              >
                Add selected to pantry
              </button>
            </div>
          </div>
        </>
      )}

      <h2>Pantry</h2>
      {pantryRows.length === 0 ? (
        <p className="muted">Your pantry is empty.</p>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Qty</th>
                <th>Unit</th>
                <th>Last bought</th>
              </tr>
            </thead>
            <tbody>
              {pantryRows.map((p) => (
                <tr key={p.key}>
                  <td>{p.name}</td>
                  <td className="num">{p.quantity}</td>
                  <td>{p.unit ?? ""}</td>
                  <td>{new Date(p.lastBought).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: "1rem" }}>
            <button onClick={handleClear}>Clear pantry</button>
          </div>
        </div>
      )}
    </main>
  );
}
