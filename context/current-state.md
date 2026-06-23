# Current state overview

## Platforms (Live today)

### Shared
- One backend service that holds functionality across all platforms listed below

### Mobile app (iOS / Android)
- Primary surface for retail investors
- Core trading, portfolio, funding
- Discovery: watchlist, Top Movers (Value, Volume, Winners, Losers), Trending Stocks, Curated Lists
- Onboarding: KYC, UAE Pass
- xCube Access: Personal Advisor Hiring, Passive Strategies (Specification complete — Pre-Development, targeting 2026)

### Web app
- Secondary surface — desktop context, limited functionality as of Q1 2026. Internal rollout Q1 2026, wider rollout Q2 2026.
- Missing features: Onboarding, Deposits, Withdrawals

### White label mobile app
- Branded and configured version of the core mobile app for B2B partners
- Current partners: Shuaa Capital (first rollout phase)
- Key constraint: any new feature must be configurable as on/off per partner

### API-as-a-service (xCube Connect)
- REST API exposing core brokerage capabilities to B2B partners
- Current partners: Stockgro, InsuranceMarket.ae

### Advisor portal
- Licensed advisors managing xCube Access users — model portfolios, client subscriptions, performance reporting

### Admin portal
- Internal ops surface: KYC review, user management, compliance reporting
- Not agent-facing — include only when explicitly relevant to a feature

## Active work

- **Top Movers Discovery Expansion (5 → 50)** — Specification complete, pre-development (workflow 33e16ae0)
  - "See All" affordance on existing Top 5 widget navigates to a dedicated page showing up to 50 ranked stocks per category (Value/Volume/Winners/Losers) and exchange (DFM/ADX), served by a new cached REST endpoint in the existing monolith.
  - Blockers: Dory API commercial contract confirmation (increased payload size must be covered by current contract); CleverTap baseline instrumentation must be live pre-launch (depends on CleverTap integration completing)

- **Exchange Circuit Limit Display & Client-Side Validation** — Specification complete, pre-development (workflow 58c2910a)
  - Surfaces DFN-provided daily limit up/down values on the trade screen (iOS and Android only) with client-side validation blocking out-of-range limit orders; backend passthrough via new CircuitLimitsController in MarketDataService reading a daily-refreshed DB view into IMemoryCache.
  - Blockers: None identified

- **Recurring Card Payments (Card)** — Specification complete, pre-development (workflow 65c2a1a4)
  - Automated monthly credit/debit card deposits via Worldpay MIT flow with xCube-owned Hangfire scheduler, single active schedule per user, Manage Funds portal for lifecycle management (pause/resume/cancel), and 4-attempt retry with auto-pause on exhaustion.
  - Blockers: None identified

## Known debt and issues

## Recent decisions

- **Passive Strategies (workflow ffa5afd1):** Manual ops approval for money movement; pessimistic locking for balance mutations; monolith-first; end-of-day valuations; full withdrawal only in MVP; AED 5,000 minimum allocation

- **Recurring Card Payments (workflow 7062747e):** Monthly-only frequency for MVP; xCube-owned scheduler (not Worldpay-managed); single active schedule per user via filtered unique index; day-of-month restricted to 1–28; idempotency key on all Worldpay charge requests

- **Virtual IBAN Deposits (workflow da0efe7f):** Monolith-first; webhook-primary with mandatory 15-minute polling fallback; on-demand IBAN provisioning; persistent IBAN per user; reversal via auto-debit or negative balance hold; discovery spike as hard gate before development

- **Order Validation API (workflow a9df8c22):** Monolith-first; Stocks and ETFs only (Futures Phase 2); validation pipeline (chain-of-responsibility); advisory and authoritative modes; fail-closed error handling; commission rates in DB (tenant-configurable); ValidationAuditLog with 7-year retention

- **CleverTap Integration (workflow 63901f4a):** Additive alongside GA and Braze; analytics dispatcher abstraction per platform; async Hangfire batching (200 events/batch); in-memory queue acceptable for analytics (~42 event loss on restart); $0 xCube infrastructure cost

- **Top Movers Expansion (workflow 33e16ae0):** Monolith-first; IMemoryCache with 60s TTL (not Redis); server-side Dory polling via IHostedService every 55s; no new DB tables; white-label single feature flag toggle; iOS UICollectionView+DiffableDataSource, Android RecyclerView+ListAdapter for virtualised rendering

- **Exchange Circuit Limit Display (workflow 4bd444e1):** Client-side only validation (fail-open if data unavailable; DFN enforces server-side); no new DB tables or backend endpoints in happy path; DFN real-time feed as sole data source with pre-warmed subscription on instrument selection; symmetric validation (limit_down ≤ price ≤ limit_up for both buy and sell); Decimal/BigDecimal types mandated for price comparisons; white-label feature flag toggle; 41 story points estimated across 1 sprint

- **Exchange Circuit Limit — Architecture Resolution (workflow 58c2910a):** Backend passthrough confirmed (DFN SDK does not expose limits directly); new CircuitLimitsController in MarketDataService with IMemoryCache refreshed daily at 09:15 UAE via IHostedService reading SQL Server DB view (vw_InstrumentCircuitLimits); iOS and Android only (web excluded); phased delivery — MVP (cache + display + fail-open + bilingual), Phase 1 (validation + error messaging + tooltip + analytics), Phase 2 (white-label flag + prefetch); fail-open preserves trading when data unavailable

- **Recurring Card Payments — full spec (workflow 65c2a1a4):** Hangfire Pro as scheduler engine; Worldpay MIT with scheme_transaction_reference for subsequent charges (no per-transaction 3DS after initial auth); AED 5,000/month fee-free threshold with card processing fees passed to user above that; 4-attempt retry on Day 0/1/3/7 then auto-pause; Worldpay Account Updater for expired card refresh; SQL Server tables (recurring_schedules, recurring_payments, recurring_payment_events); white-label feature flag toggle; 85 story points across ~2.1 sprints

