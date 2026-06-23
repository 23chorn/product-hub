# Tech Stack

> **Source of truth note:** Corrected against actual repo contents (`package.json`, `.csproj`/`CLAUDE.md`/wiki files, controller/integration source) in `xCube-Web`, `xCube-iOS-Main`, `xCube-Android-Main`, `xCube-API`. Items flagged with ⚠️ are either factual corrections or things not found in any of the 4 repos — verify those with the relevant owner before treating them as settled in a ticket.

## Frontend

- **Web:** React **19** (not 18 — `package.json` pins `^19.1.0`), TypeScript, Vite 6
- **iOS:** Swift — ⚠️ **UIKit + MVVM/Router**, not SwiftUI. Views are `*ViewController.swift` + `*ViewModel.swift` pairs; there's no SwiftUI usage in the repo. Don't scope iOS UI work assuming SwiftUI patterns.
- **Android:** Kotlin, **Jetpack Compose** for new code; legacy XML Views + RxJava isolated in the `xcube-old-shit` module (migrate when touched, don't extend)

## Backend

- **Runtime:** .NET **7.0** (not a later/unspecified version)
- **Framework:** ASP.NET Core 7.0 — ⚠️ this is **one monorepo** (`xCube-API`), not a single monolithic API: 14 independent microservices sit behind an Ocelot API Gateway + a Mobile BFF, each with its own database
- **API style:** REST — versioned at `/api/v1/*` as the floor, but not uniformly: some services (`PortfolioService`, `NotificationService`, `WalletService`, the Mobile BFF) go up to v2–v4. Don't assume every endpoint is v1.

## Data

- **Primary DB:** **SQL Server** — one database per service domain (10 total)
- **Secondary:** **Oracle** — ⚠️ legacy CRM data only, read by a single background job (`xCube.RebateCalculation.Job`). It is not a primary transactional store; the original ordering ("Oracle, SQL Server") overstates Oracle's role.

## Infrastructure

- **Hosting:** ⚠️ **AWS was not confirmed** — no AWS resources, ECS/ALB config, or Terraform were found in any of the 4 repos. The backend CI pipeline builds on a **self-hosted Azure DevOps agent pool** (`pool: name: default`), and downstream service hostnames follow an on-prem/VM naming convention (`{service}-{env}api.xcube.ae:{port}`), which points away from a managed container platform. Confirm the actual hosting target with DevOps before stating "AWS" in a ticket.
- **CI/CD:** Azure DevOps — `xCube-API` pipelines build only (no deploy step checked in); iOS/Android build on macOS-hosted agents and ship to TestFlight / Google Play respectively; `xCube-Web` has no pipeline file checked into the repo at all.
- **Environments:** "UAT, Prod" understates what each repo actually defines — `xCube-Web` lists Dev/SIT/UAT/Prod; iOS schemes are Mock/Dev/Sit/Prod; Android flavors are mock/dev/sit/preprod/prod/live. Confirm which environment a story actually targets rather than assuming just two exist.
- **Monitoring:** Elastic Stack (Serilog → Elasticsearch primary sink, File/SQL Server/Email fallback; Elastic APM on the gateway/BFF only) covers the backend. Client-side monitoring is separate: **Sentry** on web only, **Firebase Crashlytics** on iOS/Android — "Elastic" alone doesn't cover client crash/error tracking.

## Key integrations

- **Market Execution engine:** DirectFN (DFN) — also the source of the order-status codes returned by `PortfolioService` (~50 distinct states, see `OrderStatus_Reference.md`), not just trade execution.
- **Market Data / real-time streaming:** Dory — WebSocket tick distribution (`/streaming/ticks?jwt=<token>`), consumed independently by web, iOS, and Android, keyed by DirectFN's RIC/FID identifiers. Whether "Dory" is a distinct vendor or a service built on top of DirectFN isn't fully resolvable from the code — confirm before describing it as an independent data provider in a story.
- **Payments:** ⚠️ **WorldPay is not the only (or primary) rail.** `WalletService` integrates with **nGenius** (Basic Auth → Bearer token; the primary card-deposit rail) and **WorldPay** (alternative rail, 3D Secure via `CardinalMobile.framework` on iOS) side by side, plus a third path through **Central Bank Payment Gateway** (`CBPaymentService`, AED-only). If a payments story only mentions WorldPay, double check which rail it actually needs.
- **Banking / Deposits:** Emirates NBD Virtual IBAN API — commercial agreement complete, API docs received, sandbox integration not yet started (pending discovery spike). Not present in any repo yet, which is consistent with "not yet started" — no correction needed here.
- **Analytics:** Google Analytics, AppsFlyer, Braze (marketing engagement — remains active) — ⚠️ **Braze and Google Analytics were not found in any of the 4 repos' dependency manifests** (no SDK/pod/Gradle reference, no source mentions). AppsFlyer is confirmed in both iOS and Android. If Braze/GA are genuinely active, they're most likely server-side or marketing-tool-side integrations outside these four codebases — don't assume there's client SDK work involved unless that's confirmed with whoever owns the marketing stack.
- **Product Analytics (incoming):** CleverTap — ⚠️ **likely further along than "not yet started."** `xCube-iOS-Main` already ships a complete CleverTap event registry (`xCube_CleverTap_Events.csv`, covering the full auth/onboarding screen-view funnel) and an `xCube-Analytics` module that wraps CleverTap directly alongside Firebase/UXCam/Adjust/AppsFlyer. Android's `xcube-analytics` module exists, but its `CLAUDE.md` only explicitly names Firebase/AppsFlyer/UXCam — CleverTap's status there is unconfirmed. Before scoping a "CleverTap integration" story as net-new work, reconcile the commercial contract status against this code-level state — iOS in particular may need a fraction of the work Android does.
