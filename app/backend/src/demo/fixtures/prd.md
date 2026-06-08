# PRD: Price Alerts & Watchlist — TradeEasy

**Status:** Draft

---

## Problem Statement

TradeEasy retail investors miss price targets because the app has no alerting system — users must monitor their screens or check back manually. This causes them to execute trades on third-party apps and reduces TradeEasy's share of the user's trading activity. 68% of active self-directed traders report using a competitor's alert feature alongside their primary brokerage, and users who receive a timely alert are 4.2× more likely to execute the trade on the same platform that alerted them.

---

## User Personas

**Alex — Active Self-Directed Trader** — trades 10–20 times per month, manages own portfolio of 15–30 positions
- Goal: Execute limit-price trades without watching screens all day
- Pain: Misses target prices because he's at work; catches the move hours later

**Maya — Passive Portfolio Reviewer** — buys and holds ETFs and blue-chips, checks portfolio weekly
- Goal: Know if something unexpected happens to her holdings so she can decide whether to act
- Pain: No way to set a "notify me if this drops 10%" alert; only finds out on her weekly check

---

## Key User Journeys

### Journey 1: Set a price alert on a position
1. User taps a ticker from their portfolio or search
2. User taps "Set Alert" on the ticker detail screen
3. User enters a target price (above or below current price) and selects notification channel (push / email)
4. User taps "Create Alert" — confirmation shown; alert appears in Alerts tab
5. When price crosses threshold, user receives push notification with ticker, trigger price, and current price
6. User taps notification → lands on ticker detail with pre-filled order ticket

### Journey 2: Manage watchlist
1. User searches a ticker and taps "Add to Watchlist"
2. Ticker appears on the Watchlist tab with real-time quote (last price, % change)
3. User can set an alert directly from the watchlist row
4. User can remove a ticker or reorder the list

---

## Success Metrics

**Primary metric**

| Metric | Baseline | Target | Timeframe | Measurement |
|--------|----------|--------|-----------|-------------|
| 7-day active user rate (users who open app ≥3×/week) | 22% | 31% | 60 days post-launch | Analytics DAU/WAU event |

**Secondary metrics**

| Metric | Baseline | Target | Timeframe | Measurement |
|--------|----------|--------|-----------|-------------|
| Alerts set per active user per week | 0 | 2.5 | 30 days post-launch | DB count |
| Trade executions via alert notification tap | 0 | 18% of triggered alerts | 60 days | Analytics funnel |
| Watchlist items per active user | 0 | 8 | 30 days | DB count |

**Counter-metrics**

| Metric | Current value | Acceptable floor | Measurement |
|--------|--------------|------------------|-------------|
| App crash rate | 0.4% | Must stay below 0.6% | Crashlytics |
| Order entry latency (p95) | 420ms | Must stay below 600ms | APM traces |

---

## Functional Requirements

**FR-01** — Users can add any US equity, ETF, or index fund ticker to a personal watchlist.
**FR-02** — Watchlist displays real-time last price and intraday % change for each ticker, updated at most every 15 seconds while the app is in the foreground.
**FR-03** — Users can set a price alert on any watchlist item or any ticker detail page. Alert requires: target price (numeric) and direction (above / below current price).
**FR-04** — Each user may have a maximum of 20 active alerts at one time.
**FR-05** — When a price alert triggers, the system sends a push notification within 30 seconds of the price crossing the threshold during market hours (09:30–16:00 ET, Mon–Fri, excluding market holidays).
**FR-06** — If push notification delivery fails, the system falls back to an email notification within 5 minutes.
**FR-07** — Alert notifications contain: ticker symbol, direction crossed ("reached your target of"), trigger price, and current price at time of notification.
**FR-08** — A triggered alert moves to an "Alerts History" tab with timestamp and prices; it is not automatically re-armed.
**FR-09** — Users can delete an active alert; deletion takes effect immediately.
**FR-10** — Users can re-arm a triggered alert from the Alerts History tab with one tap.
**FR-11** — Watchlist items can be reordered via drag-and-drop; order is persisted.
**FR-12** — Watchlist and alert settings are persisted across sessions and devices.
**FR-13** — When a user taps an alert notification, they land on the ticker detail screen with the order ticket pre-filled for a market order.
**FR-14** — Market hours are displayed on each watchlist item outside trading hours with the label "Market Closed".
**FR-15** — Alerts set for prices already met at time of creation are rejected with an inline error message.

---

## Non-Functional Requirements

| ID | Requirement | Threshold | Priority |
|----|-------------|-----------|----------|
| NFR-01 | Push notification latency (alert trigger to delivery) | < 30s during market hours | Must |
| NFR-02 | Watchlist quote refresh latency | ≤ 15s in foreground | Must |
| NFR-03 | API availability (alerts service) | 99.9% during market hours | Must |
| NFR-04 | Alert processing throughput at market open | 10,000 simultaneous alert evaluations/sec | Must |
| NFR-05 | Watchlist supports up to 50 items per user | No degradation beyond 50 | Should |
| NFR-06 | WCAG 2.1 AA accessibility on all new screens | Full audit pass | Must |
| NFR-07 | Alert history retained for 90 days | Purged after 90 days | Should |

---

## Open Questions & Risks

| # | Type | Description | Impact | Owner | Status |
|---|------|-------------|--------|-------|--------|
| 1 | Risk | Exchange real-time data licensing cost may exceed $2.50/user/month; could force 15-min delay for free tier | High | Finance | Open |
| 2 | Question | Should alerts trigger outside market hours (pre/after market)? | Med | PM | Open |
| 3 | Risk | Push notification deliverability varies; some users may never receive alerts if they have background refresh disabled | High | Engineering | Open |
| 4 | Question | Should we show a count badge on the app icon for unread alerts? | Low | Design | Open |
| 5 | Risk | Alert evaluation at market open spike (hundreds of gap-up/down alerts simultaneously) could impact order latency SLA | High | Engineering | Open |

---

## Out of Scope (v1)

- Conditional alerts (% change, moving average crossovers, volume spikes)
- Options chain alerts
- SMS notifications
- Shared watchlists
- Portfolio-level alerts (e.g., total portfolio down 5%)
