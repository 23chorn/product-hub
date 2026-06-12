# PRD: In-App Messaging & Trade Chat — xCube

**Status:** Draft

---

## Problem Statement

xCube retail investors discuss trades and market setups on external platforms (Discord, WhatsApp, Telegram) and then context-switch back to the app to execute. This 6–8 minute execution gap reduces trade conversion and increases abandonment to competitor apps. There is no way to share a live ticker directly into a conversation or act on a peer's trade idea without leaving xCube.

---

## User Personas

**Alex — Active Self-Directed Trader** — trades 10–20 times per month, follows 3–5 stock communities on Discord
- Goal: Discuss live setups and share positions with peers without leaving the trading app
- Pain: Misses execution windows while copying ticker symbols between Discord and the order screen

**Jamie — Casual Community Investor** — buys and holds, follows finance influencers
- Goal: Learn from more experienced traders in real time to build confidence
- Pain: No way to ask questions about a position from within xCube; must go to Reddit or Discord

---

## Key User Journeys

### Journey 1: Join a topic channel and discuss a ticker
1. User opens the Chat tab in the bottom nav
2. User browses available channels (e.g. #aapl-watchers, #macro-watch)
3. User taps to join a channel and sees the live message thread
4. User reads an AAPL setup message with an embedded ticker card showing $227.52 (+1.83%)
5. User taps the ticker card → lands on AAPL detail screen with a pre-filled buy order

### Journey 2: Share a live ticker card in a message
1. User is viewing a ticker detail screen (e.g. NVDA at $875)
2. User taps "Share to Chat" → channel picker opens
3. User selects #nvda-bulls → a ticker card is attached to the message draft
4. User adds text ("My updated target after yesterday's run:") and sends
5. The message appears in the channel thread with a live price card that updates in real time

### Journey 3: Send a message in a channel
1. User opens a channel, types in the compose box
2. Presses Enter / taps Send
3. Message appears in the thread within 500ms; other channel members see it simultaneously

---

## Functional Requirements

| ID | Requirement |
|---|---|
| FR-01 | Users can browse a list of public channels sorted by activity |
| FR-02 | Users can join/leave a channel; joined channels appear in the sidebar |
| FR-03 | Users can send text messages up to 2,000 characters in a channel |
| FR-04 | Messages are delivered to all channel members within 500ms (p95) |
| FR-05 | Users can attach a live ticker card from any xCube instrument to a message |
| FR-06 | Ticker cards display: symbol, current price, intraday % change (updated every 15s) |
| FR-07 | Tapping a ticker card opens the instrument detail screen |
| FR-08 | All messages pass through content moderation before delivery |
| FR-09 | Messages flagged by moderation are held pending human review and not delivered |
| FR-10 | All messages are retained for 7 years (MiFID II compliance) |
| FR-11 | Users can create a new public channel with a name and topic description |

---

## Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-01 | Message delivery end-to-end latency: <500ms at p95 under 5,000 concurrent users |
| NFR-02 | Message history loads within 1 second for up to 500 messages per channel |
| NFR-03 | System must support 10,000 concurrent WebSocket connections |
| NFR-04 | All messages retained in cold storage for 7 years (MiFID II) |
| NFR-05 | Moderation classifier must achieve >92% precision on pump-and-dump detection |
| NFR-06 | Feature available on iOS and Android at launch |

---

## Out of Scope (MVP)

- Direct messages (peer-to-peer) — deferred to Phase 2
- Voice or video channels
- Message reactions / emoji responses
- File or image attachments (non-ticker)
- Private (invite-only) channels
- Message threads / replies
- Notification preferences per-channel

---

## Success Metrics

| Metric | Baseline | 90-day Target |
|---|---|---|
| 7-day active users using Chat | 0% | 25% |
| Message-to-trade conversion rate | 0% | 8% (user chats then trades within 10 min) |
| 30-day retention (Chat users vs non) | — | +15% lift |
| Ticker card share actions per DAU | 0 | 0.4 |
| Moderation false-positive rate | — | <5% |

---

## Dependencies

- **Market Data Service**: ticker card price updates via existing internal WebSocket quote feed
- **Push Notification Service**: out-of-app alerts for unread messages (Phase 2; not MVP)
- **Compliance / Legal**: sign-off on MiFID II interpretation and notification copy
- **Content Moderation**: LLM classifier + human review workflow
