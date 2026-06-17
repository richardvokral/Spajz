# Spajz

A home pantry tracker that talks to the [Rohlik](https://www.rohlik.cz) grocery
store's MCP server. Connect your Rohlik account, import your order history, and
Spajz tracks what you have — aggregated by **category** (so "eggs" counts across
brands) — in a Neon Postgres database.

> Vision (Phase 3, documented not built): compute per-category consumption from
> ~6 months of history, subtract it from the pantry on a schedule, and propose a
> ready-to-place shopping cart via MCP. Plus: ingest paper invoices from other
> shops via a multimodal LLM.

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
3. **Pantry** — products roll up into categories; the pantry shows totals per
   category. With AI enabled, new products are auto-categorized.

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
- **`ANTHROPIC_API_KEY`** *(optional)* — enables AI product auto-categorization and
  the parse-fallback. Both must also be toggled on in **/admin → AI**. Default
  model `claude-opus-4-8` (switchable to `claude-sonnet-4-6` / `claude-haiku-4-5`).
- **`ROHLIK_TOKEN_SECRET`** *(prod)* — encrypts the Rohlik token cookie.
- **`ROHLIK_OAUTH_REDIRECT`** *(optional)* — loopback redirect URI (default
  `http://localhost:8765/callback`).
- **Logto** *(optional)* — set all five `LOGTO_*` vars to require sign-in on
  `/dashboard`; leave blank to run without login. **`/admin` is intentionally
  open** (demo).

## Admin console (`/admin`, open)

- **Database** — see applied vs. defined migrations, **Apply migrations** button,
  table row counts.
- **AI** — toggles for categorization + parse-fallback, model dropdown.
- **Imports** — Import last / 1 month / 6 months (needs a connected Rohlik
  session), with an **import log** (counts + error messages).
- **Danger zone** — delete orders, or everything.

## Database

```bash
npm run db:generate   # offline — regenerate migrations from src/lib/schema.ts
npm run db:migrate    # apply via CLI (needs DATABASE_URL); /admin does the same at runtime
```

Schema (`src/lib/schema.ts`): `categories`, `products`, `price_history`, `orders`,
`order_items`, `pantry_items`, `settings`, `import_logs`.

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
AI categorization of new products. The import route sets `maxDuration: 300`
(Hobby caps at 60). AI categorization is batched and only runs for new products;
imports are dedup-resumable, so re-running converges. If a single 6-month call
still exceeds limits, import in monthly chunks.
