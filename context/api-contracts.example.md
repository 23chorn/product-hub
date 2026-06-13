---
stages: [solution_architect, story_decomposition, tech_refinement, qa_engineer]
---
# API Contracts

> **How to use this file:** Copy to `api-contracts.md`, fill in your real endpoints, and delete this note.
> `api-contracts.md` is gitignored — your API details stay local. This example uses a fictional brokerage.
>
> Include the endpoints that agents are most likely to reference when designing new features or writing
> acceptance criteria: auth flows, core resource CRUD, webhooks, and any contracts shared across repos.
> You do not need to be exhaustive — focus on contracts that have meaningful cross-team impact.

## Authentication

**Base URL:** `https://api.tradeeasy.com/api/v1`

All endpoints require `Authorization: Bearer <access_token>` unless marked public.

### `POST /auth/token` (public)
Exchange credentials for an access token.

**Request:**
```json
{ "email": "user@example.com", "password": "••••••••" }
```
**Response `200`:**
```json
{
  "access_token": "<JWT>",
  "refresh_token": "<opaque>",
  "expires_in": 900
}
```
**Errors:** `401` invalid credentials · `429` rate-limited (5 attempts / 15 min)

### `POST /auth/refresh` (public)
**Request:** `{ "refresh_token": "<opaque>" }`
**Response:** same shape as `/auth/token`

### `POST /auth/logout`
Revokes refresh token. Returns `204`.

---

## Users

### `GET /users/me`
Returns the authenticated user's profile.

**Response `200`:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "kyc_status": "approved",
  "kyc_tier": 2,
  "preferred_language": "en",
  "created_at": "2024-01-15T09:00:00Z"
}
```

### `PATCH /users/me`
Update mutable profile fields (`preferred_language` only post-KYC).
**Request:** `{ "preferred_language": "ar" }`
**Response:** updated user object.

---

## Accounts

### `GET /accounts`
Returns the user's account(s).

**Response `200`:**
```json
[{
  "id": "uuid",
  "account_type": "cash",
  "status": "active",
  "base_currency": "AED",
  "cash_balance": "12450.0000"
}]
```

### `GET /accounts/:id/portfolio`
Returns current holdings for an account.

**Response `200`:**
```json
[{
  "instrument_id": "uuid",
  "ticker": "AAPL",
  "quantity": "10.5000",
  "average_cost": "182.4000",
  "current_price": "191.2000",
  "unrealised_pnl": "92.4000"
}]
```

---

## Orders

### `POST /orders`
Place a new order.

**Request:**
```json
{
  "account_id": "uuid",
  "instrument_id": "uuid",
  "order_type": "limit",
  "side": "buy",
  "quantity": "10",
  "limit_price": "185.00"
}
```
**Response `201`:** full order object with `status: "pending"`.

**Errors:** `400` validation failure · `402` insufficient cash balance · `422` instrument not tradeable · `429` order rate limit (10 orders / minute)

### `GET /orders`
Query params: `?account_id=uuid&status=open&limit=50&cursor=<opaque>`

### `GET /orders/:id`
Returns a single order. Polls this endpoint for fill status — events via WebSocket are more efficient.

### `DELETE /orders/:id`
Cancel an open order. Returns `200` with updated order or `409` if already filled.

---

## Instruments

### `GET /instruments/search`
Query params: `?q=apple&exchange=NASDAQ&type=equity&sharia_compliant=true`

**Response `200`:**
```json
[{
  "id": "uuid",
  "ticker": "AAPL",
  "isin": "US0378331005",
  "name_en": "Apple Inc.",
  "exchange": "NASDAQ",
  "instrument_type": "equity",
  "is_sharia_compliant": true,
  "is_tradeable": true,
  "fractional_enabled": true
}]
```

### `GET /instruments/:id/quote`
Returns the latest cached quote (Redis, TTL 1s).

**Response `200`:**
```json
{
  "ticker": "AAPL",
  "price": "191.20",
  "change": "1.83",
  "change_pct": "0.97",
  "volume": 48312900,
  "market_status": "open",
  "as_of": "2024-06-12T14:32:11Z"
}
```

---

## Real-time: WebSocket

**Endpoint:** `wss://api.tradeeasy.com/ws?token=<access_token>`

### Subscribe to quotes
```json
{ "action": "subscribe", "type": "quotes", "tickers": ["AAPL", "NVDA"] }
```
**Server push:**
```json
{ "type": "quote", "ticker": "AAPL", "price": "191.45", "change_pct": "1.10", "ts": 1718199131 }
```

### Subscribe to order updates
```json
{ "action": "subscribe", "type": "orders", "account_id": "uuid" }
```
**Server push:**
```json
{ "type": "order_update", "order_id": "uuid", "status": "filled", "filled_quantity": "10", "average_fill_price": "191.20" }
```

---

## API Versioning & Breaking Change Policy

- Current stable version: `v1` (prefix `/api/v1/*`)
- `v2` used for breaking changes; `v1` remains supported for 12 months after a `v2` equivalent ships
- Breaking changes: field removal, type changes, enum value removal
- Non-breaking: new optional fields, new endpoints, new enum values
- Clients must handle unknown enum values gracefully (treat as `unknown`, not an error)

## Rate Limits

| Endpoint group | Limit |
|----------------|-------|
| Auth (`/auth/*`) | 5 req / 15 min per IP |
| Orders (`POST /orders`) | 10 req / min per account |
| Quotes (`/instruments/*/quote`) | 60 req / min per user |
| All other endpoints | 120 req / min per user |

`429` responses include `Retry-After: <seconds>` header.
