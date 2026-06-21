# Spajz · v0.4.0

A home pantry tracker that talks to the [Rohlik](https://www.rohlik.cz) grocery
store's MCP server. Connect your Rohlik account, import your order history, and
Spajz tracks **what you have at home and how long it should last** — estimated
**per product** from how often you buy it — in a Neon Postgres database. The
**pantry is the home page** (`/`); the spending/insights graphs live at
`/dashboard`. See [`CHANGELOG.md`](CHANGELOG.md) for version history.

> Vision (next, documented not built): use each item's **days until empty** to
> propose a ready-to-place shopping cart via MCP. Plus: ingest paper invoices from
> other shops via a multimodal LLM.

## How it works

1. **Connect Rohlik** — sign in via **OAuth** on Rohlik's own page (Spajz never
   sees your password). Because Rohlik's OAuth only allows loopback redirect
   URIs, a hosted app uses a one-time copy-the-code step; the access token is
   then kept in an encrypted, HTTP-only cookie. See
   [`docs/rohlik-mcp.md`](docs/rohlik-mcp.md).
2. **Import** — the dashboard imports your last order; the **admin** console
   imports the last 1 or 6 months. Each calls `fetch_orders` and persists orders,
   line items, products and **price history** to Neon (idempotent: re-imports are
   deduped).
3. **Pantry** (`/`, the home page) — tracks what you have **per product**: estimated
   **remaining** packages (plus a parsed content amount like grams/ml when
   available), a weekly **consumption rate**, and **days until empty**, sorted with
   the soonest-to-run-out on top. Remaining is computed on read as
   `base − rate × days_since_stocked`; the rate comes from the **last 6 months** of
   orders. Hit **Stock from last purchase** after an import to add the latest order's
   items, or **Add item** to add one from your products, as free text, or from a past
   purchase. An optional admin toggle records daily snapshots via a
   `CRON_SECRET`-guarded `POST /api/cron/pantry-snapshot` (the live pantry doesn't
   need it).
4. **Insights** — the dashboard also shows headline stats (average purchase,
   total purchases, total spent, favourite weekday) and mobile-first responsive
   charts: spending and purchases per month (last 6 months) and purchases by
   weekday. Served by `GET /api/metrics`; charts are hand-rolled SVG
   (`src/components/Charts.tsx`), no charting dependency.
5. **Ask my pantry** (`/ask`) — ask a question in plain language; the AI writes a
   **read-only SQL** query, the server guards and runs it, then the AI explains
   the result with an optional adjustable chart (bar / line / table).

### Ask my pantry

`/ask` turns a natural-language question into a single read-only SQL query via
Anthropic (`POST /api/ask`, needs `ANTHROPIC_API_KEY`). The generated SQL is
**guarded** before it runs: `SELECT`/`WITH` only, a single statement, no
write/DDL keywords, system/catalog tables blocked, and wrapped in a `LIMIT 500`.
The result rows are sent back to the model to produce the answer (and an optional
chart spec). Data is a single user's grocery history; the guard keeps it
read-only.

### Categories

Each product carries two categories: the **Rohlik (MCP) category** fetched from
Rohlik, and an **AI category**. The AI category is primary; the Rohlik category
is fed to the AI as a hint and used as the **fallback** when AI is off or
unavailable (so products still group sensibly). Run categorization automatically
after an import, or on demand from **/admin → Categorization**.

### Quantity modes

`pantryQuantityMode` (set in **/admin → AI**) chooses how amounts are shown:

- `package` — count of boxes/packages bought.
- `content` — the package size parsed from Rohlik's `textualAmount` (e.g. `0,75 l`
  → 750 ml, `1 kg` → 1000 g, `6 ks` → 6 pcs). Lines that can't be parsed still
  count in `package` mode.

## Stack

- **Next.js 15** (App Router, TypeScript) on **Vercel**
- **`@modelcontextprotocol/sdk`** — Rohlik MCP client
- **Neon Postgres + Drizzle ORM** — products, price history, orders, category pantry
- **`@anthropic-ai/sdk`** — optional AI: product categorization + a parse-fallback
- **`@logto/next`** — optional authentication

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL (+ optionally the others)
npm run dev                  # http://localhost:3000
```

## Configuration (`.env.example`)

- **`DATABASE_URL`** — Neon Postgres. **Required** for the pantry, imports and the
  admin console. Apply the schema from **/admin → Apply migrations** (or
  `npm run db:migrate`).
- **`ANTHROPIC_API_KEY`** *(optional)* — enables AI product auto-categorization,
  the parse-fallback, and **Ask my pantry** (`/ask`). Categorization and the
  parse-fallback must also be toggled on in **/admin → AI**; Ask my pantry works
  whenever the key is set. Default model `claude-opus-4-8` (switchable to
  `claude-sonnet-4-6` / `claude-haiku-4-5`).
- **`ROHLIK_TOKEN_SECRET`** *(prod)* — encrypts the Rohlik token cookie.
- **`ROHLIK_OAUTH_REDIRECT`** *(optional)* — loopback redirect URI (default
  `http://localhost:8765/callback`).
- **Logto** *(optional)* — set all five `LOGTO_*` vars to require sign-in on
  `/dashboard`; leave blank to run without login. **`/admin` is intentionally
  open** (demo).

## Admin console (`/admin`, open)

- **Database** — see applied vs. defined migrations, **Apply migrations** button,
  table row counts.
- **AI** — toggles for categorization + parse-fallback, model dropdown, and the
  **pantry quantity display** mode (`package` / `content`).
- **Categorization** — **Run categorization**: fetch Rohlik categories for a
  connected session and AI-categorize every product that doesn't have a category
  yet. Safe to run repeatedly; shows tallies, errors, and a Rohlik product debug
  sample.
- **Imports** — Import last / 1 month / 6 months (needs a connected Rohlik
  session), with an **import log** (counts + error messages).
- **Danger zone** — delete orders, or everything.

## Database

```bash
npm run db:generate   # offline — regenerate migrations from src/lib/schema.ts
npm run db:migrate    # apply via CLI (needs DATABASE_URL); /admin does the same at runtime
```

Schema (`src/lib/schema.ts`): `categories`, `products`, `price_history`, `orders`,
`order_items`, `pantry_items`, `settings`, `import_logs`. There are two
migrations: `0000` (initial schema) and `0001` (adds `products.mcp_category`,
`products.mcp_category_path`, and `settings.pantry_quantity_mode`).

## Deploy to Vercel

1. Import the repo. Set `DATABASE_URL` (Neon), and optionally `ANTHROPIC_API_KEY`,
   `ROHLIK_TOKEN_SECRET`, and the `LOGTO_*` vars. Set `LOGTO_BASE_URL` to the
   deploy URL if using Logto.
2. Deploy, then open **/admin → Apply migrations** once to create the tables.
   (The migration SQL is bundled via `outputFileTracingIncludes` in
   `next.config.ts`.)
3. Connect Rohlik on the dashboard, then import.

## Verify

```bash
npm run typecheck && npm run lint && npm run build && npm run db:generate
```

Live import (Rohlik), the database, and AI need real `DATABASE_URL` /
`ANTHROPIC_API_KEY` / a connected Rohlik account, tested on the deploy.

## Long-running imports (Vercel)

A 6-month import is a single `fetch_orders` call (items embedded) + DB writes +
categorization. Categorization runs after ingest: it fetches Rohlik categories
(bounded per run by `MCP_CATEGORY_MAX`) and AI-categorizes pending products in
batches. The import route sets `maxDuration: 300` (Hobby caps at 60). Imports are
dedup-resumable and categorization only touches products that still need it, so
re-running converges and drains the backlog. If a single 6-month call still
exceeds limits, import in monthly chunks.
