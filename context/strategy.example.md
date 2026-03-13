# Product Strategy

> **How to use this file:** Copy to `strategy.md`, fill in your real details, and delete this note.
> `strategy.md` is gitignored — your strategy stays local. This example uses a fictional company.

## North star

Become the most trusted retail investment platform in the GCC — the app every individual investor in the region uses to grow their wealth.

## Current period: Q1–Q2 2026

### OKRs

**O1 — Establish a complete, reliable core brokerage experience in the UAE**
- KR1: Reduce order execution failure rate to < 0.5% (currently 2.1%)
- KR2: Achieve 4.5+ App Store rating (currently 3.9 — driven by execution and onboarding complaints)
- KR3: KYC completion rate from sign-up to first funded account reaches 65% (currently 48%)

**O2 — Launch Baraka Advisory MVP with first cohort of advisors**
- KR1: Onboard 10 licensed advisors onto the platform
- KR2: 500 client subscriptions to an advisor model portfolio within 60 days of launch
- KR3: Advisor NPS ≥ 40 (advisors are the supply side — their experience determines quality of the product)

**O3 — Lay the technical and regulatory foundation for KSA expansion**
- KR1: SAMA sandbox approval received
- KR2: Multi-market architecture spike complete — app can support a second market without a full rebuild
- KR3: Arabic localisation coverage at 100% for all core trading flows

### Roadmap themes this period

1. **Core brokerage quality** — order management reliability, real-time price data accuracy, portfolio P&L correctness
2. **Onboarding and KYC** — reduce drop-off in the identity verification and account funding flow
3. **Baraka Advisory launch** — advisor onboarding portal, model portfolio publishing, client subscription and follow flows
4. **Market expansion foundations** — multi-currency support, multi-market data feeds, regulatory data segregation

## Explicit non-priorities (Q1–Q2)

- Crypto trading — regulatory complexity in the GCC; not in scope until core equity product is stable
- US options or margin trading — risk profile inappropriate for our current retail user base
- Web platform feature parity — mobile is the primary channel; web is secondary and maintained but not being expanded this half
- GCC market expansion beyond UAE (other than regulatory groundwork) — premature until UAE product quality OKRs are met

## Constraints

- DFSA compliance requirements constrain how we store, process, and transmit financial data — any new data category requires legal sign-off
- iOS and Android must ship simultaneously — no platform-first releases
- All trading flows must support both English and Arabic — design and copy must be reviewed by native Arabic speaker before release
- Advisor regulatory compliance (DFSA Cat 4 licence conditions) limits the language and format of any content advisors publish on the platform
