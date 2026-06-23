---
stages: [solution_architect, story_decomposition, tech_refinement, qa_engineer]
---
# API Contracts

> **Source of truth note:** Every endpoint, header, and request/response field below was read directly from `xCube-API`'s controllers and `.SharedKernel` request/response model files (not from Swagger output or external docs), since that repo's own wiki documents architecture but not full payload shapes. Field names/casing are copied verbatim from the C# models. This is **not exhaustive** — it covers the services agents are most likely to touch when writing stories or acceptance criteria (Auth, Orders, Portfolio, Wallet, Notifications/OTP, Market Data). For anything not listed here, find the matching `.API/Controllers/*.cs` file in `xCube-API` and read it directly — do not guess a route name by analogy to a fictional REST pattern.

## Base URL & Service Boundaries

There is **no single base URL** — `xCube-API` is 14 separate microservices sitting behind an Ocelot gateway (`xCube.APIGateway`) and a Mobile BFF (`xCube.Mobile.BFF`). Per the gateway's `ocelot.json` (documented in `xCube_API_Wiki.md`):

| Route group | Downstream target |
|---|---|
| CRM routes | `crm-uatapi.xcube.ae:5030` |
| Chat public-key | `onboarding-uatapi.xcube.ae:5125` |
| Everything else (mobile) | `mobilebff-uatapi.xcube.ae:5020` (wildcard fallback) |

Routes below are written as `{service}/api/v{n}/{Controller}/{Action}` — the path each microservice's own Swagger doc would show. **The web client's `endpoints.ts` does not use these exact paths** (see the contract-gap note in `repos.md`) — treat the routes below as the backend's actual contract, and verify separately which gateway path a given client uses to reach them before writing FE-specific acceptance criteria.

All controllers route-prefix with `[Route("api/v{version:apiVersion}/[controller]")]` or a fixed `api/v1/[controller]`; actions are then `[HttpPost]`/`[HttpGet]` + `[Route("ActionName")]` — i.e. **action-style PascalCase paths**, not resource-style REST (`POST /Order/CreateNewOrder`, not `POST /orders`).

---

## Standard Request Headers

Defined in `Common/xCube.Services.Common/Constants/HeaderParamsConstants.cs` — these are available platform-wide, though individual controllers only read the ones they need:

| Header | Constant | Purpose |
|---|---|---|
| `x-token` | `Token` | JWT access token |
| `x-refresh-token` | `RefreshToken` | Refresh token |
| `x-preferred-lang` | `PreferredLanguage` | `EN` / `AR` — drives localized validation/error messages |
| `x-channel` | `Channel` | Client identifier; gateway sets this, default fallback in code is `"xCube"` |
| `x-correlation-id` | `CorrelationId` | Request tracing; auto-generated if absent |
| `x-customer-id` | `CustomerId` | — |
| `x-email-id` / `x-mobile-number` / `x-customer-name` | — | Used by some onboarding/notification endpoints in lieu of a resolved customer ID |
| `x-client-ip` | `ClientIp` | — |
| `x-device-uuid` / `x-device-info` / `x-device-os` / `x-device-os-version` / `x-device-name` / `x-device-model` | — | Device fingerprinting, used in auth/security flows |
| `x-app-version` / `x-app-build` | — | Client version reporting |
| `adx-Gateway-APIKey` | `AdxSubscriptionKey` | ADX (Abu Dhabi Exchange) integration only |

**⚠️ Quirk to verify before relying on it**: `PortfolioService`, `WalletService`, and `IPOService` each define their own `HeaderParameters` class with a single `TradeToken` property. Controllers bind it as `[FromQuery] HeaderParameters headerParameters`, but the `TradeToken` property itself carries a `[FromHeader]` attribute. The naming strongly implies it's meant to travel as a header despite the parameter-level `[FromQuery]` attribute — but don't assume which one wins without testing against a running instance; flag this for the backend team if a story depends on exactly how `TradeToken` is transmitted.

---

## Authentication & Onboarding — `AuthService` / `OnboardingService`

`AuthService` and `OnboardingService` both expose near-identical `AuthManagementController`s (`api/v1/AuthManagement/...`) — `AuthService` is the one consumed by already-registered users signing in; `OnboardingService` has the equivalent during registration. Don't assume "the auth endpoint" means only one of these two services.

### `POST /AuthManagement/SignIn`
**Request** (`UserSignInRequest`):
```json
{ "EmailId": "user@example.com", "Password": "••••••••" }
```
Header: `x-preferred-lang` (defaults to English).

**Response** (`SignInResponse`, wrapped in `Response<T>` envelope — see below):
```json
{
  "Data": {
    "TradeToken": "...",
    "CustomerId": 123456,
    "CustomerName": "...",
    "RefreshToken": "...",
    "TokenRefreshInterval": 900,
    "CustomerNIN": "...",
    "AccountInformation": {
      "CashAccountId": 1001,
      "PrimaryIBAN": "AE...",
      "SecondaryIBAN": null,
      "TradingAccountId": 2002,
      "Currency": "AED"
    },
    "authSts": 1,
    "customerKYCDetail": { "...": "..." },
    "Restrictions": [],
    "Agreements": [],
    "Disclaimers": [],
    "FreeVersionExpired": false,
    "FreeVersionExpiryDays": 0
  }
}
```
`authSts` comes straight from DirectFN: `29` = account pending, `1` = success, `0` = bad credentials. Don't write acceptance criteria that treat sign-in as a simple boolean success/fail — there's a third pending state baked into the contract.

### `POST /AuthManagement/SignInWithUAEPass`
**Request** (`UserSignInWithUAEPassRequest`) — SAML/OAuth callback payload (see UAE Pass integration in `integrations.md`). Returns the same `SignInResponse` shape.

### `POST /AuthManagement/RefreshToken`
No body — reads `x-token` and `x-refresh-token` headers directly. Returns `RefreshTokenResponse`.

### `POST /AuthManagement/ChangePassword`
**Request** (`AuthChangePasswordRequest`): old password + new password (mapped internally to `Auth_ChangePasswordRequest`).

### `POST /AuthManagement/ResetForgotPassword`
**Request** (`AuthForgotPasswordRequest`): email-only; password is reset and (per `NotificationService`) delivered out-of-band.

### `POST /AuthManagement/RecoverAccount`, `POST /AuthManagement/SignOut`, `GET /AuthManagement/CustomerInfo?token=...`
Account recovery, sign-out (invalidate `SignoutRequest`), and a token-introspection-style lookup.

---

## OTP — `NotificationService`

### `POST /OTP/SendOTP`
**Request** (`SendOTPRequest`):
```json
{
  "OTPPurposeType": "Login",
  "NotificationChannelType": "SMS",
  "NotificationChannelValue": "+9715XXXXXXXX",
  "CustomerName": "Jane Doe",
  "Email": "jane@example.com",
  "SecretKey": "..."
}
```
`OTPPurposeType` and `NotificationChannelType` are enums (`Common/xCube.Services.Common/Enums`) — values include things like email verification, phone verification, password reset, login. `NotificationChannelType` covers Email / SMS / Push. Header: `x-channel` (defaults to `"xCube"`).

### `POST /OTP/TradingViewOTP`
Same request shape as `SendOTP` — a separate code path exists specifically for a "TradingView" OTP use case; don't assume it's interchangeable with `SendOTP` without checking `IOTPService.TradingViewOTPAsync`.

### `POST /OTP/VerifyOTP`
**Request** (`VerifyOTPRequest`):
```json
{
  "OTPPurposeType": "Login",
  "NotificationChannelType": "SMS",
  "NotificationChannelValue": "+9715XXXXXXXX",
  "OTPValue": "123456"
}
```

### `POST /OTP/VerifyOTPAndEmail`, `POST /OTP/VerifyAndMarkUsed`, `POST /OTP/VerifyOtpExists`, `GET /OTP/GetAllOTP`
Variants for combined OTP+email verification, marking an OTP consumed, existence checks, and (likely non-prod/debug) listing all active OTPs for a channel value.

---

## Orders — `PortfolioService`

### `POST /Order/CreateNewOrder`
Query: `HeaderParameters` (see quirk above). **Request** (`OrderRequestModel`):
```json
{
  "TradingAccountId": 2002,
  "SymbolCode": "EMAAR",
  "ExchangeCode": "DFM",
  "OrderType": "2",
  "OrderSide": "1",
  "OrderPrice": 5.25,
  "OrderQuantity": 100,
  "TIFType": 0,
  "DisclosedQuantity": 0,
  "MinFillQuantity": 0,
  "TradeDate": "20260618",
  "ExpirationDate": null,
  "DayOrder": 1,
  "InstrumentType": null,
  "MarketCode": null,
  "StopPrice": null,
  "StopType": null,
  "StopExpiry": null,
  "IdSource": 8,
  "IsSLB": false
}
```
**`OrderType` values** (string, per inline code comment): `1` = Market, `2` = Limit, `3` = StopMarket, `4` = StopLimit, `5` = StopLoss. **`OrderSide`**: `1` = Buy, `2` = Sell. This is materially more order types than any single client currently exposes (web ships Market/Limit only, per `repos.md`) — when a story asks for "support order type X," check whether the gap is client-side wiring or genuinely missing backend support before estimating it as backend work. `IdSource = 4` means the order targets a Future and `SymbolCode` should carry an ISIN instead of a ticker — don't assume `SymbolCode` is always a plain ticker.

**Response** (`OrderResponseModel` / `NewOrderResponseModel`): includes `OrderStatus` (see `OrderStatus_Reference.md` in `xCube-API` for the full state machine — it has ~50 distinct values across active/terminal/pending/dealer-workflow/Murabaha/partial-fill categories, not just "open/filled/cancelled"), `ClientOrderID`, `OriginalOrderNumber`, commission/VAT breakdown (`BrokerCommission`, `ExchangeCommission`, `VATAmount`, `TotalCommission`), `CanAmendable`/`CanCancellable` flags, and fill tracking (`CumulativeQuantity`, `LeaveQuantity`).

### `POST /Order/Validation`
Pre-submit validation; header `x-token`.

### `POST /Order/OrderCommission`
Returns a commission quote (`CommissionResponseModel`) for a prospective order — this is what a "preview" step would call before `CreateNewOrder`.

### `POST /Order/CancelOrder`
**Request** (`CancelOrderRequestModel`); header `x-preferred-lang`. Returns `200` with the updated order, matching the `OrderStatus_Reference.md` cancellation sub-flow (`RequestToCancel` → `SendToCancel`/`CancelWaitingForConf` → `Cancelled` or `CancelRejected`).

### `POST /Order/SearchOrder`
**Request** (`OrderSearchRequestModel`) — query/filter orders.

### `POST /Order/Update`
Amend an existing order (`UpdateOrderRequest`); header `x-token`. Maps to the amend sub-flow (`RequestToAmend` → `SendToAmend`/`AmendWaitingForConfirm` → `Replaced` or `AmendRejected`).

---

## Portfolio & Holdings — `PortfolioService`

All endpoints below are `POST` (not `GET`, despite being read operations) and take `[FromQuery] HeaderParameters`.

### `POST /Portfolio/BuyingPower`
**Request** (`BuyingPowerRequestModel`): `CashAccountId` (required), optional `TradingAccountId`, `Symbol`, `Exg`, `EmailId`.
**Response** (`BuyingPowerResponseModel`) is large — beyond the obvious `BuyingPower`/`Balance`/`Currency`, it carries a full margin-trading breakdown (`MarginLimit`, `MarginZeroPercent`...`Margin100Percent`, `MarginUtilization`, `MarginDue`, `IsMarginEnabled`, `IsEligibleToApplyMargin`), short-sell flags (`ShortSellSymbol`, `ShortSellTradeAcc`, `ShortSellingFee`), SLB cost flag (`hasSlbCost`), and TWR fields (`Twr`, `TwrStatus`). A "show buying power" story is rarely just one number — check which of these fields the target screen actually needs before scoping.

### `POST /Portfolio/Holdings`
**Request** (`HoldingRequestModel`). **Response** (`HoldingsResponseModel.Holdings: HoldingModel[]`) — per-position cost basis, quantity breakdown (`OwnedQuantity`/`AvailableQuantity`/`PledgedQuantity`/`PendingSell`/`PendingBuy`/`PayableQuantity`/`ReceivableQuantity`), and P&L (`RealizedGainLost`, `UnrealizedGainLoss`, `UnrealizedGainLossPct`). `Ric` is present per holding — this is the DirectFN/Dory identifier needed to subscribe to live pricing for that position.

### `POST /Portfolio/PortfolioGrowth`
**Request** (`PortfolioGrowthRequestModel`) → `PortfolioGrowthResponseModel`. Feeds the TWR-based growth chart; TWR itself is precomputed by the `xCube.CalculateTWR.Job` background job, not calculated inline.

### `POST /Portfolio/HoldingsWithPortfolioGrowthAndOpenOrderList`
Aggregating endpoint — holdings + growth + open orders in one call. If a mobile/web screen needs all three, prefer this over three separate calls (it exists specifically to avoid that).

### `POST /Portfolio/OpenOrderList`, `POST /Portfolio/OpenOrderDetails`
List/detail for open orders; `OpenOrderList` takes `x-preferred-lang`.

---

## Wallet — `WalletService`

### `POST /Wallet/ValidateIBAN`
**Request**: `{ "IBAN": "AE..." }`. Backend integration: see IBAN Checker API in `integrations.md`.

### `POST /Wallet/GetRecentlyUsedIBANs`, `POST /Wallet/RemoveRecentlyUsedIBAN`

### `POST /Wallet/WithdrawalToBankAccount`
Header: `x-channel` + `HeaderParameters` query. **Request** (`WithdrawalToBankAccountRequestModel`) → `WithdrawalReqsResponseModel`.

### `POST /Wallet/WithdrawalToiVestor`
Separate withdrawal path specifically for iVestor-linked accounts — don't conflate with the standard bank withdrawal flow.

### `POST /Wallet/GetAccountInformation`
Deposit-flow entry point; returns account/IBAN info needed before initiating a deposit. Header `x-preferred-lang`.

### `POST /Wallet/DepositThroughCreditCard`
Card deposit — backed by the nGenius integration (see `integrations.md`).

### `POST /Wallet/DepositThroughCBPaymentGateway`
**Request** (`DepositThroughCBPGRequestModel`) — Central Bank payment gateway deposit, distinct from the card path. This is also called server-side by `CBPaymentService`'s `UpdatePaymentGatewayInfo` action after a CB payment callback, via `MakeDepositDFN`, with `CurrencyCode` hardcoded to `"AED"`.

### `POST /Wallet/BankTransferRequest`, `GET /Wallet/BankTransfers`, `POST /Wallet/UpdateBankTransferStatus`, `POST /Wallet/DeleteBankTransfer`
Manual/offline bank transfer tracking — these look like an admin/ops-facing workflow rather than a real-time payment rail; don't assume `BankTransferRequest` triggers an actual transfer.

### `POST /Wallet/CashTransfer`
Internal cash transfer between accounts (`CashTransferRequest`/`CashTransferResponse`).

---

## Market Data — `MarketDataService`

This service speaks **DirectFN's data model** (RICs = instrument identifiers, FIDs = field identifiers) rather than a custom xCube schema — when a story needs "a new field on the quote," it's very likely "map an additional FID," not "add a database column."

### `GET /Quotes/GetCuratedListItemDetails?companySymbols=...`
Resolves display symbols → RICs, then fetches a fixed FID set (price, change, change%, volume, etc. — see `FIDSEnums` in code) for each. Handles `FUT` (futures, ticker rebuilt from contract month) and `CFU` instrument types specially.

### `GET /Quotes/GetRICsBySymbols?companySymbols=...`
Symbol → RIC lookup.

### `GET /Quotes/Watchlist`
Returns a **hardcoded** default set of indices/symbols (specific RIC/FID lists are inline in the controller, not configuration) — this is not a personalized user watchlist; see `WatchlistController`/`WatchlistsController` for the user-specific feature.

Other controllers in this service worth knowing exist before assuming they don't: `ChartsController`, `CompanyController`, `CustomHighlightsController`, `IndicesController`, `NewsController`, `StockInfoController`, `StocksController`, `TimeSeriesController`, `FindController`, `MasterDataController`, `DoryAuthController` (issues the JWT used to authenticate the Dory WebSocket — this is what the web client's `/api/v1/token`-style call resolves to).

---

## Real-time: Dory WebSocket

**Endpoint pattern:** `wss://<SOCKET_URL>/streaming/ticks?jwt=<token>` — token obtained from `DoryAuthController` via REST first, then used as a WS query param (not a header).

### Subscribe
```json
{
  "header": { "service": "quotes", "messageType": "subscribe", "version": "1.0", "messageId": "..." },
  "payload": [{ "rics": ["AAPL.O", "EMAAR.DU"], "fids": ["F122", "F021", "F019"] }]
}
```
### Server push
```json
{
  "header": { "service": "quotes", "messageType": "snapshot", "version": "1.0", "messageId": "..." },
  "payload": [{ "ric": "EMAAR.DU", "...": "FID-keyed fields" }]
}
```
`messageType` is `snapshot` (initial) or `update` (delta) on the messages observed in the web client. Close codes `1008`/`4401`/`4403` mean the JWT was rejected — clients should not blindly reconnect on those (the web client explicitly doesn't).

---

## Response Envelope

Nearly every controller wraps its payload in a generic envelope (`Common/xCube.Services.Common/Models`):
```json
{
  "Data": { "...": "..." },
  "ResponseStatus": "Success",
  "ResponseMessage": "optional human-readable message"
}
```
`ResponseStatus` is the `ResponseStatusType` enum — don't assume HTTP status code alone tells you success/failure; some failure paths still return `200` with a non-success `ResponseStatus` (this pattern appears throughout `PortfolioService`/`WalletService` controllers). Always check `ResponseStatus` in acceptance criteria, not just the HTTP status.

Unhandled exceptions are caught by the global `ExceptionFilter` (`Common/xCube.Services.Common/Filters`) and standardised — but the exact shape of that error response wasn't read as part of this pass; check `ExceptionFilter.cs` directly if a story's acceptance criteria depend on error-response shape.

---

## API Versioning

URL-based, per-service (not platform-wide): `/api/v1/...` is the floor; some services (`PortfolioService`, `NotificationService`, `WalletService`) declare `[ApiVersion("1.0")]` with a `v{version:apiVersion}` route token, and the Mobile BFF documents v1–v4. There is no single "current platform version" — check the specific service before stating a version number in a story.

## Order State Machine

Order status is not a simple enum of 4-5 values — `xCube-API/OrderStatus_Reference.md` documents ~50 distinct status codes across active/open, terminal, OMS-processing, pending-confirmation, approval-workflow, dealer-desk, Murabaha (Islamic finance), partial-fill, and invalidation categories. Any story involving order status display, filtering, or transition logic should reference that file directly rather than assuming a simplified status set.

## Rate Limits

**No rate limiting was found in the `xCube-API` codebase** (no rate-limiting middleware, attributes, or Ocelot rate-limit configuration located). Do not invent specific request/minute numbers for acceptance criteria — if a story needs rate limiting behaviour, that's new work to scope, not an existing contract to document.
