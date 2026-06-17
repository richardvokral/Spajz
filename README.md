# Spajz

A home pantry tracker that talks to the [Rohlik](https://www.rohlik.cz) grocery
store's MCP server. **This is the MVP:** import your *last* Rohlik order and push
its items into a pantry stored in your browser.

> Vision (later phases, not built yet): scan ~6 months of purchase history into a
> database, auto-track what you buy, predict when each item runs out, prepare a
> re-order via MCP, and ingest paper invoices from other shops via a multimodal
> LLM.

## How it works (MVP)

1. You click **Connect Rohlik** and sign in via **OAuth** on Rohlik's own page —
   Spajz never sees your password. The access token is kept in an encrypted,
   HTTP-only cookie.
2. **Import last order** connects to `https://mcp.rohlik.cz/mcp` with that token,
   calls `fetch_orders` (limit 1, delivered), and returns the most recent order.
3. You pick which items (and quantities) to add. They go into a pantry kept in
   `localStorage`.
4. Re-importing the same order is blocked (imported order IDs are tracked in
   `localStorage`).

## Stack

- **Next.js 15** (App Router, TypeScript), deployable on **Vercel**
- **`@modelcontextprotocol/sdk`** — Rohlik MCP client (`StreamableHTTPClientTransport`)
- **`@logto/next`** — authentication (optional, see below)
- **Neon Postgres + Drizzle ORM** — scaffolded for Phase 2 (not used by the MVP)

## Run locally

```bash
npm install
cp .env.example .env.local   # every var is optional for local dev
npm run dev                  # http://localhost:3000
```

With no env vars set, the app runs **without login** and the pantry works
entirely in your browser. Live Rohlik import needs a real Rohlik account.

## Configuration

All env vars are optional. See `.env.example`.

- **Rohlik:** nothing to configure — credentials are entered in the UI per run.
- **Logto (optional):** set `LOGTO_ENDPOINT`, `LOGTO_APP_ID`, `LOGTO_APP_SECRET`,
  `LOGTO_BASE_URL`, `LOGTO_COOKIE_SECRET`. When **all** are present, `/dashboard`
  requires sign-in (callback route: `/callback`). Leave them blank to bypass
  login. Create a free **Traditional Web** app at
  [Logto Cloud](https://cloud.logto.io); set the redirect URI to
  `<baseUrl>/callback` and the post-sign-out URI to `<baseUrl>`.
- **Neon (optional, Phase 2):** set `DATABASE_URL`. The MVP pantry does not use
  the database.

## Database scaffold (Phase 2)

```bash
npm run db:generate   # offline — emits drizzle/0000_init.sql from the schema
npm run db:migrate    # needs a real DATABASE_URL
```

Schema lives in `src/lib/schema.ts` (`users`, `purchases`, `pantry_items`).

## Deploy to Vercel

1. Import the repo in Vercel.
2. Optionally set the `LOGTO_*` and `DATABASE_URL` env vars (skip for a
   no-login demo). Set `LOGTO_BASE_URL` to your deployment URL.
3. Deploy. The import route runs on the Node.js runtime with `maxDuration: 60`
   (`vercel.json`) — well within limits for a single last-order read.

## Verify

```bash
npm run typecheck
npm run lint
npm run build
npm run db:generate
```

The live Rohlik import must be tested manually with real credentials (and
outbound access to `mcp.rohlik.cz`).

## Phase 2 — long-running 6-month scan

Reading ~6 months of history is many MCP calls and may exceed a single
serverless invocation. Simplest-first:

1. **Bump `maxDuration` + stream progress** (Pro: up to 800s). No new infra.
2. **Client-driven chunking** *(recommended start)*: fetch the order list, then
   issue one short request per order, persisting to Neon as you go.
3. **Offload to a queue** (QStash / Inngest free tiers) only if 1–2 fall short.
