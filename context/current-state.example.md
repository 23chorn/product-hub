# Current State

> **How to use this file:** Copy to `current-state.md`, fill in your real details, and delete this note.
> `current-state.md` is gitignored — your project state stays local. This example uses a fictional company.
> **Update this file regularly** — stale state actively misleads agents.

*Last updated: 2026-03-14*

## What is live today

- **Core brokerage (UAE):** Buy/sell equities and ETFs listed on DFM, ADX, and US markets (NYSE/NASDAQ). Market and limit orders supported. Fractional shares enabled for US equities only.
- **KYC and onboarding:** Sumsub-powered identity verification. KYC Tier 1 (limited trading up to AED 50K) and Tier 2 (full trading). Current completion rate: 48% sign-up to funded account.
- **Portfolio view:** Holdings, P&L, transaction history, basic performance chart (1D/1W/1M/1Y).
- **Price data:** Real-time quotes for DFM/ADX during UAE market hours; 15-min delayed for US markets (real-time US upgrade in progress).
- **Arabic support:** 80% coverage — trading flows fully localised; settings, onboarding, and notifications partially localised.
- **Web platform:** Read-only portfolio view and account management. No trading on web.

## Active work (current sprint: Sprint 18, Mar 9–20)

- **Real-time US market data** — upgrading from delayed to real-time Refinitiv feed for US equities. Backend feed integration complete; mobile display in progress. ETA: end of sprint.
- **KYC Tier 2 optimisation** — reducing document re-submission rate (currently 28%). Clearer guidance UI and pre-validation before Sumsub submission. ETA: this sprint.
- **Baraka Advisory — advisor onboarding portal** — web portal for advisors to register, submit licensing documents for compliance review, and set up their profile. In development.
- **Arabic localisation completion** — remaining strings for onboarding and notifications. ETA: this sprint.
- **Order execution reliability** — investigating and fixing intermittent order status stuck in `submitted` state (2.1% of orders). Root cause identified as FIX gateway timeout handling. Fix in review.

## Known debt and issues

- **Fractional shares — GCC markets only:** Fractional share trading is not yet available for DFM/ADX listings due to exchange-level settlement constraints. High user demand — on the roadmap but blocked on exchange clearing member agreement.
- **Portfolio P&L currency mismatch:** Users with mixed AED and USD positions see P&L in AED only — USD positions are converted at snapshot rate, not live FX. Causes confusion; tracked as a medium-priority fix.
- **Push notifications reliability:** ~8% of price alert notifications fail to deliver on Android. Suspected FCM token refresh issue. Not yet root-caused.
- **Tadawul (KSA) market data:** Instrument metadata loaded but price data feed not yet connected — instruments show as `price unavailable`. Awaiting SAMA sandbox approval before live data is enabled.
- **Sumsub re-submission rate:** 28% of KYC applicants require at least one document resubmission. Target is < 10%. In active remediation this sprint.

## Recent decisions

- **2026-03-10:** Chose Kotlin Multiplatform (KMP) for shared business logic going forward. First module (order validation) shipped. New cross-platform logic must use KMP — no duplicating business rules in Swift and Kotlin separately.
- **2026-03-01:** Deferred margin trading to H2 2026. Regulatory complexity and risk management requirements too significant for current team capacity. Will revisit after Advisory launch.
- **2026-02-20:** Adopted LaunchDarkly for feature flags. All new trading features must be behind a flag for initial rollout. Replaces previous ad-hoc environment variable approach.
- **2026-02-10:** Committed to bi-weekly release train for mobile — iOS and Android ship together. Previous ad-hoc releases caused version fragmentation and support overhead.
