---
stages: [solution_architect, story_decomposition, tech_refinement, qa_engineer]
---
# External Integrations

> **Source of truth note:** Found by reading the actual `Infrastructure/Integrations/*.cs` classes, job folders, and client SDK manifests (`package.json`, `Podfile`, SPM packages, Gradle modules) across all four repos — not from the `ConfigFiles/*.json` files themselves, which hold real per-environment settings and are **not checked into git** (no secrets were read or are reproduced here). Where a detail like a rate limit, SLA, or pricing tier isn't in the code, it's marked as **not documented in the repo** rather than guessed — treat any such gap as a question for the integration owner, not a fact to assume in a story.

**Shared infrastructure for all backend integrations:** Every `xCube-API` external HTTP integration goes through a common `HttpHelper` (`Common/xCube.Services.Common/Helpers/HttpHelper.cs`) that applies the same config-driven retry policy to all of them — `CommonSettings:ExternalHttpConnectivity:MaximumRetryRequests` and `RequestRetryInterval` (a fixed interval, not exponential backoff; no Polly/circuit-breaker library is used). Unless an integration below says otherwise, assume it inherits this generic retry behavior rather than a bespoke one. The **iVestor** integration is a deliberate exception: query params and headers are RNCryptor-encrypted before being sent (`DataProtector.EncryptString_Rncrytp`), which no other integration does.

---

## Market Data — DirectFN (DFN)

**What it does:** Primary real-time and reference market-data feed (quotes, indices, time series) and the brokerage's order-routing/execution venue (OMS). This is not just a quote feed — order statuses returned by `PortfolioService` (see `OrderStatus_Reference.md`) are DirectFN's own status codes, not an xCube-invented enum.
**Owner**: `MarketDataService` (quotes/data) and `PortfolioService` (orders) in `xCube-API`; config in `DFNApiConfiguration.json`.
**Data model:** RIC (instrument identifier) + FID (field identifier) pairs — see `FIDS`/`RICS` tables in `xCube_Database_Schemas.md`. Adding a new displayed field is normally "map another FID," not "add a column."
**Real-time delivery to clients**: via the **Dory** WebSocket (`wss://.../streaming/ticks?jwt=...`), authenticated by a token from `MarketDataService`'s `DoryAuthController`. See `api-contracts.md` for the message envelope.
**Constraints**: `authSts` returned during sign-in (`29` = pending, `1` = success, `0` = bad credentials) originates from DirectFN — auth and brokerage account state are intertwined with this vendor, not purely an xCube concept.

---

## Identity Verification (KYC) — Uqudo

**What it does:** Identity document scanning / liveness / background screening during onboarding.
**Owner**: `AuthService` and `OnboardingService` both expose a `UqudoController`; config in `UqudoApiConfiguration.json`.
**Flow** (from the actual controller, `AddScreeningResult` + `GetToken`):
1. Backend calls `GET /Uqudo/GetToken` to obtain a session token
2. Mobile/web embeds the Uqudo SDK using that token for the user-facing capture flow
3. Result is pushed back to xCube via `POST /Uqudo/AddScreeningResult`, stored as `tbl_UqudoScreening` (per `xCube_Database_Schemas.md`)

Client SDKs confirmed present: iOS (`UqudoResources/` bundle in `xCube-iOS-Main`) and Android (`Uqudo` listed under Android's "Key Tech"). Not confirmed whether the web client has a Uqudo flow — check before assuming KYC re-verification works the same way on web.

---

## National Digital Identity — UAE Pass

**What it does:** UAE national identity sign-in / digital ID data sharing.
**Owner**: `AuthService` (`UAEPassController` + `SignInWithUAEPass` on `AuthManagementController`); `OnboardingService` has an equivalent during registration.

**⚠️ Two different integration shapes were found — don't assume they're the same flow:**
- **Web** (`src/config/env.ts`): treats UAE Pass as a classic **OAuth2 authorization-code flow** — `UAE_PASS_AUTHORIZE_URL`, `UAE_PASS_TOKEN_URL`, `UAE_PASS_USER_INFO_URL` are all deploy-time config.
- **Backend** (`AuthService.UAEPassController`): exposes a **presentation-exchange** pattern instead — `request-presentation` → `receive-presentation` (callback) → `receive-visualization` → `reject-notification` / `presentation-data` (poll for result). This looks like UAE Pass's digital-ID-card / verifiable-credential presentation API, distinct from a basic login redirect.
- **iOS** uses a **local CocoaPod** (`LocalPods/UAEPassClient`) with custom URL schemes (`xcubeuaepass`, `xCubeUaePassSuccess`/`xCubeUaePassFail`).

These may be two legitimately different uses (OAuth login vs. a separate Emirates-ID-data pull during KYC) rather than a contradiction — but don't write a story that assumes "the UAE Pass integration" is one single flow shared identically by all three clients without confirming which pattern the target client/screen actually uses.

---

## KYC Document Storage — DigitalVault

**What it does:** Storage for KYC documents collected during onboarding.
**Owner**: `AuthService`/`OnboardingService`; config in `DigitalVaultConfiguration.json`. Response models exist under `ResponseModels/DigitalVaultResponses` in `AuthService.SharedKernel`.
**Constraints**: Not documented further in the repo beyond its existence as a config file and response model namespace — treat any claim about its retention policy, supported file types, or SLA as unverified until confirmed with the integration owner.

---

## AML / Compliance — Flagright

**What it does:** Transaction monitoring and AML screening.
**Owner**: Three dedicated background jobs in `xCube-API/Jobs/` — `xCube.Flagright.OnboardingJob`, `xCube.Flagright.OrderJob`, `xCube.Flagright.DepositAndWithdrawalJob` — each with their own `FlagrightIntegration.cs`. Config in `FlagrightConfiguration.json` (per-job, under `FlagrightIntegration:Endpoints:*`).
**Auth**: Basic Authentication (`enableBasicAuthentication: true` on every call through the shared `HttpHelper`).
**Key operations observed**: `ConsumerUser` (create + retrieve user), `Transactions` (create), `TransactionEvent` (update) — REST, JSON.
**Direction**: One-way (xCube → Flagright). No webhook/callback path back into `xCube-API` was found — if a story needs Flagright to notify xCube of a screening outcome, that's new work, not an existing contract.
**Constraints**: `xCube.RebateCalculation.Job` separately reads a **legacy Oracle CRM** database — don't confuse that with the Flagright jobs; they're unrelated data paths that happen to both be "compliance-adjacent."

---

## Payments — nGenius (primary card rail)

**What it does:** Card payment processing for wallet deposits.
**Owner**: `WalletService` (`CreditCardIntegration.cs`, `CreditCardController`); config under `ngeniusintegration:endpoints:*` (`NGeniusConfiguration.json`).
**Auth flow** (from code): `POST {Authentication endpoint}` with Basic Auth and `Accept: application/vnd.ni-identity.v1+json` → returns an access token (`AccessTokenResponse`) → subsequent calls (e.g. `GetOrderStatus`) use that token as a Bearer token, not Basic Auth.
**Constraints**: Not documented in-repo: minimum/maximum deposit amounts, settlement timing, or pricing tier. Don't invent these for a story — confirm with Finance/the WalletService owner.

## Payments — WorldPay (alternative card rail, 3DS)

**What it does:** Alternative card payment processing with 3D Secure authentication.
**Owner**: `WalletService` (`WorldPayIntegration.cs`); config under `WorldPayConfiguration:EndPoints:*`. On iOS, 3DS device fingerprinting/challenge UI is handled by the bundled `CardinalMobile.framework`.
**Auth**: Basic Authentication on every call.
**Distinctive detail**: WorldPay's API is HAL+JSON with versioned vendor media types per operation — `application/vnd.worldpay.verified-tokens-v3.hal+json` (tokenization), `application/vnd.worldpay.verifications.customers-v3.hal+json` (3DS device data/auth/challenge), `application/vnd.worldpay.payments-v7+json` (payment submission). If a story touches WorldPay, the `Accept`/`Content-Type` value matters and is operation-specific — check `WorldPayIntegration.cs` for the exact one rather than reusing one from another endpoint.
**Flow**: create token → 3DS device data collection → 3DS authentication → challenge verification (if challenge required) → payment.

## Payments — Central Bank Payment Gateway

**What it does:** A third, separate deposit path distinct from both card rails above.
**Owner**: `CBPaymentService` (`CBPaymentGatewayController`) calls back into `WalletService.MakeDepositDFN` after recording the transaction. Currency is hardcoded to `AED` in this path (`CurrencyCode = "AED"` in `UpdatePaymentGatewayInfo`).
**Constraints**: Don't assume this rail supports multi-currency just because the other two might — it's explicitly AED-only in the code as written.

---

## CRM — Microsoft Dynamics 365

**What it does:** Customer record sync, activity logging, earnings.
**Owner**: `CRMService` (`xCube-API`) for the API surface; `xCube.DynamicCRM.SyncJob` (hourly — customers, wallets, CMS data) and `xCube.DynamicCRM.ActivityJob` (event-driven activity logging) for the sync itself. Config in `DynamicCRMConfiguration.json`. A `MicrosoftDynamicsCRMMiddleware` also exists in `Common/xCube.Services.Common/Filters`.
**Used by**: AuthService, OnboardingService, WalletService, NotificationService, AdvisorService, CRMService (per `xCube_API_Wiki.md`) — this is one of the most widely depended-on integrations; a Dynamics outage or schema change has a wide blast radius across services.
**Direction**: xCube → Dynamics (sync jobs push data out). No evidence of Dynamics calling back into xCube-API.

**Separately, on web**: MS Dynamics 365 **Omnichannel** live chat widget (`OmnichannelChatWidget.tsx`) is a *different* Dynamics surface (customer service chat, not the CRM sync above) — loaded via a script tag with `data-org-id`/`data-org-url`/`data-app-id`, with an auth-token provider callback and a hardcoded fallback script URL if the primary CDN fails. Don't conflate "Dynamics CRM sync" (backend jobs) with "Dynamics Omnichannel chat" (web widget) — they're both Microsoft Dynamics products but serve unrelated purposes here.

---

## Support — Zendesk

**What it does:** Support ticket creation/management, in-app help.
**Owner (backend)**: `xCube.Ticket.Job` (`TicketIntegration.cs`); config in `ZendeskConfiguration.json` (`ZendeskConfig:BaseURL`, `ZendeskConfig:EndPoints:*`, `ZendeskConfig:Credential:UserName`/`Password`).
**Auth**: Basic Authentication — ticket creation goes through the shared `HttpHelper` (inherits the generic retry policy); **attachment upload bypasses that helper** and opens its own raw `HttpClient` with a manually-built Basic Auth header. If a story touches attachment upload specifically, know that it doesn't get the same retry behavior as the rest of the integration.
**Owner (clients)**:
- **Web**: a `ZendeskChatButton` widget AND a separate `OmnichannelChatWidget` both exist in `floating-chat-button/` — both Zendesk and MS Dynamics Omnichannel live-chat surfaces are present in the codebase. Confirm which is actually enabled in a given environment before assuming "the chat widget" means Zendesk.
- **iOS**: three Zendesk SPM packages — `ZendeskAnswerBotSDK`, `ZendeskChatSDK`, `ZendeskSupportSDK`.
- **Android**: Zendesk listed under "Support" in the module's key tech.

---

## IBAN Validation — IBAN Checker API

**What it does:** Validates IBANs entered for withdrawal/bank-transfer flows.
**Owner**: `WalletService` (`POST /Wallet/ValidateIBAN`); config in `IBANCheckerAPIConfiguration.json`.
**Constraints**: No further detail (rate limits, supported countries) found in-repo — confirm with WalletService's owner before estimating related work.

---

## Investor Data — iVestor

**What it does:** A separate investor-data feed/withdrawal target — `WalletService` has a distinct `WithdrawalToiVestor` endpoint alongside the standard bank withdrawal path; config in `IVestorApiConfiguration.json`.
**Distinctive detail**: this is the **only** integration where the shared `HttpHelper` encrypts query parameters and headers (RNCryptor) before sending — every other integration sends plaintext params/headers (over HTTPS). If a story touches iVestor request/response shapes, expect an extra encrypt/decrypt step that other integrations don't have.

---

## Exchange Data — ADX (Abu Dhabi Exchange)

**What it does:** ADX-specific NIN (National Investor Number) and IPO subscription data.
**Owner**: `xCube.AdxNinAndIpoSubscription.Job`; config in `AdxConfiguration.json`. Uses a dedicated header, `adx-Gateway-APIKey` (`HeaderParamsConstants.AdxSubscriptionKey`) — i.e. API-key-in-header auth, distinct from the Basic Auth pattern most other integrations use.

---

## AI — OpenAI

**What it does:** Summarises market news.
**Owner**: `NewsAndMarketData.Job`, via the `Betalgo.OpenAI` .NET SDK (`OpenAI.Extensions` namespace). Config is inline in the job, not a separate `*Configuration.json` file referenced elsewhere.
**Constraints**: Model choice, prompt content, and token/cost limits are not visible from the job's `Program.cs` alone — read `NewsAndMarketData.Job`'s service classes directly if a story changes summarisation behaviour, rather than assuming a specific model.

---

## Monitoring — Sentry, Elastic Stack

- **Sentry** (`@sentry/react`, `@sentry/vite-plugin`) — web client only, confirmed in `package.json` and `src/lib/sentry.ts`. DSN/environment are build-time `VITE_*` env vars. The Dory WebSocket hook explicitly reports unexpected close/error events to Sentry (`captureSentryException`) — this is the one piece of client-side error reporting verified to be wired up end-to-end.
- **Elastic Stack (ELK)** — backend-wide via Serilog. Every service and job writes to Elasticsearch (primary sink), with File/SQL Server/Email as fallback sinks (`Common/xCube.Services.Common/Logging`). Index naming is `{service-or-job-name}_{yyyy-MM}`. Don't assume mobile client crash data lands here — mobile crash reporting is Firebase Crashlytics, a separate system (see below).
- **Elastic APM** — request tracing, instrumented in the Ocelot gateway and Mobile BFF only (not inside individual microservices, per the wiki).

---

## Mobile Analytics & Attribution (iOS + Android)

Both native clients ship a near-identical stack — verified independently from each repo's dependency manifest, not assumed by symmetry:

| Provider | Purpose | iOS (SPM/CocoaPods) | Android (Gradle) |
|---|---|---|---|
| **CleverTap** | CRM / lifecycle event tracking | ✅ (event registry: `xCube_CleverTap_Events.csv`) | ✅ (`xcube-analytics` module) |
| **Firebase** | Analytics, Crashlytics, Cloud Messaging (push), Firestore | ✅ `FirebaseAnalytics`/`Core`/`Crashlytics`/`Messaging`/`Firestore` | ✅ Analytics, Crashlytics, FCM, Firestore |
| **AppsFlyer** | Install/campaign attribution | ✅ | ✅ |
| **Adjust** | Install & re-engagement attribution | ✅ (`ADJUST_KEY` config) | Not confirmed — only AppsFlyer/UXCam listed in Android's own tech notes; verify before assuming parity |
| **UXCam** | Session replay / UX analytics | ✅ | ✅ |
| **Branch.io** | Deep linking (`xcube://`, `applinks:56kgg.app.link`) | ✅ | ✅ |
| **Facebook SDK** | Attribution / login surface | ✅ (`FacebookCore`, `FACEBOOK_APP_ID`) | ✅ (listed under Auth) |

**CleverTap event registry**: `xCube-iOS-Main/xCube_CleverTap_Events.csv` documents the actual event taxonomy (e.g. `screen_view` fires automatically on every screen with a `screen_name` property; named screens include the full auth/onboarding funnel — `screen_splash`, `screen_initial_language_selection`, `screen_signing_in`, `screen_otp_verification`, `screen_otp_temporary_block`, `screen_otp_permanent_block`, `screen_biometrics`, etc.). Use this file directly when a story needs a specific event name or property — don't invent an event name by analogy to a generic mobile-analytics pattern.

**Compliance/consent (iOS-specific, not confirmed on Android)**: `UsercentricsUI` (GDPR/consent management) and Apple's `AppTrackingTransparency` (ATT prompt, iOS 14+) are both present on iOS. No equivalent consent-management SDK was found in the Android module list — if a story requires consent-gating analytics on both platforms equally, that's a gap to flag, not an assumption to make.

**Web has no equivalent stack** — no CleverTap/AppsFlyer/Adjust/UXCam/Branch.io found in `xCube-Web`'s `package.json`. Web's only analytics-adjacent dependency is Sentry (error tracking, not product analytics). If a story asks to "track this event the same way mobile does," there is currently no web analytics SDK to do that with — that's new infrastructure, not a wiring task.

---

## Integration Ownership Summary

| Integration | Owner (repo / job / service) | Auth | Notes |
|---|---|---|---|
| DirectFN (DFN) | `MarketDataService`, `PortfolioService` | — | Quotes + order execution + order status codes |
| Uqudo | `AuthService`, `OnboardingService` | Session token | KYC document/liveness screening |
| UAE Pass | `AuthService` (+web/iOS as above) | OAuth2 (web) / presentation exchange (backend) / local pod (iOS) | Two distinct flow shapes — verify which applies |
| DigitalVault | `AuthService`/`OnboardingService` | Not documented | KYC document storage |
| Flagright | 3 jobs in `Jobs/` | Basic Auth | One-way AML sync, no callback |
| nGenius | `WalletService` | Basic Auth → Bearer token | Primary card deposit rail |
| WorldPay | `WalletService` (+ iOS `CardinalMobile.framework`) | Basic Auth | Alternative card rail, 3DS, versioned HAL+JSON media types |
| Central Bank Payment Gateway | `CBPaymentService` | Not documented | AED-only deposit path |
| Dynamics 365 (CRM sync) | `CRMService` + 2 sync jobs | Not documented | Used by 6 services |
| Dynamics 365 Omnichannel (chat) | `xCube-Web` | Auth-token provider callback | Different product surface than CRM sync |
| Zendesk | `xCube.Ticket.Job` + all 3 clients | Basic Auth | Attachment upload bypasses shared retry helper |
| IBAN Checker API | `WalletService` | Not documented | — |
| iVestor | `WalletService` | Not documented | Only integration with RNCryptor-encrypted params/headers |
| ADX | `xCube.AdxNinAndIpoSubscription.Job` | API key header (`adx-Gateway-APIKey`) | — |
| OpenAI | `NewsAndMarketData.Job` | Not documented | News summarisation only |
| Sentry | `xCube-Web` | DSN | Web only — no mobile equivalent confirmed |
| CleverTap / Firebase / AppsFlyer / UXCam / Branch.io / Facebook | `xCube-iOS-Main`, `xCube-Android-Main` | Per-SDK | Not present on web |
