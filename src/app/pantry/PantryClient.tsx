"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

interface StockItem {
  id: string;
  productId: string | null;
  name: string;
  unit: string | null;
  baseQuantity: number;
  remaining: number;
  remainingContent: number | null;
  contentUnit: string | null;
  ratePerWeek: number;
  manual: boolean;
  needed: boolean;
  daysUntilEmpty: number | null;
  stockedAt: string;
  lastBought: string | null;
}

interface PantryGroup {
  category: string;
  categoryId: string | null;
  needed: boolean;
  items: StockItem[];
}

interface ProductOption {
  id: string;
  name: string;
  unit: string | null;
}

interface OrderOption {
  id: string;
  orderedAt: string | null;
  itemsCount: number | null;
  total: string | null;
  currency: string | null;
}

type AddMode = "product" | "freeText" | "order";

const post = (url: string, body?: unknown) =>
  fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

const patch = (url: string, body: unknown) =>
  fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

function remainingLabel(it: StockItem): string {
  const pkg = `${it.remaining} ${it.unit ?? "pkg"}`;
  return it.remainingContent != null
    ? `${pkg} · ≈ ${it.remainingContent} ${it.contentUnit}`
    : pkg;
}

export default function PantryClient({
  logtoOn,
  userName,
}: {
  logtoOn: boolean;
  userName: string | null;
}) {
  const [groups, setGroups] = useState<PantryGroup[]>([]);
  const [ready, setReady] = useState(false);
  const [dbConfigured, setDbConfigured] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // inline row editor
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editRate, setEditRate] = useState("");

  // add modal
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<AddMode>("product");
  const [pq, setPq] = useState("");
  const [presults, setPresults] = useState<ProductOption[]>([]);
  const [selProduct, setSelProduct] = useState<ProductOption | null>(null);
  const [qty, setQty] = useState("1");
  const [label, setLabel] = useState("");
  const [freeUnit, setFreeUnit] = useState("");
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [orderId, setOrderId] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pantry/stock");
      const data = await res.json();
      setDbConfigured(Boolean(data.dbConfigured));
      setGroups(Array.isArray(data.groups) ? data.groups : []);
    } catch {
      setGroups([]);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // debounced product search
  useEffect(() => {
    if (mode !== "product" || selProduct) return;
    const q = pq.trim();
    if (!q) {
      setPresults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setPresults(Array.isArray(data.products) ? data.products : []);
      } catch {
        setPresults([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [pq, mode, selProduct]);

  // load recent orders when the "from a purchase" tab is shown
  useEffect(() => {
    if (!modalOpen || mode !== "order" || orders.length > 0) return;
    fetch("/api/orders")
      .then((r) => r.json())
      .then((d) => setOrders(Array.isArray(d.orders) ? d.orders : []))
      .catch(() => {});
  }, [modalOpen, mode, orders.length]);

  function closeModal() {
    setModalOpen(false);
    setPq("");
    setPresults([]);
    setSelProduct(null);
    setQty("1");
    setLabel("");
    setFreeUnit("");
    setOrderId("");
  }

  async function run(label: string, fn: () => Promise<Response>, closeOnDone = false) {
    setBusy(label);
    setMsg(null);
    try {
      const res = await fn();
      const data = await res.json();
      if (data && data.ok === false) {
        setMsg(`${label}: ${data.error ?? "failed"}`);
      } else if (data && typeof data.restocked === "number") {
        const total = (data.created ?? 0) + (data.restocked ?? 0);
        setMsg(
          `${label}: ${total} item(s) stocked` +
            (data.skipped ? `, ${data.skipped} unmatched line(s) skipped` : "") +
            "."
        );
        if (closeOnDone) closeModal();
      } else {
        setMsg(`${label}: done.`);
        if (closeOnDone) closeModal();
      }
    } catch (e) {
      setMsg(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
      await load();
    }
  }

  function startEdit(it: StockItem) {
    setEditingId(it.id);
    setEditQty(String(it.remaining));
    setEditRate(it.manual ? String(it.ratePerWeek) : "");
  }

  function saveEdit(it: StockItem) {
    const body: { quantity?: number; ratePerWeek?: number | null } = {};
    if (editQty.trim() !== "") {
      const q = Number(editQty);
      if (!Number.isFinite(q) || q < 0) return;
      body.quantity = q;
    }
    if (editRate.trim() === "") {
      body.ratePerWeek = null;
    } else {
      const r = Number(editRate);
      if (!Number.isFinite(r) || r < 0) return;
      body.ratePerWeek = r;
    }
    setEditingId(null);
    run("Update item", () => patch(`/api/pantry/stock/${it.id}`, body));
  }

  function submitAdd() {
    const quantity = Number(qty);
    if (mode === "product") {
      if (!selProduct || !Number.isFinite(quantity) || quantity <= 0) return;
      run(
        "Add item",
        () =>
          post("/api/pantry/stock", {
            mode: "product",
            productId: selProduct.id,
            quantity,
            unit: selProduct.unit ?? undefined,
          }),
        true
      );
    } else if (mode === "freeText") {
      if (!label.trim() || !Number.isFinite(quantity) || quantity <= 0) return;
      run(
        "Add item",
        () =>
          post("/api/pantry/stock", {
            mode: "freeText",
            label: label.trim(),
            quantity,
            unit: freeUnit.trim() || undefined,
          }),
        true
      );
    } else {
      if (!orderId) return;
      run("Add from purchase", () => post("/api/pantry/restock", { orderId }), true);
    }
  }

  const empty = ready && groups.length === 0;

  return (
    <main>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>My pantry</h1>
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          <a href="/dashboard">Dashboard</a>
          {" · "}
          <a href="/ask">Ask</a>
          {" · "}
          <a href="/admin">Admin</a>
          {logtoOn ? (
            <>
              {" · "}
              {userName} · <a href="/sign-out">Sign out</a>
            </>
          ) : null}
        </span>
      </header>
      <p className="muted">
        What you have at home and how long it should last, estimated from your buying
        history over the last 6 months. ♥ marks staples you want to keep stocked.
      </p>

      <div className="row" style={{ marginTop: "1rem" }}>
        <button
          className="primary"
          disabled={busy !== null}
          onClick={() =>
            run("Stock from last purchase", () =>
              post("/api/pantry/restock", { orderId: "last" })
            )
          }
        >
          {busy === "Stock from last purchase" ? "Stocking…" : "Stock from last purchase"}
        </button>
        <button disabled={busy !== null} onClick={() => setModalOpen(true)}>
          Add item
        </button>
      </div>

      {msg && <p className="notice" style={{ marginTop: "0.75rem" }}>{msg}</p>}
      {!dbConfigured && (
        <p className="error">
          Database not configured (set <code>DATABASE_URL</code>).
        </p>
      )}

      {!ready ? (
        <p className="muted">Loading…</p>
      ) : empty ? (
        <p className="muted" style={{ marginTop: "1rem" }}>
          Your pantry is empty. Import an order on the <a href="/dashboard">dashboard</a>{" "}
          (or the <a href="/admin">admin</a>), then <strong>Stock from last purchase</strong>,
          or <strong>Add item</strong> manually.
        </p>
      ) : (
        groups.map((g) => (
          <div className="card" key={g.category} style={{ marginTop: "1rem", overflowX: "auto" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.05rem" }}>{g.category}</h3>
              {g.categoryId && (
                <button
                  className={g.needed ? "heart on" : "heart"}
                  disabled={busy !== null}
                  title={g.needed ? "Needed — click to unmark" : "Mark category as needed"}
                  onClick={() =>
                    run("Update category", () =>
                      patch(`/api/categories/${g.categoryId}`, { needed: !g.needed })
                    )
                  }
                >
                  {g.needed ? "♥" : "♡"}
                </button>
              )}
            </div>
            <table style={{ marginTop: "0.5rem" }}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Remaining</th>
                  <th className="num">Rate / wk</th>
                  <th className="num">Days left</th>
                  <th>Stocked</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((it) => {
                  const low = it.daysUntilEmpty != null && it.daysUntilEmpty < 7;
                  return (
                    <Fragment key={it.id}>
                      <tr>
                        <td>
                          {it.name}
                          {it.needed && <span className="heart on"> ♥</span>}
                        </td>
                        <td className="num">{remainingLabel(it)}</td>
                        <td className="num">
                          {it.ratePerWeek > 0 ? it.ratePerWeek : "—"}
                          {it.manual && (
                            <span className="muted" style={{ fontSize: "0.7rem" }}>
                              {" "}
                              manual
                            </span>
                          )}
                        </td>
                        <td className={low ? "num error" : "num"}>
                          {it.daysUntilEmpty != null ? `${it.daysUntilEmpty}d` : "—"}
                        </td>
                        <td className="muted" style={{ fontSize: "0.75rem" }}>
                          {new Date(it.stockedAt).toLocaleDateString()}
                        </td>
                        <td className="num" style={{ whiteSpace: "nowrap" }}>
                          <button
                            className={it.needed ? "heart on" : "heart"}
                            disabled={busy !== null}
                            title={it.needed ? "Needed — click to unmark" : "Mark as needed"}
                            onClick={() =>
                              run("Update item", () =>
                                patch(`/api/pantry/stock/${it.id}`, { needed: !it.needed })
                              )
                            }
                          >
                            {it.needed ? "♥" : "♡"}
                          </button>
                          <button
                            disabled={busy !== null}
                            title="Adjust quantity / rate"
                            onClick={() => (editingId === it.id ? setEditingId(null) : startEdit(it))}
                            style={{ padding: "0.2rem 0.45rem", fontSize: "0.8rem" }}
                          >
                            ✎
                          </button>
                          <button
                            disabled={busy !== null}
                            title="Remove"
                            onClick={() => {
                              if (confirm(`Remove ${it.name} from pantry?`))
                                run("Delete", () =>
                                  fetch(`/api/pantry/stock/${it.id}`, { method: "DELETE" })
                                );
                            }}
                            style={{ padding: "0.2rem 0.45rem", fontSize: "0.8rem" }}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                      {editingId === it.id && (
                        <tr>
                          <td colSpan={6}>
                            <div className="row" style={{ alignItems: "flex-end" }}>
                              <div style={{ flex: "0 1 130px" }}>
                                <label htmlFor={`q-${it.id}`}>Quantity</label>
                                <input
                                  id={`q-${it.id}`}
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={editQty}
                                  onChange={(e) => setEditQty(e.target.value)}
                                />
                              </div>
                              <div style={{ flex: "0 1 160px" }}>
                                <label htmlFor={`r-${it.id}`}>Uses / week</label>
                                <input
                                  id={`r-${it.id}`}
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={editRate}
                                  onChange={(e) => setEditRate(e.target.value)}
                                  placeholder={`auto: ${it.ratePerWeek}`}
                                />
                              </div>
                              <button
                                className="primary"
                                disabled={busy !== null}
                                onClick={() => saveEdit(it)}
                              >
                                Save
                              </button>
                              <button disabled={busy !== null} onClick={() => setEditingId(null)}>
                                Cancel
                              </button>
                            </div>
                            <p className="muted" style={{ fontSize: "0.75rem", margin: "0.4rem 0 0" }}>
                              Leave <em>Uses / week</em> empty to use the history estimate.
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}

      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 style={{ margin: 0 }}>Add to pantry</h2>
              <button onClick={closeModal} style={{ padding: "0.2rem 0.5rem" }}>
                ✕
              </button>
            </div>

            <div className="modal-tabs" style={{ marginTop: "1rem" }}>
              {(
                [
                  ["product", "My items"],
                  ["freeText", "Free text"],
                  ["order", "From a purchase"],
                ] as const
              ).map(([m, lbl]) => (
                <button
                  key={m}
                  className={mode === m ? "active" : ""}
                  onClick={() => setMode(m)}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {mode === "product" && (
              <div>
                {selProduct ? (
                  <p style={{ marginTop: 0 }}>
                    {selProduct.name}{" "}
                    <button
                      onClick={() => {
                        setSelProduct(null);
                        setPq("");
                      }}
                      style={{ padding: "0.1rem 0.4rem", fontSize: "0.75rem" }}
                    >
                      change
                    </button>
                  </p>
                ) : (
                  <>
                    <label htmlFor="pq">Search my products</label>
                    <input
                      id="pq"
                      type="text"
                      value={pq}
                      onChange={(e) => setPq(e.target.value)}
                      placeholder="e.g. eggs, milk…"
                      autoComplete="off"
                    />
                    {presults.length > 0 && (
                      <div className="card" style={{ marginTop: "0.5rem", padding: "0.25rem" }}>
                        {presults.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => setSelProduct(p)}
                            style={{
                              display: "block",
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              padding: "0.4rem 0.5rem",
                            }}
                          >
                            {p.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <label htmlFor="pqty" style={{ marginTop: "0.75rem" }}>
                  Quantity (packages)
                </label>
                <input
                  id="pqty"
                  type="number"
                  min="0"
                  step="any"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
            )}

            {mode === "freeText" && (
              <div>
                <label htmlFor="ftlabel">Item</label>
                <input
                  id="ftlabel"
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. olive oil"
                />
                <label htmlFor="ftqty" style={{ marginTop: "0.75rem" }}>
                  Quantity
                </label>
                <input
                  id="ftqty"
                  type="number"
                  min="0"
                  step="any"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
                <label htmlFor="ftunit" style={{ marginTop: "0.75rem" }}>
                  Unit (optional)
                </label>
                <input
                  id="ftunit"
                  type="text"
                  value={freeUnit}
                  onChange={(e) => setFreeUnit(e.target.value)}
                  placeholder="e.g. bottle, kg"
                />
                <p className="muted" style={{ fontSize: "0.8rem" }}>
                  Free-text items have no buying history, so they stay put (no daily estimate)
                  unless you set a rate.
                </p>
              </div>
            )}

            {mode === "order" && (
              <div>
                <label htmlFor="ord">Pick a past purchase</label>
                <select
                  id="ord"
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  style={{ padding: "0.4rem", borderRadius: 6, border: "1px solid var(--border)", width: "100%" }}
                >
                  <option value="">Choose an order…</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.orderedAt ? new Date(o.orderedAt).toLocaleDateString() : "?"} ·{" "}
                      {o.itemsCount ?? "?"} items
                      {o.total ? ` · ${Math.round(Number(o.total))} ${o.currency ?? ""}` : ""}
                    </option>
                  ))}
                </select>
                <p className="muted" style={{ fontSize: "0.8rem" }}>
                  Adds every matched product from that order onto your pantry.
                </p>
              </div>
            )}

            <div style={{ marginTop: "1rem" }}>
              <button className="primary" disabled={busy !== null} onClick={submitAdd}>
                {busy ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
