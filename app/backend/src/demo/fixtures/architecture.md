# Architecture Document: Price Alerts & Watchlist — TradeEasy

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Mobile Client                       │
│   iOS / Android App  ←→  WebSocket (quotes)             │
│   REST API calls (watchlist, alerts CRUD)               │
└────────────────┬────────────────────────────────────────┘
                 │ HTTPS / WSS
┌────────────────▼────────────────────────────────────────┐
│                    API Gateway (AWS)                    │
│   Rate limiting · Auth (JWT) · Route dispatch          │
└──────┬──────────────┬────────────────────┬─────────────┘
       │              │                    │
┌──────▼──────┐ ┌─────▼──────┐ ┌──────────▼──────────┐
│  Watchlist  │ │   Alerts   │ │  Quote Feed Service  │
│   Service   │ │   Service  │ │  (Node.js, port 3002)│
│  (Node.js)  │ │  (Node.js) │ │  Polygon.io WebSocket│
└──────┬──────┘ └─────┬──────┘ └──────────┬──────────┘
       │              │                    │
       └──────┬───────┘         ┌──────────▼──────────┐
              │                 │  Alert Evaluator     │
         ┌────▼────┐            │  (Redis Streams      │
         │PostgreSQL│           │   consumer group)   │
         │  (RDS)  │            └──────────┬──────────┘
         └─────────┘                       │
                              ┌────────────▼──────────┐
                              │  Notification Service  │
                              │  FCM (push) /          │
                              │  SendGrid (email)      │
                              └───────────────────────┘
```

### Data flow — alert trigger
1. Polygon.io streams real-time trades → Quote Feed Service
2. Quote Feed publishes `{ticker, price, timestamp}` to Redis Stream `quotes`
3. Alert Evaluator (5 worker instances) consumes `quotes` stream; loads active alerts for ticker from Redis hash `alerts:{ticker}`
4. If alert condition met: publish to `alert_triggers` stream
5. Notification Service reads `alert_triggers`, calls FCM for push, falls back to SendGrid if FCM returns delivery failure
6. Alert record updated in PostgreSQL (status → 'triggered', triggered_at, triggered_price)

---

## Key Technology Decisions

| Decision | Choice | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Real-time quote feed | Polygon.io Starter ($29/mo) | IEX Cloud, Alpaca, self-built NYSE feed | Best latency (< 500ms), simple WebSocket API, covers equities + ETFs |
| Alert evaluation | Redis Streams + consumer group | Kafka, RabbitMQ, cron polling | Low latency, no broker overhead for this throughput level; Redis already in stack |
| Push notifications | Firebase Cloud Messaging (free) | OneSignal, AWS SNS | Free tier covers 100K/day; direct iOS/Android support |
| Email fallback | SendGrid (existing) | SES, Mailgun | Already contracted; no new vendor |
| Database | PostgreSQL 15 on RDS (existing) | DynamoDB, MongoDB | Relational model fits watchlist/alerts; avoids new data store |

---

## Data Model

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| `watchlist_items` | id | UUID PK | |
| | user_id | UUID FK → users | indexed |
| | ticker | VARCHAR(10) | e.g. "AAPL" |
| | sort_order | INT | user-defined order |
| | created_at | TIMESTAMPTZ | |
| `price_alerts` | id | UUID PK | |
| | user_id | UUID FK → users | indexed |
| | ticker | VARCHAR(10) | indexed |
| | target_price | NUMERIC(12,4) | |
| | direction | ENUM('above','below') | |
| | status | ENUM('active','triggered','deleted') | indexed |
| | channel | ENUM('push','email','both') | default 'push' |
| | created_at | TIMESTAMPTZ | |
| | triggered_at | TIMESTAMPTZ | nullable |
| | triggered_price | NUMERIC(12,4) | nullable |
| `alert_notifications` | id | UUID PK | |
| | alert_id | UUID FK → price_alerts | |
| | channel | ENUM('push','email') | |
| | status | ENUM('sent','failed','delivered') | |
| | sent_at | TIMESTAMPTZ | |

**Redis keys:**
- `alerts:{ticker}` — Hash: `{alertId: JSON_payload}` for all active alerts on a ticker. Loaded by Alert Evaluator on first price event, evicted after 5min idle.
- `user_alert_count:{userId}` — Counter for enforcing 20-alert cap; TTL-less.

---

## API Surface

| Method | Path | Auth | Request | Response | Notes |
|--------|------|------|---------|----------|-------|
| GET | `/api/watchlist` | JWT | — | `[{ticker, lastPrice, changePercent, sortOrder}]` | Returns real-time quote data |
| POST | `/api/watchlist` | JWT | `{ticker}` | `{id, ticker, sortOrder}` | 400 if ticker invalid |
| DELETE | `/api/watchlist/:ticker` | JWT | — | 204 | Also deletes alerts for that ticker |
| PATCH | `/api/watchlist/reorder` | JWT | `{items: [{ticker, sortOrder}]}` | 200 | Batch sort update |
| GET | `/api/alerts` | JWT | — | `[Alert]` | Active + triggered last 90 days |
| POST | `/api/alerts` | JWT | `{ticker, targetPrice, direction, channel}` | `{id, ...}` | 400 if 20-alert cap hit; 422 if price already met |
| DELETE | `/api/alerts/:id` | JWT | — | 204 | Soft delete (status → 'deleted') |
| POST | `/api/alerts/:id/rearm` | JWT | — | `{id, status: 'active'}` | Resets triggered alert to active |
| GET | `/ws/quotes` | JWT (query param) | — | WebSocket stream `{ticker, price, changePercent, ts}` | Subscribe: `{action:"subscribe", tickers:["AAPL"]}` |

---

## Infrastructure Notes

**Hosting:**
- All services on existing AWS ECS Fargate cluster; no new infrastructure provisioned
- Alert Evaluator: 5 tasks × 0.5 vCPU / 1GB RAM; auto-scales to 20 at market open
- Quote Feed Service: 2 tasks × 0.25 vCPU / 512MB; one Polygon.io connection per task with reconnect logic

**Cost estimate (per 10,000 active users):**
- Polygon.io Starter: $29/mo flat
- Redis ElastiCache (existing, +10% usage): ~$12/mo incremental
- FCM: free
- SendGrid (existing, ~2,000 alert emails/day): within existing plan
- ECS Fargate for Alert Evaluator: ~$45/mo
- **Total incremental: ~$86/mo for 10K users (~$0.009/user/month)**

**Failure modes:**

| Failure | Impact | Mitigation |
|---------|--------|------------|
| Polygon.io disconnect | Alerts not evaluated during gap | Auto-reconnect with 5s backoff; emit `feed_degraded` event; suppress alert delivery to avoid stale-price triggers |
| Redis unavailable | Alert evaluation halts | Fallback to PostgreSQL query for active alerts (≤5s latency degradation); alert in PagerDuty |
| FCM unavailable | Push not delivered | Email fallback triggers automatically after 30s FCM timeout |
| Alert Evaluator crash | Triggers may be delayed | Consumer group offset resumes from last-processed message; max 5min gap at 5-worker restart |

---

## Open Questions & Risks

| # | Question/Risk | Severity | Recommendation |
|---|--------------|----------|----------------|
| 1 | Exchange data licensing upgrade needed if > 5K real-time users | High | Negotiate Polygon Business tier ($199/mo) before launch; model cost at 10K, 50K user milestones |
| 2 | WebSocket connection management on mobile (background/foreground lifecycle) | Med | Use REST polling (15s) when app is backgrounded; WebSocket only in foreground |
| 3 | Alert evaluation correctness at low-liquidity tickers (penny stocks) | Low | Use last trade price, not bid/ask; document in user-facing copy that alerts use last-trade price |
