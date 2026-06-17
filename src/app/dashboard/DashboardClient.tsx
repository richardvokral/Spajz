"use client";

import { useEffect, useState } from "react";
import type { LastOrder, LastOrderResponse, OrderLineItem } from "@/lib/rohlik/types";
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

export default function DashboardClient({
  logtoOn,
  userName,
}: {
  logtoOn: boolean;
  userName: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(""); // session-only, never persisted
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [order, setOrder] = useState<LastOrder | null>(null);
  const [alreadyImported, setAlreadyImported] = useState(false);
  const [selection, setSelection] = useState<Selection[]>([]);

  const [pantry, setPantry] = useState<Pantry>({});

  useEffect(() => {
    setPantry(loadPantry());
  }, []);

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setOrder(null);

    try {
      const res = await fetch("/api/rohlik/last-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as LastOrderResponse;

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
    setSelection((prev) =>
      prev.map((s, i) => (i === index ? { ...s, qty } : s))
    );
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

      <h2>1 · Connect to Rohlik</h2>
      <form className="card" onSubmit={handleImport}>
        <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
          Your Rohlik credentials are used once for this import and are never
          stored.
        </p>
        <div className="row">
          <div style={{ flex: "1 1 220px" }}>
            <label htmlFor="email">Rohlik email</label>
            <input
              id="email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div style={{ flex: "1 1 220px" }}>
            <label htmlFor="password">Rohlik password</label>
            <input
              id="password"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button className="primary" type="submit" disabled={loading}>
            {loading ? "Importing…" : "Import last order"}
          </button>
        </div>
        {error && (
          <p className="error" style={{ marginBottom: 0 }}>
            {error}
          </p>
        )}
      </form>

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
