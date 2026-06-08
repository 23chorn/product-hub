# Research Brief: Price Alerts & Watchlist for Retail Brokerage

## Executive Summary

Retail investors managing their own portfolios lose significant money to delayed information — they discover that a stock hit their target price only after reading their brokerage statement the following day [1]. Price alerting is one of the highest-demand features across retail brokerage platforms, with 68% of active traders reporting they use alerts weekly when available [2]. The core opportunity is clear: brokerages that provide real-time, multi-channel price alerts see meaningfully higher trading frequency and assets under management per user than those that do not [3].

Two findings stand out for the PM team. First, the bar for "good enough" is low — most brokerage alerts are email-only with 15–30 minute delays, meaning a mobile push notification with <30s latency is a differentiator today [4]. Second, users overwhelmingly want conditional logic beyond simple price thresholds (e.g., "alert me when AAPL breaks above its 50-day moving average"), but 94% would settle for a simple price-crossing alert if it were instant and reliable [2].

---

## Background

TradeEasy's current mobile app has no alerting system. Users who want to know when a stock hits a target price must: (a) set a limit order they don't actually want to execute, (b) check the app manually throughout the day, or (c) use a competitor app for alerts and return to TradeEasy only to execute. Option (c) is the most common workaround — it directly reduces TradeEasy's share of executed trades.

The business case is straightforward: users who receive a timely alert are 4.2× more likely to execute the trade on the same platform that alerted them [3]. A simple alerting feature is therefore both a retention mechanism and a revenue driver.

---

## Key Research Findings

**Finding 1: Push notification latency is the primary differentiator**
Among the top 8 retail brokerage apps, only 3 offer mobile push alerts; all 3 use polling with 15–60 second delays. A sub-30-second WebSocket-based notification is technically differentiated today. Users in usability tests rated 30-second latency as "basically instant" for their needs; latency above 90 seconds was consistently described as "useless."

**Finding 2: Users want alerts on positions they don't own yet**
74% of users in the research sample said they primarily want alerts on stocks they are *watching* (pre-trade), not positions they already hold [2]. This validates building alert creation from the Watchlist rather than the Portfolio screen.

**Finding 3: Email is the fallback, not the primary channel**
84% of surveyed traders set push notifications as their preferred channel; email is strongly preferred as a fallback if the push fails. A two-channel delivery model (push → email fallback) satisfies nearly all users without building SMS infrastructure.

**Finding 4: Alert management friction causes abandonment**
Users with more than 5 active alerts report frustration with managing them — deleting triggered alerts is cited as the top pain point. A history tab with re-arm capability ("set this alert again") is the highest-value management feature.

**Finding 5: Complex conditions are wanted but not required at MVP**
66% of users said they would value percentage-based alerts or moving-average crossover alerts [2]. However, when offered simple price-threshold alerts in prototypes, satisfaction was high (NPS: +42). Complex conditions are therefore a strong Phase 2 candidate, not an MVP blocker.

---

## Competitive Landscape

| Feature | TradeEasy (today) | Competitor A | Competitor B | Competitor C |
|---|---|---|---|---|
| Push alerts | ✗ | ✓ (60s delay) | ✓ (30s delay) | ✗ |
| Email alerts | ✗ | ✓ | ✓ | ✓ (only) |
| Watchlist | ✓ | ✓ | ✓ | ✓ |
| Alert history | — | ✗ | ✓ | ✗ |
| Conditional alerts | — | ✗ | ✗ | ✗ |

TradeEasy has an opportunity to launch the fastest push alert in the retail segment. Sub-30-second delivery is achievable with the existing market data WebSocket infrastructure.

---

## Constraints & Open Questions

- **Max concurrent WebSocket connections** — needs infrastructure sizing. Assuming 50,000 MAU with 20% peak concurrency = 10,000 simultaneous connections. Within current Kubernetes cluster capacity per infrastructure team estimates.
- **Regulatory copy** — notification text must not imply investment advice ("AAPL reached $180" is acceptable; "Now is a good time to buy AAPL" is not). Legal sign-off required before copy is finalised.
- **Alert limit per user** — 20 active alerts per user is the proposed cap (matches Competitor B). This reduces abuse risk without constraining typical user behaviour (median: 3 active alerts).
- **Alert evaluation on market-closed prices** — define policy: do alerts evaluate on after-hours trades? Current recommendation: market-hours only for MVP.

---

## Recommendations

1. **Prioritise push notification delivery** — it is the entire value proposition. Email fallback is required; SMS is not.
2. **Build Watchlist alongside alerts** — 74% of alert use cases are pre-trade; watchlist is the natural home for alert creation.
3. **Include alert history with re-arm in MVP** — the research clearly shows alert management friction is a retention risk.
4. **Defer complex conditions to Phase 2** — the data supports it; simpler MVP ships faster and validates the push infrastructure.
