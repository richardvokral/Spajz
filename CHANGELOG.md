# Changelog

All notable changes to Spajz are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions are aligned
with the build phases (`0.1.0` MVP → `0.2.0` Phase 2 → `0.2.1` Phase 2.1 →
`0.3.0` Phase 3a → `0.4.0` Phase 3b). The version in `package.json` tracks the
latest released heading here.

## [0.4.0] - 2026-06-21 — Phase 3b (pantry stock tracking)

### Added
- **Pantry stock tracking** — Spajz now tracks what you actually have at home, per
  **product**. Each item shows estimated **remaining** packages (plus a parsed
  content amount, e.g. grams/ml, when available), a weekly **consumption rate**,
  and **days until empty**, sorted so the soonest-to-run-out is on top. Remaining is
  computed **on read** as `base − rate × days_since_stocked` — no nightly job needed.
- The **consumption rate** is derived from the **last 6 months** of orders (quantity
  bought ÷ days since first purchase in the window, floored at 14 days), in
  `src/lib/pantry/stock.ts` (reused by every stock route).
- **Pantry is the home page** (`/` → `/pantry`); the dashboard graphs move to
  `/dashboard`.
- **Stock from last purchase** — one button adds the latest order's items onto the
  pantry (current estimate + purchased qty, decay clock reset).
- **Manual add & delete** — add an item from your **product database**, as **free
  text + quantity**, or **from a specific past purchase** (the app's first modal),
  and delete any row.
- **Admin toggle** *Enable daily pantry snapshots (cron)* (off by default) plus a
  prepared, `CRON_SECRET`-guarded `POST /api/cron/pantry-snapshot` endpoint and a
  Vercel `crons` schedule that records daily remaining levels for history. The live
  pantry never depends on it.
- New endpoints: `GET`/`POST /api/pantry/stock`, `DELETE /api/pantry/stock/[id]`,
  `POST /api/pantry/restock`, `GET /api/products?q=`, `GET /api/orders`,
  `POST /api/cron/pantry-snapshot`. New tables `pantry_stock` and `pantry_snapshots`,
  plus `settings.pantry_snapshot_enabled`.

### Changed
- The dashboard's category pantry list was removed (the new `/pantry` page replaces
  it); the dashboard keeps Rohlik connect/import and the insights charts.

### Migrations
- `0002_sturdy_pestilence.sql` — adds `pantry_stock`, `pantry_snapshots`, and
  `settings.pantry_snapshot_enabled`.

## [0.3.0] - 2026-06-18 — Phase 3a (dashboard insights + Ask my pantry)

### Added
- **Dashboard insights**: headline stats (average purchase, total purchases,
  total spent, favourite weekday) plus mobile-first, responsive **SVG charts** —
  spending per month and purchases per month (last 6 months) and purchases by
  weekday. New `GET /api/metrics`; hand-rolled charts in `src/components/Charts.tsx`
  (no charting dependency).
- **Ask my pantry** (`/ask`): ask a question in plain language → the AI writes a
  **read-only SQL** query, the server guards and runs it, then the AI explains the
  result with an optional **adjustable chart** (bar / line / table). New
  `POST /api/ask`; requires `ANTHROPIC_API_KEY`. The generated SQL is guarded
  (SELECT/WITH only, single statement, no write/DDL keywords, system tables
  blocked, wrapped `LIMIT 500`).
- Explicit mobile-first `viewport` and a metrics/stat/chart style block.

### Changed
- Docs policy: doc/changelog updates are always committed **and pushed** together
  with the change; `main` is the default deploy/push branch (see `CLAUDE.md` §5).

## [0.2.1] - 2026-06-18 — Phase 2.1

### Added
- Pantry now lists **individual products** grouped under each category (not just
  category totals).
- **Two-tier categories**: a Rohlik (MCP) category and an AI category per
  product. The AI category is primary; the Rohlik category is fed to the AI as a
  hint and used as the fallback when AI is off/unavailable.
- **Dual-mode quantity** display, switchable in the admin (`pantryQuantityMode`):
  `package` (count of boxes) or `content` (parsed size, e.g. grams/ml/pcs).
- Standalone **Run categorization** admin action (`/api/admin/categorize`) with
  status, error messages, and a raw Rohlik product debug sample to confirm the
  MCP category field shape on a live run.
- `textualAmount` content parser (`src/lib/pantry/parseAmount.ts`) →
  `{amount, unit: 'pcs' | 'g' | 'ml'}`.
- Rohlik product-category fetch `fetchProductCategories` in
  `src/lib/rohlik/mcp.ts` (defensive; bounded by `MCP_CATEGORY_MAX`).

### Changed
- The pantry is now **computed on read** from `order_items ⨝ products ⨝ orders`
  (`src/app/api/pantry/route.ts`); the `pantry_items` table is no longer written
  or recomputed (kept for Phase 3).
- Categorization logic moved out of ingest into a single orchestrator,
  `src/lib/category/runCategorization.ts` (MCP categories → AI categories →
  Rohlik-category fallback, each step best-effort). `src/lib/pantry/ingest.ts` is
  now persist-only.

### Migrations
- `0001_parched_shape.sql` — adds `products.mcp_category`,
  `products.mcp_category_path`, and `settings.pantry_quantity_mode`.

## [0.2.0] - 2026-06-17 — Phase 2

### Added
- **Neon Postgres + Drizzle** persistence: `products`, `price_history`, `orders`,
  `order_items`, `categories`, `settings`, `import_logs` (and `pantry_items` for
  Phase 3).
- Optional **Anthropic AI** integration: product auto-categorization and a
  parse-fallback for unexpected MCP responses, both switchable in the admin with
  a model dropdown.
- **Open admin console** (`/admin`): apply Drizzle migrations with applied/defined
  tracking, import last / 1 month / 6 months with an import log, and a danger zone
  to delete orders or everything.

### Migrations
- `0000_previous_captain_stacy.sql` — initial schema.

## [0.1.0] - 2026-06-17 — MVP

### Added
- Connect a Rohlik account via **manual loopback OAuth** (Spajz never sees your
  password), read the last order via the Rohlik MCP server (`fetch_orders`), and
  show a pantry.
- Optional **Logto** authentication; deployed on **Vercel**.
