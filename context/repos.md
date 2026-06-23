---
stages: [solution_architect, story_decomposition, tech_refinement, qa_engineer]
---
# Repository Structure

This document describes the purpose, boundaries, and cross-repo dependencies of each repository in the xCube ecosystem. Agents must reference actual repo names from this file when producing architecture documents, feature plans, and story breakdowns.

> **Source of truth note:** Backend service boundaries (microservice names, controllers, jobs) were extracted directly from `xCube-API`'s solution structure, `CLAUDE.md`, and `xCube_API_Wiki.md`. Client details came from each repo's own `CLAUDE.md` / wiki. Where a repo's documentation was incomplete (e.g. blank `README.md` files in iOS/Android), this file relies on actual source/config inspection instead. Re-validate against the repo if it has moved on significantly from when this file was written.

---

## Web Platform

### `xCube-Web`
**Purpose**: React web trading portal — the primary browser-based client
**Tech**: React 19, TypeScript, Vite 6, TanStack Query + TanStack Table, Zustand, native WebSocket (`react-use-websocket`), shadcn/ui (Radix primitives, "new-york" style), Tailwind CSS v3, i18next (en/ar, Arabic RTL), Highcharts + Recharts, react-hook-form + zod, axios, Sentry (`@sentry/react`)
**Team**: Web Frontend
**Backend is a separate repo** (`xCube-API`) — this repo is frontend-only
**CI/CD**: Not present in this repo (no `azure-pipelines.yml` checked in) — confirm pipeline ownership with DevOps before assuming a deploy mechanism
**Environments**: Dev / SIT / UAT / Prod (per `PROJECT_DOCUMENT.md`); no test runner is configured in the repo

**Configuration pattern** (two-tier, `src/config/env.ts`):
- **Build-time** (`VITE_*` env vars, baked in at build): Sentry DSN/auth token/environment, mobile app QR code URL
- **Deploy-time** (`#{PLACEHOLDER}#` tokens, replaced at deploy): `API_BASE_URL`, `SOCKET_URL` (Dory), chart URL, Zendesk snippet URL, app store URLs, UAE Pass URLs, Omnichannel (MS Dynamics live chat) org/app IDs

**Typical feature scope** (41 feature folders under `src/features/`):
- All user-facing web screens (trading, portfolio, watchlist, account management)
- Client-side state (Zustand with `persist` for auth), server state via TanStack Query (`refetchOnMount`/`refetchOnWindowFocus` disabled by default)
- Real-time market data via the **Dory** feature (`src/features/dory/`) — native WebSocket to `{SOCKET_URL}/streaming/ticks?jwt=<token>`; subscribes with a `{header:{service,messageType,version,messageId}, payload:[{rics,fids}]}` envelope; quotes land in `useDoryStore`. Reconnects on most close codes but **not** on `1008`/`4401`/`4403` (auth failures), to avoid infinite reconnect loops
- REST against `/api/v1` on a configurable `API_BASE_URL` (this is the same Ocelot gateway / Mobile BFF that `xCube-API` exposes — see note below); cookie-based auth (`withCredentials: true`); 401 interceptor triggers logout via the auth store; UAE Pass OAuth sign-in flow
- Monitoring/support integrations: Sentry (error tracking), Zendesk widget, MS Dynamics 365 **Omnichannel** live chat (`OmnichannelChatWidget.tsx`) — both are present and gated by config; do not assume only one is active in a given environment

**⚠️ Known contract gap to flag in stories:** `src/services/endpoints.ts` defines a clean resource-style REST contract (e.g. `/api/v1/Exchanges/{exchange}/instruments`, `/api/v1/Orders`, `/api/v1/watchlists/{id}/items`). The actual `xCube-API` microservices expose **action-style PascalCase routes** instead (e.g. `/api/v1/Order/CreateNewOrder`, `/api/v1/Portfolio/Holdings`, `/api/v1/Wallet/WithdrawalToBankAccount` — see `api-contracts.md`). These almost certainly aren't the same routes reaching the backend directly; there is likely an undocumented mapping layer, or the web client's contract is partly aspirational/ahead of what's wired up (consistent with the Stop-Loss situation below). **Do not assume a web-side endpoint name matches a backend controller route — verify with the backend team or by tracing an actual network call before writing acceptance criteria that depend on a specific path.**

**Trading types currently supported on web** (verified directly against `src/features/trade/`):
- **Order types**: **Market** and **Limit** are live. **Stop-Loss** is further along than "scaffolding": the `OrderType` config registry (`orderTypeConfig.ts`) defines it, and a full `StopLossOrderForm` component is wired into `OrderTypeTabs`' `<TabsContent value="stoploss">`. However, the `<TabsTrigger value="stoploss">` that lets a user actually select that tab is **commented out** — so the feature is implementation-complete but unreachable in the UI. A "ship stop-loss on web" story is likely mostly a UI-trigger + QA task, not new development — verify the backend (`PortfolioService.OrderRequestModel.OrderType = "5"`) and DirectFN OMS path before assuming it's purely a front-end flip.
- **Order sides**: Buy, Sell, Short Sell
- **Instruments**: equities and **futures** (`futures` feature; backend distinguishes `STOCK`/`FUT`/`CFU` instrument types)
- No bracket/OCO orders or explicit time-in-force selector (GTC/GTD/IOC/FOK) in the web UI today, even though the backend `OrderRequestModel` carries `TIFType`, `ExpirationDate`, and day-order flags — these may be hardcoded/defaulted client-side rather than exposed to the user.

**Consumes APIs from**: `xCube-API` (via the gateway, see contract-gap note above)
**Does NOT include**: Mobile code, backend business logic, background jobs

---

## Mobile Platform

### `xCube-iOS-Main`
**Purpose**: Native iOS investment/trading app, UAE market, bilingual (EN/AR)
**Tech**: Swift, **UIKit-based MVVM + Router/Coordinator + Service Layer** (not SwiftUI — there is no SwiftUI usage documented; views are `*ViewController.swift` + `*ViewModel.swift` pairs). Package management is **CocoaPods + Swift Package Manager** (mixed, not SPM-only).
**Team**: iOS Engineering
**Min iOS version**: **17.0** (not 16.0)
**Source control / CI**: Azure DevOps; pipeline triggers on `develop` branch, builds on a macOS pool, archives + uploads to **TestFlight** (not directly to App Store)
**Workspace**: Always open `xCube.xcworkspace`, never the `.xcodeproj` (CocoaPods requirement)

**Module structure** (each a separate framework target):
`xCube` (main app/AppRouter/tab bar), `xCube-Core` (routing, biometrics, security/jailbreak detection, feature flags, deep links, KYC), `xCube-API` (request/response models), `xCube-Networking` (Alamofire-based HTTP client), `xCube-Persistence` (Realm + custom persistence layers — **not Core Data**), `xCube-DesignSystem`, `xCube-Analytics` (wraps CleverTap/Firebase/UXCam/Adjust/AppsFlyer), `xCube-Configuration`, `xCube-Extensions`, `xCube-Explore` (markets/discovery), `xCube-Onboarding`, `xCube-Watchlists`, `xCube-Sockets` (Starscream WebSocket client + Dory), `xCube-OldShit` (legacy third-party wrappers pending removal — avoid adding new code here)

**Environments**: 4 schemes via `.xcconfig` — `xCube-Mock` (no live APIs), `xCube-Dev`, `xCube-Sit` (used by CI), `xCube-Prod`

**Typical feature scope**:
- Native iOS screens/navigation (UIKit, centralised via singleton `AppRouter`)
- Push notification handling — **Firebase Cloud Messaging**, not raw APNs directly (FCM proxies to APNs under the hood)
- Biometric authentication (Face ID / Touch ID) via `BiometricsManager`
- UAE Pass OAuth via a **local CocoaPod** (`LocalPods/UAEPassClient`), custom URL schemes (`xcubeuaepass`, `xCubeUaePassSuccess/Fail`)
- WorldPay payments with 3D Secure via the bundled `CardinalMobile.framework`
- Realm-backed local persistence (legacy usage, per the wiki) plus custom persistence classes (`CustomerPersistence`, `CmsPersistence`, `DevPersistence`)
- SwiftGen-generated, type-safe localized strings (EN/AR) — never hand-edit `Localization+main.swift`

**Consumes APIs from**: `xCube-API`
**Does NOT include**: Android code, backend logic

---

### `xCube-Android-Main`
**Purpose**: Native Android trading app (package `ae.xcube.xcube`), UAE fintech
**Tech**: Kotlin 2.2.21, Java 17, **Jetpack Compose** (new code) with legacy **XML Views + RxJava** isolated in `xcube-old-shit` (migrate when touched, don't add new RxJava), **Dagger Hilt** DI, Kotlin Coroutines + StateFlow
**Team**: Android Engineering
**Min SDK**: **29** (not 26/Android 8.0) | **Target/Compile SDK**: 36
**Build flavors**: `mock`, `dev`, `sit`, `preprod`, `prod`, `live`
**CI**: Azure DevOps, macOS-hosted agent pool, `develop` branch trigger, builds + signs + uploads to **Google Play** (`assembleSitRelease` for SIT)

**Modules (16 total)**: `app` (entry point), `xcube-core` (business logic, deep linking, app update), `xcube-designSystem` (Compose + Material 3 tokens), `xcube-networking` (**Retrofit 3 + OkHttp 5 + Kotlin Serialization** — not a generic "Room/WorkManager" stack), `xcube-extensions`, `xcube-persistence` (**SharedPreferences + DataStore** — no Room), `xcube-configuration` (env config + native CMake/OpenSSL), `xcube-api` (data models/API interfaces), `xcube-onboarding` (auth, UAE Pass, KYC), `xcube-analytics` (Firebase, AppsFlyer, UXCam), `xcube-watchlist` (real-time updates), `xcube-sockets` (WebSocket live data), `xcube-explore` (browse instruments), `xcube-trade` (**in progress**), `xcube-portfolio` (**in progress**), `xcube-old-shit` (legacy)

**⚠️ Feature-parity note**: per the repo's own `CLAUDE.md`, `xcube-trade` and `xcube-portfolio` modules are explicitly marked **in progress**. Don't assume Android has trading/portfolio parity with iOS or web — confirm current state before scoping a "ship to all platforms" story as equal-sized work across clients.

**Typical feature scope**:
- Native Android screens/navigation (Compose)
- Push notifications via Firebase Cloud Messaging
- Biometric auth, UAE Pass, Uqudo KYC
- Real-time data via `xcube-sockets` (WebSocket)
- Native CMake + OpenSSL libs built for `arm64-v8a`, `armeabi-v7a`, `x86_64` (likely request-signing/encryption, mirroring iOS's `RNCryptor`/`API_HEADER_*_KEY` pattern — confirm exact purpose before assuming)
- Branch.io deep linking (`xcube://`), Zendesk support

**Consumes APIs from**: `xCube-API`
**Does NOT include**: iOS code, backend logic

---

## Backend

### `xCube-API`
**Purpose**: Single backend monorepo — **all backend services for xCube live in this one repository.** There are no separate repos for background jobs, market data ingestion, order execution, or shared DTOs; everything below is a folder inside `xCube-API`.
**Tech**: C# / **.NET 7.0**, ASP.NET Core 7.0, Entity Framework Core 6 + Dapper, **SQL Server is the primary database** (one DB per service domain, 10 total), Oracle is used only for legacy CRM data accessed by one job, **Ocelot** API Gateway, Serilog → Elasticsearch/File/SQL Server/Email sinks, Elastic APM, FluentValidation, AutoMapper, Swagger (URL-based versioning, v1–v4 depending on service), Hangfire (NotificationService scheduling only)
**Team**: Backend Engineering
**CI**: Azure DevOps, **self-hosted agent pool** (`pool: name: default`) — pipeline only runs `dotnet build`; no deploy step is checked into this repo. **Deployment target (hosting infra) is not determinable from the repo** — downstream service hostnames follow an on-prem/VM-style convention (`{service}-{env}api.xcube.ae:{port}`, e.g. `mobilebff-uatapi.xcube.ae:5020`), which suggests IIS/VM hosting rather than a container platform, but confirm with DevOps before stating this as fact in a ticket.
**API versioning**: URL-based (`/api/v1/...`, some services have v2–v4)

**Top-level structure**:
```
xCube.API/
├── APIGateway/
│   ├── xCube.APIGateway        — Ocelot gateway: API-key middleware, CORS, Elastic APM
│   └── xCube.Mobile.BFF        — Backend-for-Frontend; aggregates multiple services for mobile; v1-v4; /health UI
├── Services/                   — 14 independent microservices (see table below)
├── Common/xCube.Services.Common — shared logging, config, enums, helpers, integration response handlers
├── Database/                   — SQL Server DB projects (EF migrations), one per service domain
└── Jobs/                       — 15 standalone background-processing console/host apps
```

Every service under `Services/` follows the same 4-project **Clean Architecture** layout: `.API` (controllers/validators/Swagger), `.Core` (business logic/interfaces), `.Infrastructure` (DbContext/repositories/external HTTP clients), `.SharedKernel` (DTOs, no logic). There is **no separate `xcube-shared` NuGet package** — cross-service sharing happens through `Common/xCube.Services.Common`, and each service's own `.SharedKernel` is not shared with other services.

**Microservices**:

| Service | Domain | Key Responsibilities |
|---------|--------|----------------------|
| **AuthService** | Identity | JWT sign-in/refresh, UAE Pass SAML, Uqudo screening |
| **OnboardingService** | KYC / Registration | Registration, document upload/verification, KYC workflow, in-app chat |
| **PortfolioService** | Investments | Order placement/cancel/search, holdings, buying power, portfolio growth, TWR, margin requests |
| **WalletService** | Funds | Deposits (credit card via nGenius, WorldPay 3DS, Central Bank gateway), withdrawals, IBAN/credit card mgmt, bank transfers, cash transfer |
| **MarketDataService** | Market Data | Real-time quotes (DirectFN FIDS/RICS model), watchlists, company info, news, indices, curated lists, charts |
| **NotificationService** | Notifications | OTP (send/verify, incl. TradingView OTP variant), push, SMS, email; Hangfire scheduling |
| **HoldingsService** | Holdings | Shareholding records, exchange transfer notifications |
| **IPOService** | IPO | Offerings, subscriptions, allocations, ADX NIN integration |
| **CMSService** | Content | FAQs, banners, brokerage fees, market timings, complaints, translations, curated lists |
| **CBPaymentService** | Payments | Central Bank payment gateway transaction recording/settlement |
| **CRMService** | CRM | Dynamics 365 sync surface: earnings, activity logs, user records |
| **DFMService** | Discretionary FM | DFM account onboarding, investor management, portfolio management |
| **AdvisorService** | Advisory | Advisor-client relationships, performance, order instructions, CRM |
| **xCubeAccessService** | Access Control | Permissions/access management for advisors/customers |

**Background Jobs** (`Jobs/`, each an `IHostedService` + `PeriodicTimer`):
`xCube.CalculateTWR.Job`, `xCube.PortfolioGrowthCache.Job`, `xCube.RebateCalculation.Job` (Islamic margin rebates, reads Oracle CRM), `xCube.CustomerHoldings.Job`, `xCube.CompanyDetails.Job`, `xCube.CentralBank.Job`, `xCube.AdxNinAndIpoSubscription.Job`, `NewsAndMarketData.Job` (fetches DirectFN/ADX data, **OpenAI** summarises news), `xCube.DynamicCRM.SyncJob` (hourly), `xCube.DynamicCRM.ActivityJob`, `xCube.Flagright.OnboardingJob` / `.OrderJob` / `.DepositAndWithdrawalJob` (AML sync), `xCube.Ticket.Job` (Zendesk), `Shuaa.WelcomeUsers.Job` (brand-specific onboarding)

**Does NOT include**: Nothing is split out — there is no separate "workers", "market-data", "execution-gateway", "shared", "design-system", or "infrastructure" repo for this product. If you're tempted to recommend "add a new repo," check the Decision Guidelines below first — the existing pattern is to add a new microservice/job folder to this monorepo instead.

---

## Decision Guidelines

### Which part of `xCube-API` does a feature touch?

**New REST behaviour for an existing domain** → add a controller/endpoint to the relevant service's `.API` project (e.g. a new order query → `PortfolioService`), plus DTOs in that service's `.SharedKernel`. Do not create a new microservice for this.

**New scheduled/batch behaviour** → add a new project under `Jobs/`, following the existing `IHostedService` + `PeriodicTimer` pattern, registered via the same DI extension-method convention as services.

**Cross-service shared logic** (logging, enums, helpers) → `Common/xCube.Services.Common`. Do not duplicate logic already there.

**Mobile-specific aggregation** (combining calls from 2+ services into one response) → `APIGateway/xCube.Mobile.BFF`.

### When does a feature touch multiple repos?

**Client-only feature** (e.g. watchlist layout change, re-arranging an existing screen): the relevant client repo only — `xCube-Web`, `xCube-iOS-Main`, or `xCube-Android-Main`.

**New backend capability surfaced on one client**: `xCube-API` (new controller endpoint(s) + DB migration in the relevant service) + the one client repo.

**Cross-platform feature** (e.g. a new alert type on web, iOS, and Android): `xCube-API` (endpoint + any new job) + all three client repos. Check the Android module list first — if it touches trading or portfolio, Android may already be behind (see `xcube-trade`/`xcube-portfolio` "in progress" note above).

**Order-flow feature** (new order type, new TIF): `PortfolioService` (validation, `OrderRequestModel`/`OrderType` enum) in `xCube-API`, plus each client's order-entry UI. Remember DirectFN (the actual execution venue) sits behind `PortfolioService`/`MarketDataService` — there is no separate execution-gateway repo to touch.

**Market data feature** (new instrument type, new exchange): `MarketDataService` (FIDS/RICS mapping, DirectFN integration) in `xCube-API`; clients consume via the gateway REST endpoints and/or the Dory WebSocket feed.

### When to create a new microservice (folder) under `Services/`?

**Create one if**: the capability is a genuinely new bounded business domain (the existing 14 services are already organised this way — one per domain, not per feature) and would otherwise force unrelated logic into an existing service's `.Core`.

**Do NOT create one if**: it's new endpoints for an existing domain (add to that service), a new background job (add to `Jobs/`), or a shared helper (add to `Common/xCube.Services.Common`).

---

## Cross-Repo Contracts

### API Contracts
- **Owned by**: Backend team, defined per-service in each `.SharedKernel` project (request/response models) — there is no single shared contract package consumed by clients.
- **How shared**: No generated client / OpenAPI-to-TypeScript pipeline observed. Each client (web, iOS, Android) maintains its **own** hand-written request/response types that must be kept in sync manually with the backend's `.SharedKernel` models. This is a manual-sync risk — flag it in stories that change a request/response shape, since three separate client codebases need the same update.
- **Breaking changes**: Backend uses URL-based versioning (`/api/v1` → `/api/v2`, etc.) per-service; not all services are on the same version.

### Database Schema
- **Owned by**: Backend team, EF Core migrations live inside each service's `.Infrastructure` project; one SQL Server database per service domain (see `xCube_Database_Schemas.md` in `xCube-API` for full table definitions).
- **Shared by**: Only `xCube-API` touches these databases directly (services + jobs in the same repo/process boundary). No client repo has direct DB access.

### Real-time Data (Dory)
- **Publisher**: `MarketDataService` / DirectFN feed, exposed over a WebSocket (`/streaming/ticks?jwt=<token>`) that web (`react-use-websocket`) and the mobile apps (Starscream on iOS, a WebSocket client in `xcube-sockets` on Android) all connect to independently.
- **Message envelope**: `{ header: { service, messageType, version, messageId }, payload: [...] }`; `messageType` includes `snapshot`/`update`. Subscriptions reference RICs (instrument identifiers) and FIDs (field identifiers) — DirectFN's data model, not a custom xCube schema.

### CRM / AML / Compliance sync
- `xCube.DynamicCRM.SyncJob` / `.ActivityJob` push customer, wallet, and CMS data to Microsoft Dynamics 365 hourly + on activity events.
- Three Flagright jobs (`OnboardingJob`, `OrderJob`, `DepositAndWithdrawalJob`) push AML-relevant events from Onboarding, Portfolio, and Wallet data respectively. These are one-way syncs (xCube → external system); there's no documented webhook callback path back into xCube-API from Flagright.

---

## Repository Index

| Repo | Team | Language | CI | Notes |
|------|------|----------|----|-------|
| `xCube-Web` | Web Frontend | TypeScript / React 19 | Not present in repo | No backend code; calls `xCube-API` over `/api/v1` |
| `xCube-iOS-Main` | iOS Engineering | Swift / UIKit (MVVM+Router) | Azure DevOps → TestFlight | Not SwiftUI; Realm not Core Data |
| `xCube-Android-Main` | Android Engineering | Kotlin / Jetpack Compose | Azure DevOps → Google Play | Trade & Portfolio modules marked "in progress" |
| `xCube-API` | Backend | C# / .NET 7.0 | Azure DevOps (self-hosted pool, build only) | Single monorepo: 14 microservices + Ocelot gateway + Mobile BFF + 15 jobs |
