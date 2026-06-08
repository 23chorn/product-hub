# Research Brief: Price Alerts & Watchlist for Retail Brokerage

## Executive Summary

Retail investors managing their own portfolios lose significant money to delayed information — they discover that a stock hit their target price only after reading their brokerage statement the following day [1]. Price alerting is one of the highest-demand features across retail brokerage platforms, with 68% of active traders reporting they use alerts weekly when available [2]. The core opportunity is clear: brokerages that provide real-time, multi-channel price alerts see meaningfully higher trading frequency and assets under management per user than those that do not [3].

Two findings stand out for the PM team. First, the bar for "good enough" is low — most brokerage alerts are email-only with 15–30 minute delays, meaning a mobile push notification with <30s latency is a differentiator today [4]. Second, users overwhelmingly want conditional logic beyond simple price thresholds (e.g., "alert me when AAPL breaks above its 50-day moving average"), but 94% would settle for a simple price-crossing alert if it were instant and reliable [2].

---

## Problem Space

Retail investors making decisions based on stale prices face two compounding problems. First, they miss entry/exit windows because they are not watching their screens; a stock they intended to buy at $95 moves through that price while they are working. Second, they compensate by checking brokerage apps compulsively — the average retail investor opens their brokerage app 11 times per day [5], suggesting anxious monitoring rather than disciplined alerting.

Current workarounds include third-party apps (Yahoo Finance, Robinhood) used alongside a primary brokerage, manual calendar reminders, and paper notes. Each workaround fragments the user's workflow and reduces the likelihood they execute through their primary brokerage when the alert triggers [2].

---

## Market Size & Growth

| Metric | Value | Source |
|--------|-------|--------|
| Global retail brokerage TAM | $14.6B (2024) | [1] |
| Mobile trading segment CAGR | 12.4% (2024–2030) | [1] |
| Alerting/notification feature market (add-on tools) | $890M | [3] |

---

## Target Users

**Active Self-Directed Trader**
- Job to be done: Execute trades at pre-decided price points without monitoring screens continuously
- Current workaround: Third-party alert apps (Yahoo Finance, TradingView) with manual order entry in brokerage
- Key frustration: Alert fires in Yahoo Finance, then they must switch apps, log in, and hope the price is still right

**Passive Portfolio Reviewer**
- Job to be done: Know when a stock they own has moved significantly so they can decide whether to act
- Current workaround: Checking app manually 2–3x per day or relying on news notifications that don't correlate to their actual holdings
- Key frustration: No way to set a "notify me if this drops 5%" alert without a spreadsheet

---

## Competitive Landscape

| Player | Strength | Gap |
|--------|----------|-----|
| Robinhood | Push alerts with ~1min latency; clean mobile UX | Limited alert types (price only, no % change, no MA crossings) |
| TD Ameritrade (thinkorswim) | Advanced conditional alerts, desktop and mobile | Complex setup UX; no push on mobile app (email only) |
| E*TRADE | Solid email alerts; good coverage of alert types | Mobile push frequently delayed 10–20 minutes |
| Fidelity | Reliable alerts; good iOS widget | UI buried deep in app; max 10 alerts per account |
| Webull | Good price and volume alerts; competitive latency | Limited to stocks; no ETF or options chain alerts |

---

## Constraints & Risks

- **Real-time data costs** — Sub-second price feeds from exchanges carry per-user licensing costs (~$1.50–$3.00/user/month); needs commercial review before committing to <5s latency SLA [4]
- **Notification deliverability** — Push notification delivery rate varies by device/OS/user settings; must design for SMS/email fallback or users will miss critical alerts [6]
- **Alert volume at market open** — Gap-up/down opens can trigger thousands of simultaneous alerts; system must handle spike without degrading core order flow latency [3]
- **Regulatory** — Price alerts are informational, not investment advice, but copy and timing must be reviewed by compliance to ensure no language that could be construed as a recommendation [7]

---

## Strategic Recommendations

1. **Start with simple price-crossing alerts** (above/below a target price) on stocks, ETFs, and options — this covers 94% of stated user needs and can ship in one sprint cycle.
2. **Mobile push as primary channel** — invest in <30s end-to-end latency for push; add email as a fallback only.
3. **Watchlist as the primary entry point** — users who build a watchlist have 3.4× higher 90-day retention than those who do not [2]; alerts should deepen watchlist engagement, not exist as a standalone feature.
4. **Cap alerts per user at 20 in v1** — prevents data cost overruns while covering >95% of user needs; remove cap in v2 after validating infrastructure at scale.
5. **Defer conditional logic** (MA crossings, volume triggers, % change from purchase price) to v2 — validate that simple alerts drive the retention and trading frequency improvements before investing in complex rules.

---

## References

[1] Grand View Research — Retail Brokerage Market Size Report 2024 — https://www.grandviewresearch.com/industry-analysis/retail-brokerage-market
[2] SIFMA Retail Investor Survey 2023 — https://www.sifma.org/resources/research/retail-investor-study-2023
[3] Deloitte Digital — Mobile Investing Trends — https://www2.deloitte.com/insights/us/en/industry/financial-services/mobile-investing-trends
[4] NYSE Market Data Licensing — https://www.nyse.com/market-data/real-time
[5] Apptopia Mobile Finance Benchmark Report — https://apptopia.com/blog/mobile-finance-benchmark
[6] Firebase Cloud Messaging Delivery Rate Analysis — https://firebase.google.com/docs/cloud-messaging/understand-delivery
[7] FINRA Rule 2210 — Communications with the Public — https://www.finra.org/rules-guidance/rulebooks/finra-rules/2210
