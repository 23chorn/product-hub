# Tech Stack

> **How to use this file:** Copy to `tech-stack.md`, fill in your real details, and delete this note.
> `tech-stack.md` is gitignored — your technical details stay local. This example uses a fictional company.

## Mobile (primary channel)

- **iOS:** Swift / SwiftUI, targeting iOS 16+
- **Android:** Kotlin / Jetpack Compose, targeting Android 10+
- **Shared logic:** Kotlin Multiplatform (KMP) for business logic shared between iOS and Android (portfolio calculations, order validation, data models)
- **State management:** iOS — TCA (The Composable Architecture); Android — MVI with Kotlin Flow
- **Real-time data:** WebSockets for live price feeds and order status updates
- **Localisation:** iOS Localizable.strings / Android strings.xml — English and Arabic (RTL layout supported)

## Backend

- **Runtime:** Node.js 20 LTS with TypeScript
- **Framework:** NestJS — modular architecture with clear domain boundaries (trading, advisory, accounts, notifications)
- **API style:** REST for client-facing APIs; gRPC for internal service-to-service communication
- **Auth:** JWT-based authentication, refresh token rotation. MFA required for trading actions above a threshold value
- **Regulatory data store:** Isolated microservice for audit trail and transaction records — stricter access controls, immutable append-only log

## Data

- **Primary DB:** PostgreSQL 15 on AWS RDS (Multi-AZ, encrypted at rest)
- **Cache:** Redis 7 on ElastiCache — price quote caching (TTL 1s), session state, rate limiting
- **Time-series:** InfluxDB for tick-level market data and price history
- **Search:** OpenSearch for instrument search (by name, ticker, ISIN)
- **Migrations:** Flyway for versioned, auditable schema migrations

## Infrastructure

- **Hosting:** AWS — EKS for backend services, CloudFront for static assets
- **Region:** AWS me-south-1 (Bahrain) primary — data residency requirement for DFSA compliance
- **CI/CD:** GitHub Actions — test, lint, build, deploy. Mobile uses Fastlane for signing and App Store / Play Store submission
- **Environments:** `dev` → `staging` → `production`. All production deploys require two-engineer approval
- **Monitoring:** Datadog APM + RUM (mobile), PagerDuty on-call rotation
- **Security:** AWS KMS for key management, Vault for secrets, all data encrypted in transit (TLS 1.3 minimum)

## Market data and trading infrastructure

- **Market data:** Refinitiv Elektron (primary feed) — real-time quotes for DFM, ADX, Tadawul, US markets
- **Order routing:** FIX protocol gateway to local exchange clearing members
- **KYC / AML:** Sumsub for identity verification; custom AML screening against OFAC/UN/local watchlists
- **Payments / funding:** Network International for UAE card processing; local bank transfer via UAEFTS

## Key integrations

- **DFM / ADX:** Direct exchange connectivity via licensed broker-dealer partner
- **Tadawul (KSA):** In progress — requires SAMA regulatory approval before live connectivity
- **Push notifications:** Firebase Cloud Messaging (Android) + APNs (iOS) — price alerts, order fills, advisor messages
- **Analytics:** Amplitude for product analytics, Braze for lifecycle messaging
- **Customer support:** Intercom — in-app chat with support team
