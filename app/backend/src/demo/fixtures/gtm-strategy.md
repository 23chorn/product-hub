# GTM Strategy — Price Alerts & Watchlist
## TradeEasy · Feature Launch Plan

---

## 1. Launch Objective

Drive adoption of Price Alerts by existing TradeEasy users and use the feature as a re-engagement hook for dormant accounts. Success is measured by alert-set rate (≥ 25% of monthly active users set at least one alert within 60 days of launch) and a 15% reduction in unintended limit-order executions.

---

## 2. Target Segments

| Segment | Description | Size (est.) | Priority |
|---|---|---|---|
| **Active traders** | Log in ≥ 3×/week, hold 5–20 positions | 42,000 users | P0 |
| **Watchlist users** | Use watchlist but rarely trade | 68,000 users | P1 |
| **Dormant users** | No login in 60–180 days | 31,000 users | P2 |

---

## 3. Positioning

**For** retail investors who miss price opportunities because they can't watch screens all day, **TradeEasy Price Alerts** is a real-time notification system that **tells you exactly when a stock hits your target price** — so you can act with intention instead of reacting to surprises.

Unlike limit orders that execute automatically, Price Alerts give you **control**: you decide whether to trade when the moment arrives.

---

## 4. Key Messages by Channel

### In-app (push notification at trigger)
> "⚡ AAPL just crossed $185.00 — your alert triggered. Tap to review."

### App store update copy
> **Set it. Wait. Act when it counts.**
> Price Alerts notify you the moment a stock crosses your target — no accidental fills, no missed entries. Available now for equities and ETFs.

### Email (re-engagement campaign)
> Subject: "You've been watching TSLA. Now get notified when it moves."
> Body: 2-screen GIF showing alert creation → push notification → trade execution.

### In-app tooltip (first login after update)
> "New: Price Alerts. Tap any position or watchlist item → Set Alert. We'll ping you when the price hits."

---

## 5. Launch Phases

### Phase 1 — Soft Launch (Week 1–2)
- Roll out to 10% of active traders (A/B control maintained)
- Monitor notification delivery rate, alert-set funnel, crash rate
- Support team briefed on top 5 FAQs

### Phase 2 — Full Rollout (Week 3)
- 100% of registered users
- In-app announcement banner (dismissable, shown once)
- Push notification to watchlist users: "Your watchlist just got smarter"

### Phase 3 — Re-engagement (Week 4–6)
- Email campaign to dormant segment (31k users)
- Deep-link from email directly to alert-creation screen for their top held position
- Measure 30-day reactivation rate vs. control

---

## 6. Channel Plan

| Channel | Message | Owner | Timing |
|---|---|---|---|
| In-app banner | Feature announcement | Product | Launch day |
| Push notification | "New: Price Alerts" | Growth | Launch day |
| Email | Re-engagement to dormant users | CRM | Week 4 |
| App store listing | Updated screenshots + copy | Marketing | Release day |
| Support docs | FAQ + video walkthrough | Support | Pre-launch |

---

## 7. Success Metrics (60-day post-launch)

| Metric | Target | Baseline |
|---|---|---|
| Alert-set rate (MAU) | ≥ 25% | 0% |
| Push opt-in retention | ≥ 70% | N/A |
| Unintended limit executions | –15% | Current rate |
| Dormant user reactivation | ≥ 8% | 3% (avg campaign) |
| App store rating impact | No degradation | 4.2★ |

---

## 8. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Notification fatigue (too many alerts) | Medium | Default cap: 10 alerts/day; user-configurable |
| Regulatory language in push copy | Low | Legal review gate before all copy is final |
| High alert volume at market open stresses infra | Medium | Load-tested to 50k concurrent triggers; Redis Streams buffer |
