---
stages: [solution_architect, story_decomposition, tech_refinement, qa_engineer]
---
# External Integrations

> **How to use this file:** Copy to `integrations.md`, fill in your real integrations, and delete this note.
> `integrations.md` is gitignored — credentials and internal URLs stay local. This example uses a fictional brokerage.
>
> For each integration, capture: what it does, which repos own it, the key contract details agents need
> to write realistic stories and acceptance criteria (auth method, rate limits, error behaviour),
> and any constraints that should influence technical decisions (SLAs, licensing tiers, compliance obligations).

---

## Market Data — Polygon.io

**What it does:** Real-time and historical price feeds for US equities, ETFs, and options.
**Owner repo:** `tradeeasy-market-data`
**Auth:** API key in `X-Polygon-Api-Key` header (stored in Secrets Manager as `polygon/api-key`)
**Plan:** Starter ($29/mo) — covers real-time WebSocket + REST for US equities up to 5K concurrent connections

**Key endpoints used:**
- `wss://socket.polygon.io/stocks` — real-time trade events (WebSocket)
- `GET /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}` — historical OHLCV bars

**Rate limits:** Starter: unlimited REST calls; WebSocket: up to 5K symbols subscribed simultaneously
**Latency SLA:** <500ms from trade execution to WebSocket delivery (Starter tier)
**Error behaviour:** Reconnect with exponential backoff (5s, 10s, 20s) on disconnect; suppress alert evaluation during feed degradation to avoid stale-price triggers

**Constraints:**
- Licensing: usage above 5K concurrent connections requires upgrade to Business ($199/mo) — plan at 10K/50K user milestones
- Symbols: covers US equities + ETFs; does not cover DFM/ADX — separate feed required for UAE equities
- PII: no user data sent to Polygon; ticker + timestamp only

---

## Push Notifications — Firebase Cloud Messaging (FCM)

**What it does:** Delivers push notifications to Android devices; used alongside APNs for iOS.
**Owner repos:** `tradeeasy-api` (sends), `tradeeasy-android` / `tradeeasy-ios` (receive)
**Auth:** Service account JSON key stored in Secrets Manager as `fcm/service-account`
**SDK:** `firebase-admin` (Node.js) for server-side sends

**Key usage pattern:**
```
POST https://fcm.googleapis.com/v1/projects/{project_id}/messages:send
Authorization: Bearer <OAuth2 token from service account>
{ "message": { "token": "<device_token>", "notification": { "title": "...", "body": "..." }, "data": { "order_id": "..." } } }
```

**Rate limits:** Free tier — 500K messages/day; no per-second rate limit documented; burst OK
**Delivery SLA:** Typically <5s; no guaranteed SLA on free tier; use `high` priority for time-sensitive alerts
**Error behaviour:** `UNREGISTERED` token → delete from DB immediately; `QUOTA_EXCEEDED` → back off 60s; `UNAVAILABLE` → retry up to 3× with 5s backoff

**Constraints:**
- iOS push requires APNs auth key in addition to FCM — FCM proxies to APNs for iOS devices
- Background delivery on iOS not guaranteed when `content_available: true` and low-power mode is active — email fallback required for alert delivery guarantees
- Device tokens rotate; always handle `UNREGISTERED` errors and purge stale tokens

---

## Email — SendGrid

**What it does:** Transactional email (order confirmations, alert notifications, statements).
**Owner repo:** `tradeeasy-api`
**Auth:** API key in `Authorization: Bearer SG.<key>` header (Secrets Manager: `sendgrid/api-key`)
**Plan:** Essentials ($19.95/mo) — 50K emails/month

**Key endpoint:**
```
POST https://api.sendgrid.com/v3/mail/send
```

**Template IDs (internal):**
| Purpose | Template ID |
|---------|-------------|
| Price alert triggered | `d-a1b2c3d4e5f6...` |
| Order filled | `d-b2c3d4e5f6a1...` |
| Monthly statement | `d-c3d4e5f6a1b2...` |
| Welcome / KYC approved | `d-d4e5f6a1b2c3...` |

**Rate limits:** 600 emails/sec (Essentials tier)
**Error behaviour:** `429` → retry after `X-RateLimit-Reset`; `5xx` → retry up to 3× with 30s backoff; permanent failures logged to `email_send_errors` table for manual review
**Constraints:**
- All email copy must be approved by Legal before template publishing — do not hardcode financial claims in templates
- Unsubscribe headers required by CAN-SPAM; SendGrid handles list-unsubscribe automatically when using templates

---

## Identity Verification (KYC) — Sumsub

**What it does:** Identity document verification, liveness checks, and AML screening for new user onboarding.
**Owner repo:** `tradeeasy-api`
**Auth:** HMAC-SHA256 signed requests using `SUMSUB_APP_TOKEN` + `SUMSUB_SECRET_KEY` (Secrets Manager)
**Flow:** Server-side SDK token → embedded WebSDK in mobile/web → webhook callback on completion

**Webhook events used:**
| Event | Action |
|-------|--------|
| `applicantReviewed` with `reviewResult.reviewAnswer = GREEN` | Set `users.kyc_status = approved`, `kyc_tier = 1` |
| `applicantReviewed` with `reviewAnswer = RED` | Set `kyc_status = rejected`; trigger support ticket |
| `applicantPersonalDataChanged` | Re-trigger AML screening |

**Constraints:**
- Sumsub data processed in EU (Frankfurt) — GDPR data processing agreement in place
- PII: never log Sumsub payloads; store only `kyc_status` and `sumsub_applicant_id` in our DB
- Retry webhooks: Sumsub retries failed webhook deliveries for 24h with exponential backoff — endpoint must be idempotent on `applicantId`
- Review SLA: automated checks complete in <2 min; manual review (escalated cases) up to 2 business days

---

## Payments — Network International

**What it does:** UAE card processing for account funding (deposit via debit/credit card).
**Owner repo:** `tradeeasy-api`
**Auth:** Merchant ID + API key pair (Secrets Manager: `network-intl/credentials`)
**Environment:** Sandbox (`https://api-gateway.sandbox.ngenius-payments.com`) / Production (`https://api-gateway.ngenius-payments.com`)

**Flow:**
1. Server creates an `ORDER` via `POST /transactions/outlets/{outlet_ref}/orders`
2. Client renders the hosted payment page (redirect or embedded iframe)
3. Network International sends a webhook on payment outcome
4. Server confirms and credits `accounts.cash_balance`

**Webhook events:**
| Status | Meaning |
|--------|---------|
| `CAPTURED` | Payment succeeded — credit the account |
| `FAILED` | Payment declined — notify user |
| `REVERSED` | Chargeback initiated — freeze account, notify compliance |

**Constraints:**
- PCI DSS: card numbers never touch our servers — Network International handles tokenisation
- Webhook signature verification required before processing (HMAC-SHA256 with shared secret)
- Minimum deposit: AED 500; maximum single transaction: AED 200,000 (regulatory limit)
- Settlement: T+1 to our merchant account; not same-day

---

## Analytics — Amplitude

**What it does:** Product analytics (user behaviour, funnel analysis, retention cohorts).
**Owner repos:** `tradeeasy-ios`, `tradeeasy-android`, `tradeeasy-web` (client-side SDK)
**Auth:** API key per platform, hardcoded in client build (not secret — standard Amplitude pattern)

**Key events tracked (examples):**
| Event | Properties |
|-------|------------|
| `order_submitted` | `order_type`, `side`, `ticker`, `value_aed` |
| `alert_created` | `ticker`, `direction`, `channel` |
| `alert_triggered` | `ticker`, `time_to_trigger_seconds` |
| `notification_tapped` | `notification_type`, `ticker` |

**Constraints:**
- No PII in events: use internal `user_id` not email; no account balances in properties
- GDPR: Amplitude DPA signed; EU data residency enabled for EU users
- Amplitude is analytics-only — never use it as a source of truth for business logic

---

## Integration Ownership Summary

| Integration | Owner Repo | Secrets Key | Who changes it |
|-------------|------------|-------------|----------------|
| Polygon.io | `tradeeasy-market-data` | `polygon/api-key` | Backend Eng |
| FCM | `tradeeasy-api` | `fcm/service-account` | Backend Eng |
| APNs | `tradeeasy-api` | `apns/auth-key` | iOS Eng + Backend Eng |
| SendGrid | `tradeeasy-api` | `sendgrid/api-key` | Backend Eng |
| Sumsub | `tradeeasy-api` | `sumsub/*` | Backend Eng + Compliance |
| Network International | `tradeeasy-api` | `network-intl/credentials` | Backend Eng + Finance |
| Amplitude | All clients | Build-time env var | All teams |
