"use client";

import { useState } from "react";
import { BarChart, LineChart, type ChartPoint } from "@/components/Charts";

interface ChartSpec {
  type: "bar" | "line";
  title: string;
  points: ChartPoint[];
}

interface AskResult {
  answer: string;
  chart: ChartSpec | null;
  sql: string;
  rows: Record<string, unknown>[];
  rowCount: number;
}

const EXAMPLES = [
  "How much did I spend each month?",
  "Which 5 products did I buy most often?",
  "What's my average order total?",
  "How many orders did I place by weekday?",
];

type ChartView = "bar" | "line" | "table";

function cell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return String(Math.round(v * 100) / 100);
  return String(v);
}

export default function AskClient() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [view, setView] = useState<ChartView>("table");

  async function ask(q: string) {
    const text = q.trim();
    if (text.length < 3 || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const data = await res.json();
      if (data.ok === false) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setResult(data as AskResult);
      setView(data.chart ? (data.chart.type as ChartView) : "table");
    } catch {
      setError("Network error talking to the server.");
    } finally {
      setLoading(false);
    }
  }

  const columns = result && result.rows.length > 0 ? Object.keys(result.rows[0]) : [];

  return (
    <main>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>Ask my pantry</h1>
        <a href="/dashboard" className="muted" style={{ fontSize: "0.85rem" }}>
          ← Dashboard
        </a>
      </header>
      <p className="muted">
        Ask a question about your orders in plain language. The AI writes a read-only query,
        runs it, and explains the result.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="row"
        style={{ alignItems: "flex-end" }}
      >
        <div style={{ flex: "1 1 260px" }}>
          <label htmlFor="q">Your question</label>
          <input
            id="q"
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="How much did I spend each month?"
            autoComplete="off"
          />
        </div>
        <button className="primary" type="submit" disabled={loading}>
          {loading ? "Thinking…" : "Ask"}
        </button>
      </form>

      <div className="row" style={{ marginTop: "0.6rem", gap: "0.4rem" }}>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={loading}
            onClick={() => {
              setQuestion(ex);
              ask(ex);
            }}
            style={{ fontSize: "0.78rem", padding: "0.3rem 0.6rem" }}
          >
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <p className="error" style={{ marginTop: "1rem" }}>
          {error}
        </p>
      )}

      {result && (
        <>
          <h2>Answer</h2>
          <div className="card">
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{result.answer}</p>
          </div>

          {result.chart && (
            <div className="chart card" style={{ marginTop: "0.75rem" }}>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}
              >
                <strong style={{ fontSize: "0.95rem" }}>{result.chart.title}</strong>
                <div className="row" style={{ gap: "0.3rem" }}>
                  {(["bar", "line", "table"] as ChartView[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={view === v ? "primary" : undefined}
                      onClick={() => setView(v)}
                      style={{ fontSize: "0.75rem", padding: "0.25rem 0.55rem", textTransform: "capitalize" }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: "0.5rem" }}>
                {view === "bar" && <BarChart points={result.chart.points} />}
                {view === "line" && <LineChart points={result.chart.points} />}
                {view === "table" && (
                  <table>
                    <tbody>
                      {result.chart.points.map((p, i) => (
                        <tr key={i}>
                          <td>{p.label}</td>
                          <td className="num">{cell(p.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          <h2>
            Result rows{" "}
            <span className="muted" style={{ fontSize: "0.8rem", fontWeight: "normal" }}>
              ({result.rowCount}
              {result.rowCount > result.rows.length ? `, showing ${result.rows.length}` : ""})
            </span>
          </h2>
          {columns.length > 0 ? (
            <div className="card" style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 50).map((r, i) => (
                    <tr key={i}>
                      {columns.map((c) => (
                        <td key={c}>{cell(r[c])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No rows returned.</p>
          )}

          <details style={{ marginTop: "0.75rem" }}>
            <summary className="muted" style={{ cursor: "pointer", fontSize: "0.85rem" }}>
              SQL used
            </summary>
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
              {result.sql}
            </pre>
          </details>
        </>
      )}
    </main>
  );
}
