# Architecture: In-App Messaging & Trade Chat — TradeEasy

## Overview

The messaging feature adds a real-time channel-based chat layer to TradeEasy. The architecture prioritises sub-500ms delivery latency, horizontal scalability to 10,000 concurrent connections, and a compliant 7-year message retention pipeline.

---

## High-Level Architecture

```
Client (iOS / Android / Web)
  │
  ├── REST API  ──────────────────────► API Gateway ──► Message Service (Node.js)
  │   (history, channel CRUD)                              │
  │                                                         ├─► PostgreSQL (channels, membership)
  └── WebSocket ─────────────────────► WS Gateway          ├─► Redis Pub/Sub (fan-out)
      (real-time send/receive)          (Nginx+)            ├─► Cassandra (message store)
                                                            └─► Moderation Service
                                                                    │
                                                                    ├─► LLM Classifier (async)
                                                                    └─► Human Review Queue

Archive Pipeline (async):
  Cassandra ──► Kafka topic: messages.archive ──► S3 cold storage (7-year retention)

Ticker Card Feed:
  Market Data Service (existing) ──► WS quote updates ──► Message Service ──► Client
```

---

## Components

### Message Service (new)
Core service responsible for message persistence, fan-out, and moderation gating.

**Technology:** Node.js + TypeScript (consistent with existing backend)

**Responsibilities:**
- Accept inbound messages via WebSocket or REST
- Write to Cassandra before fan-out (write-through, not write-behind)
- Publish to Redis Pub/Sub channel for fan-out to connected subscribers
- Invoke Moderation Service asynchronously; hold message if flagged
- Emit ticker-card price update subscriptions to the Market Data Service

**Scaling:** Stateless; horizontally scalable behind the WS Gateway. Each instance subscribes to all channels it has active connections for via Redis Pub/Sub.

### WebSocket Gateway (new)
Nginx with the stream module, or a dedicated WS proxy (HAProxy). Terminates TLS, handles connection upgrades, sticky-sessions not required (Redis-backed fan-out handles cross-instance delivery).

### Cassandra Cluster (new)
Primary message store. Schema optimised for the primary read pattern: "get the last N messages for channel X sorted by time descending."

```
Table: messages
  channel_id  UUID       PARTITION KEY
  created_at  TIMESTAMP  CLUSTERING KEY (DESC)
  message_id  UUID
  user_id     UUID
  content     TEXT
  ticker_ref  TEXT       (nullable — JSON: {symbol, price_at_send, change_at_send})
  moderation_status  TEXT  (approved | pending | rejected)
```

Cassandra is chosen over PostgreSQL for messages because:
1. Write throughput at scale without contention
2. Native TTL support for 7-year retention (data auto-expires; no purge job)
3. Channel-partitioned queries are trivially fast

### Moderation Service (new)
Async pipeline that classifies each inbound message before it is delivered.

**Stage 1 — Rule-based (synchronous, <5ms):** Blocklist patterns, URL detection, ticker velocity (same ticker >10 mentions in 5 min in a channel).

**Stage 2 — LLM Classifier (async, ~200ms):** Prompt-based classification for pump-and-dump signals, hate speech, unsolicited investment advice. Target precision: >92%.

**Stage 3 — Human Review Queue:** Messages flagged by Stage 2 enter a compliance review queue (Slack-based for MVP). Reviewer approves/rejects within SLA.

**Delivery flow:**
- Rule-based passes → message delivered immediately to WebSocket subscribers
- LLM flags → message held, sender sees "Your message is under review"
- Human approves → message delivered retroactively; user notified

### Archive Pipeline (new)
Kafka consumer reads from `messages.archive` topic (Cassandra change-data capture via Debezium). Writes to S3 in Parquet format partitioned by `channel_id/year/month`. Accessible via Athena for compliance team search queries.

### Ticker Card Feed (leverages existing)
The existing Market Data Service already provides a WebSocket quote stream per symbol. The Message Service subscribes to symbols referenced in active ticker cards and pushes price updates to clients every 15 seconds.

---

## Data Model

### PostgreSQL (channels and membership)
```sql
CREATE TABLE channels (
  id          UUID PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,        -- e.g. 'aapl-watchers'
  topic       TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  member_count INT DEFAULT 0
);

CREATE TABLE channel_members (
  channel_id  UUID REFERENCES channels(id),
  user_id     UUID REFERENCES users(id),
  joined_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
```

### Redis
- `channel:{channel_id}:subscribers` — set of connected WebSocket connection IDs
- Pub/Sub topic per channel for fan-out: `ch:{channel_id}`
- Rate limiting: `ratelimit:msg:{user_id}` — sliding window counter (max 30 messages/min)

---

## API Design

### REST
```
GET  /api/channels                    — list public channels (paginated, sorted by activity)
POST /api/channels                    — create channel
POST /api/channels/:id/join           — join channel
POST /api/channels/:id/leave          — leave channel
GET  /api/channels/:id/messages       — fetch history (cursor-based pagination)
```

### WebSocket Protocol
```
// Client → Server
{ "type": "subscribe", "channelId": "uuid" }
{ "type": "send",      "channelId": "uuid", "content": "text", "tickerRef": { "symbol": "AAPL" } }
{ "type": "unsubscribe","channelId": "uuid" }

// Server → Client
{ "type": "message",   "channelId": "uuid", "messageId": "uuid", "userId": "uuid",
  "content": "text", "tickerCard": { "symbol": "AAPL", "price": 227.52, "change": 1.83 },
  "createdAt": "ISO8601" }
{ "type": "ticker_update", "symbol": "AAPL", "price": 228.10, "change": 2.16 }
{ "type": "moderation_held", "messageId": "uuid" }
```

---

## Operational Considerations

- **Connection limits:** Each Message Service pod handles ~2,000 WebSocket connections; 5 pods = 10,000 target
- **Message rate limit:** 30 messages/minute per user (Redis sliding window); prevents spam and reduces moderation load
- **Backpressure:** WS Gateway drops connections exceeding 10,000 with a 503; client retries with exponential backoff
- **Monitoring:** Prometheus metrics on message throughput, moderation queue depth, WebSocket connection count, p95 delivery latency
