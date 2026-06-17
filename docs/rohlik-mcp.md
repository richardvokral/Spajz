# Rohlik MCP — confirmed reference

Notes on the official Rohlik MCP server, verified by running this app against it.
Treat anything marked _(assumed)_ as not yet observed.

- **Endpoint:** `https://mcp.rohlik.cz/mcp`
- **Transport:** Streamable HTTP (MCP). Client: `@modelcontextprotocol/sdk`
  (`Client` + `StreamableHTTPClientTransport`), Node.js runtime only.
- **Tool results:** every call returns `content[0].text` (a JSON **string**) and,
  for most tools, a parallel `structuredContent` object (`hasStructured: true`).
  Parse `structuredContent` when present, else `JSON.parse(content[0].text)`.

## Authentication

Two paths exist; **only OAuth works for a hosted (Vercel) app.**

### Header auth (legacy) — does NOT work for us
Passing `rhl-email` / `rhl-pass` HTTP headers lets you connect and `listTools()`,
but tools that touch the account perform a real backend login. With wrong/absent
credentials the **tool result** is `isError: true` with text like:

```
Error calling tool 'fetch_orders': Login request failed for <email>:
401 Client Error: Unauthorized for url:
http://frontend-service.prod.rohlikgroup.com/api/v5/login/access_token
```

The connection succeeding is **not** proof of auth — auth happens inside the tools.

### OAuth (what we use)
The server implements OAuth with **discovery + Dynamic Client Registration (DCR)
+ PKCE + refresh tokens**. Confirmed behaviour:

- **DCR only accepts loopback redirect URIs.** Registering a hosted callback
  (`https://<app>.vercel.app/api/rohlik/oauth/callback`) fails with:
  `Redirect URI is not allowed for dynamic client registration. Got: …`
  Use `http://localhost:8765/callback` (or `http://127.0.0.1:8765/...`).
- `token_endpoint_auth_method: "none"` (public client + PKCE) works.
- Because a hosted app can't receive a loopback redirect, we use a **manual
  copy-the-code flow** (see below).

#### How our OAuth is set up

| Piece | File |
| --- | --- |
| `OAuthClientProvider` impl + redirect URI + cookie names | `src/lib/rohlik/oauth.ts` |
| Encrypted cookie seal/unseal (AES-256-GCM) | `src/lib/session.ts` |
| Begin flow, capture auth URL | `src/app/api/rohlik/oauth/start/route.ts` |
| Exchange the pasted code for tokens | `src/app/api/rohlik/oauth/finish/route.ts` |
| Disconnect (clear cookies) | `src/app/api/rohlik/disconnect/route.ts` |
| Use the token to call tools | `src/lib/rohlik/mcp.ts` (`importLastOrder`) |

Env vars: `ROHLIK_TOKEN_SECRET` (cookie encryption key, 32+ chars),
`ROHLIK_OAUTH_REDIRECT` (override the loopback URI). Tokens live in the encrypted
HTTP-only `rohlik_session` cookie; transient flow state in `rohlik_oauth`.

#### Manual flow (hosted app)
1. `start` runs `client.connect()` → SDK does discovery + DCR + PKCE, calls
   `redirectToAuthorization(url)` (we capture the URL) then throws
   `UnauthorizedError`. We stash `{clientInformation, codeVerifier, state, authUrl}`
   in the `rohlik_oauth` cookie and show the user the auth URL.
2. User opens the auth URL, logs in at Rohlik. Rohlik redirects the browser to
   `http://localhost:8765/callback?code=…` — the page fails to load (nothing is
   listening), but the **code is in the address bar**.
3. User pastes the code (or whole URL); `finish` calls `transport.finishAuth(code)`
   which exchanges it for tokens. Tokens are saved to `rohlik_session`.
4. Refresh is automatic: the SDK refreshes via the stored refresh token and our
   provider's `saveTokens` callback rewrites the cookie.

## Tools (54, as of 2026-06)

The exact list returned by `listTools()`. Grouped for readability.

**Orders & history**
`fetch_orders`, `repeat_order`, `get_typical_order`, `analyze_spending`,
`cancel_order`, `remove_order_items`, `change_order_timeslot`,
`get_alternative_timeslots`

**Products & search**
`batch_search_products`, `get_product_details`, `get_products_composition_batch`,
`get_discounted_items`, `get_all_user_favorites`

**Cart**
`get_cart`, `add_items_to_cart`, `update_cart_item`, `remove_cart_item`,
`clear_cart`

**Checkout**
`get_checkout`, `submit_checkout`, `get_timeslots_checkout`,
`change_timeslot_checkout`, `change_checkout_packaging`,
`update_payment_method_checkout`, `toggle_delivery_note_checkout`,
`set_checkout_as_suborder`, `select_delivery_address_checkout`

**Delivery & addresses**
`get_user_addresses`, `search_address`, `request_delivery_expansion`

**Shopping lists**
`get_user_shopping_lists_preview`, `get_user_shopping_list_detail`,
`create_shopping_list`, `delete_shopping_list`, `add_products_to_shopping_list`,
`remove_products_from_shopping_list`

**Recipes**
`get_recipe_detail`, `search_recipes_by_vector_similarity`

**Scheduled tasks**
`create_scheduled_task`, `get_user_scheduled_tasks`, `cancel_scheduled_task`

**Account & returnables**
`get_user_info`, `get_user_reusable_bags_info`, `adjust_user_reusable_bags`,
`get_customer_returnables`, `credit_customer_returnables`

**Support & misc**
`get_announcements`, `get_faq_content`, `get_url_content`, `submit_claim`,
`submit_credit_compensation`, `get_customer_support_contact_info`,
`add_karma_rating`, `add_feedback`

> There is **no** `get_order_history` / `get_order_detail` (our first guesses).
> Calling an unknown tool returns `isError: true`, `text: "Unknown tool: <name>"`.

## `fetch_orders` (confirmed)

Reads past/upcoming orders. **Requires at least one search parameter** — calling
with `{}` returns `isError: false` but a `{"success": false, …, "message":
"At least one search parameter is required."}` body.

### Input schema
| Param | Type | Notes |
| --- | --- | --- |
| `order_id` | integer \| null | A specific order (ignores limit/date). |
| `limit` | integer 1–15 \| null | N most recent orders. |
| `date_from` | `YYYY-MM-DD` \| null | Start of range. |
| `date_to` | `YYYY-MM-DD` \| null | End of range; alone → 6-month lookback. |
| `order_type` | `delivered` \| `upcoming` \| `both` | Default `delivered`. |

We call `{ limit: 5 }` and pick the order with the newest `orderTime`.

### Response shape
`{ "success": true, "orders": [ Order, … ] }`, where each **Order** is:

```jsonc
{
  "id": 1050824221,                       // -> order id (number)
  "itemsCount": 12,
  "orderTime": "2020-11-13T10:13:51.000+0100", // -> order date (ISO-ish)
  "deliveryType": "COURIER",
  "deliverySlot": { "type": "VIRTUAL", "timeRange": "2020-11-13 14:00-15:00" },
  "state": "DELIVERED",
  "priceComposition": {
    "total":   { "amount": 1205.07, "currency": "CZK" },
    "goods":   { "amount": 1116.07, "currency": "CZK" },
    "delivery":{ "amount": 69.0,    "currency": "CZK" },
    "creditsUsed": { "amount": 0.0, "currency": "CZK" },
    "courierTip":  { "amount": 20.0, "currency": "CZK" }
    // + fines, reusableBagsDeposit, paymentFee, packagingFee
  },
  "items": [
    {
      "name": "Olma BIO Čerstvé mléko plnotučné 4 %", // -> name
      "id": 712707,                                    // -> productId
      "unit": "l",                                     // l | piece | kg
      "textualAmount": "1 l",                          // -> shown as size ("6 ks", "250 g")
      "totalPrice": 29.9,                              // -> line price
      "currency": "CZK"
    }
    // … one entry per product line. NOTE: no per-line quantity/count field;
    // multi-buys appear only via warrantyInfo.enabledData[].pieces (below),
    // so we default quantity to 1 and let the user edit it.
  ],
  "address": "Diamantová 754/32, 15400, Praha",
  "availableActions": ["REPEAT_ORDER"],
  "payment": 1,
  "selectedPackaging": "PAPER_BAGS",
  "totalPrice": 1205.07,
  "warrantyInfo": {
    "enabledData": [
      { "name": "…", "productId": 1388468, "pieces": 2,
        "pricePerPiece": "44.45 CZK", "total": "88.9 CZK", "inventoryId": 1315652 }
      // a SUBSET of items (warranty-eligible); `pieces` is the real bought count
    ]
  }
}
```

### Field mapping used by the app (`src/lib/rohlik/mcp.ts`)
| App field | Source |
| --- | --- |
| order id | `order.id` |
| order date | `order.orderTime` |
| line `productId` | `item.id` |
| line `name` | `item.name` |
| line `unit` (size label) | `item.textualAmount` (fallback `item.unit`) |
| line `price` | `item.totalPrice` |
| line `quantity` | not in `items[]` → defaults to 1 (real count is in `warrantyInfo.enabledData[].pieces` for eligible items) |

## Useful tools for Phase 2 _(assumed shapes — verify before relying on them)_
- `get_typical_order` — your habitual basket → predict needs.
- `analyze_spending` — spending breakdown over time.
- `repeat_order` — re-order a previous order (likely takes an `order_id`).
- `batch_search_products` + `add_items_to_cart` + `get_checkout`/`submit_checkout`
  — build and place a new order programmatically.
- `fetch_orders` with `date_from`/`date_to` — the 6-month history scan.
