"use client";

// Tiny dependency-free, responsive SVG charts. Both take the same
// `points: { label, value }[]` and scale to their container via a viewBox.

export interface ChartPoint {
  label: string;
  value: number;
}

const W = 320;
const PAD_X = 8;
const PAD_BOTTOM = 22;
const PAD_TOP = 14;

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function defaultFormat(v: number): string {
  if (Math.abs(v) >= 1000) return `${Math.round(v / 100) / 10}k`;
  return String(Math.round(v * 10) / 10);
}

function Empty() {
  return (
    <p className="muted" style={{ fontSize: "0.85rem", margin: "0.5rem 0" }}>
      No data yet.
    </p>
  );
}

export function BarChart({
  points,
  height = 160,
  valueFormat = defaultFormat,
}: {
  points: ChartPoint[];
  height?: number;
  valueFormat?: (v: number) => string;
}) {
  if (!points.length || points.every((p) => p.value === 0)) return <Empty />;

  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const innerW = W - PAD_X * 2;
  const innerH = height - PAD_TOP - PAD_BOTTOM;
  const slot = innerW / points.length;
  const barW = Math.min(slot * 0.62, 44);

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      width="100%"
      role="img"
      style={{ display: "block" }}
      preserveAspectRatio="xMidYMid meet"
    >
      <line
        x1={PAD_X}
        y1={height - PAD_BOTTOM}
        x2={W - PAD_X}
        y2={height - PAD_BOTTOM}
        stroke="var(--border)"
      />
      {points.map((p, i) => {
        const h = max > 0 ? (p.value / max) * innerH : 0;
        const x = PAD_X + slot * i + (slot - barW) / 2;
        const y = height - PAD_BOTTOM - h;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, 0)}
              rx={3}
              fill="var(--accent)"
            >
              <title>{`${p.label}: ${p.value}`}</title>
            </rect>
            {p.value > 0 && (
              <text
                x={x + barW / 2}
                y={y - 3}
                textAnchor="middle"
                fontSize="9"
                fill="var(--muted)"
              >
                {valueFormat(p.value)}
              </text>
            )}
            <text
              x={x + barW / 2}
              y={height - PAD_BOTTOM + 13}
              textAnchor="middle"
              fontSize="9"
              fill="var(--muted)"
            >
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function LineChart({
  points,
  height = 160,
  valueFormat = defaultFormat,
}: {
  points: ChartPoint[];
  height?: number;
  valueFormat?: (v: number) => string;
}) {
  if (!points.length || points.every((p) => p.value === 0)) return <Empty />;

  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const innerW = W - PAD_X * 2;
  const innerH = height - PAD_TOP - PAD_BOTTOM;
  const n = points.length;
  const x = (i: number) => PAD_X + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (v: number) => height - PAD_BOTTOM - (max > 0 ? (v / max) * innerH : 0);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.value)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      width="100%"
      role="img"
      style={{ display: "block" }}
      preserveAspectRatio="xMidYMid meet"
    >
      <line
        x1={PAD_X}
        y1={height - PAD_BOTTOM}
        x2={W - PAD_X}
        y2={height - PAD_BOTTOM}
        stroke="var(--border)"
      />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r={3} fill="var(--accent)">
            <title>{`${p.label}: ${p.value}`}</title>
          </circle>
          {p.value > 0 && (
            <text x={x(i)} y={y(p.value) - 6} textAnchor="middle" fontSize="9" fill="var(--muted)">
              {valueFormat(p.value)}
            </text>
          )}
          <text
            x={x(i)}
            y={height - PAD_BOTTOM + 13}
            textAnchor="middle"
            fontSize="9"
            fill="var(--muted)"
          >
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
