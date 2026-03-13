# Database Schema

> **How to use this file:** Copy to `db-schema.md`, fill in your real details, and delete this note.
> `db-schema.md` is gitignored — your schema details stay local. This example uses a fictional company.

## Tables

### users
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| email | varchar(255) | Unique |
| phone | varchar(30) | Unique, used for MFA |
| nationality | varchar(10) | ISO 3166-1 alpha-2 |
| residency_country | varchar(10) | ISO 3166-1 alpha-2 |
| kyc_status | varchar(50) | `pending`, `in_review`, `approved`, `rejected` |
| kyc_tier | integer | 1 = basic (limited trading), 2 = full (unrestricted) |
| preferred_language | varchar(10) | `en`, `ar` |
| created_at | timestamptz | |

### accounts
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| user_id | uuid | FK → users.id |
| account_type | varchar(50) | `cash`, `margin` (margin not yet enabled) |
| status | varchar(50) | `pending_funding`, `active`, `suspended`, `closed` |
| base_currency | varchar(10) | `AED`, `USD` |
| cash_balance | numeric(18,4) | Available buying power in base currency |
| created_at | timestamptz | |

### portfolios
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| account_id | uuid | FK → accounts.id |
| instrument_id | uuid | FK → instruments.id |
| quantity | numeric(18,8) | Supports fractional shares |
| average_cost | numeric(18,4) | Weighted average cost per share |
| updated_at | timestamptz | |

### instruments
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| ticker | varchar(20) | Exchange-specific ticker symbol |
| isin | varchar(12) | International Securities Identification Number |
| name_en | varchar(255) | English name |
| name_ar | varchar(255) | Arabic name |
| exchange | varchar(50) | `DFM`, `ADX`, `TADAWUL`, `NASDAQ`, `NYSE`, etc. |
| instrument_type | varchar(50) | `equity`, `etf`, `sukuk`, `reit` |
| currency | varchar(10) | Trading currency |
| is_sharia_compliant | boolean | Zakat/Sharia screening flag |
| is_tradeable | boolean | False if suspended or delisted |
| fractional_enabled | boolean | Whether fractional share trading is supported |

### orders
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| account_id | uuid | FK → accounts.id |
| instrument_id | uuid | FK → instruments.id |
| order_type | varchar(50) | `market`, `limit`, `stop_limit` |
| side | varchar(10) | `buy`, `sell` |
| quantity | numeric(18,8) | Requested quantity (supports fractional) |
| limit_price | numeric(18,4) | Nullable — set for limit/stop_limit orders |
| status | varchar(50) | `pending`, `submitted`, `partial_fill`, `filled`, `cancelled`, `rejected` |
| filled_quantity | numeric(18,8) | |
| average_fill_price | numeric(18,4) | Nullable until filled |
| exchange_order_id | varchar(100) | Reference ID from the exchange/clearing member |
| submitted_at | timestamptz | When sent to exchange |
| updated_at | timestamptz | |

### transactions
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key (immutable) |
| account_id | uuid | FK → accounts.id |
| order_id | uuid | FK → orders.id, nullable (for deposits/withdrawals) |
| transaction_type | varchar(50) | `trade_buy`, `trade_sell`, `deposit`, `withdrawal`, `fee`, `dividend` |
| amount | numeric(18,4) | Positive = credit, negative = debit |
| currency | varchar(10) | |
| balance_after | numeric(18,4) | Running balance snapshot |
| created_at | timestamptz | Append-only — never updated |

### advisors
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| user_id | uuid | FK → users.id — advisor's own account |
| display_name | varchar(255) | Public name shown to clients |
| bio_en | text | English bio |
| bio_ar | text | Arabic bio |
| licence_number | varchar(100) | Regulatory licence reference |
| licence_authority | varchar(50) | `DFSA`, `CMA`, `SCA`, etc. |
| status | varchar(50) | `pending_review`, `active`, `suspended` |
| verified_at | timestamptz | When compliance approved the advisor |

### model_portfolios
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| advisor_id | uuid | FK → advisors.id |
| name_en | varchar(255) | |
| name_ar | varchar(255) | |
| description_en | text | |
| risk_level | varchar(20) | `conservative`, `moderate`, `aggressive` |
| monthly_fee_aed | numeric(10,2) | Subscription fee in AED |
| subscriber_count | integer | Cached count, updated async |
| published_at | timestamptz | Nullable — null until advisor publishes |

### advisor_subscriptions
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| client_user_id | uuid | FK → users.id |
| model_portfolio_id | uuid | FK → model_portfolios.id |
| status | varchar(50) | `active`, `cancelled`, `past_due` |
| subscribed_at | timestamptz | |
| cancelled_at | timestamptz | Nullable |

## Key relationships

- `users` → `accounts`: one user can have one account (one-to-one for now; multi-account planned for Phase 2)
- `accounts` → `portfolios`: one portfolio row per held instrument position
- `accounts` → `orders` / `transactions`: full trade and cash history, all scoped to account
- `advisors` → `model_portfolios`: an advisor can publish multiple model portfolios
- `users` → `advisor_subscriptions`: a client can subscribe to one or more model portfolios

## Indexes worth noting

- `idx_orders_account_status` on `orders(account_id, status)` — open order polling
- `idx_portfolios_account` on `portfolios(account_id)` — portfolio summary queries
- `idx_transactions_account_created` on `transactions(account_id, created_at DESC)` — statement / history view
- `idx_instruments_exchange_tradeable` on `instruments(exchange, is_tradeable)` — market screener
- `idx_instruments_isin` on `instruments(isin)` — cross-exchange lookup by ISIN

## Compliance notes

- `transactions` table is append-only — no updates or deletes. Enforced at application layer and via DB trigger.
- All tables with financial data are encrypted at rest via AWS RDS encryption (AES-256).
- Row-level security is enforced at the application layer — all queries must be scoped to the authenticated user's account_id.
