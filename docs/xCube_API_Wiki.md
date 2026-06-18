# xCube API — Platform Architecture & Developer Reference

> **Purpose:** Team wiki reference covering architecture, services, integrations, and development conventions.
> **Audience:** Engineers onboarding to the platform or needing a quick reference for how the system fits together.

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Solution Structure](#2-solution-structure)
3. [Microservices](#3-microservices)
4. [API Gateway & BFF](#4-api-gateway--bff)
5. [Background Jobs](#5-background-jobs)
6. [Common Library](#6-common-library)
7. [Databases](#7-databases)
8. [External Integrations](#8-external-integrations)
9. [Authentication & Security](#9-authentication--security)
10. [Configuration Management](#10-configuration-management)
11. [Logging & Monitoring](#11-logging--monitoring)
12. [Key Architectural Patterns](#12-key-architectural-patterns)
13. [Core User Flows](#13-core-user-flows)
14. [Tech Stack](#14-tech-stack)
15. [Build, Run & Deploy](#15-build-run--deploy)

---

## 1. Platform Overview

**xCube API** is an ASP.NET Core 7.0 fintech microservices platform providing digital investment, portfolio management, brokerage, and KYC services.

The system is composed of:
- **14 microservices** — one per business domain
- **1 API Gateway** — Ocelot-based routing + Backend-for-Frontend (BFF)
- **15+ background jobs** — async processing (compliance, calculations, CRM sync)
- **10 databases** — SQL Server per service domain
- **Shared common library** — logging, config, enums, utilities

---

## 2. Solution Structure

```
xCube.API/
├── APIGateway/      — Ocelot gateway + mobile BFF aggregator
├── Services/        — 14 independent microservices
├── Common/          — Shared libraries (logging, config, enums, utilities)
├── Database/        — SQL Server database projects (EF migrations)
├── Jobs/            — Standalone background processing services
└── PostmanCollection/ — API test collections
```

### Per-Service Project Layout (Clean Architecture)

Every service under `Services/` follows the same 4-project pattern:

| Project Suffix | Responsibility |
|---|---|
| `.API` | Controllers, request/response models, validators, Swagger, middleware |
| `.Core` | Business logic, service interfaces & implementations |
| `.Infrastructure` | DbContext, repositories, external HTTP integrations |
| `.SharedKernel` | DTOs shared across layers (no business logic) |

---

## 3. Microservices

### Service Directory

| Service | Domain | Key Responsibilities |
|---------|--------|---------------------|
| **AuthService** | Identity | JWT auth, user sign-in, refresh tokens, UAE Pass SAML, Uqudo screening |
| **OnboardingService** | KYC / Registration | User registration, document upload/verification, KYC workflow, chat |
| **PortfolioService** | Investments | Portfolio management, order processing, TWR calculations, margin requests |
| **WalletService** | Funds | Deposits, withdrawals, IBAN/credit card management, transaction history |
| **MarketDataService** | Market Data | Real-time quotes (DirectFN), watch lists, company info, news, indices |
| **NotificationService** | Notifications | OTP, push notifications, SMS, email; Hangfire for scheduling |
| **HoldingsService** | Holdings | User shareholdings, transfer notifications from exchange |
| **IPOService** | IPO | IPO offerings, subscriptions, allocations, state management |
| **CMSService** | Content | FAQs, banners, brokerage fees, market timings, complaints, translations |
| **CBPaymentService** | Payments | Central Bank payment gateway integration |
| **CRMService** | CRM | Dynamics 365 integration; earnings, activity logs, user records |
| **DFMService** | Discretionary FM | DFM account onboarding, investor management, portfolio management |
| **AdvisorService** | Advisory | Advisor-client relationships, performance, order instructions |
| **xCubeAccessService** | Access Control | Permissions and access management |

### DI Registration Convention

Each layer registers its dependencies via an extension method on `IServiceCollection`. `Program.cs` calls them in order:

```csharp
builder.Services.RegisterInfrastructerServices(config); // DbContext, repos, HTTP clients
builder.Services.RegisterCoreServices(config);          // Domain services, validators
builder.Services.RegisterAPIServiceExtensions(config);  // Controller services, mappings
builder.Services.RegisterCommonServiceExtensions(config); // Logging, health checks
```

When adding new services, follow this pattern — do not register directly in `Program.cs`.

---

## 4. API Gateway & BFF

### Ocelot Gateway (`APIGateway/xCube.APIGateway`)

Routes all inbound traffic to the correct downstream service. Key features:
- **API Key validation** via `ApiKeyMiddleware` before routing
- **CORS** with configurable allowed origins (`WebAppOrigin` config)
- **Elastic APM** instrumentation
- Environment-aware `appsettings.{env}.json`

**Current routing targets (`ocelot.json`):**

| Route | Downstream |
|-------|-----------|
| CRM routes | `crm-uatapi.xcube.ae:5030` |
| Chat public-key | `onboarding-uatapi.xcube.ae:5125` |
| All other mobile routes | `mobilebff-uatapi.xcube.ae:5020` (wildcard fallback) |

### Mobile BFF (`APIGateway/xCube.Mobile.BFF`)

Aggregates responses from multiple microservices into single calls optimised for mobile clients.

- API versioning: v1–v4
- Health check UI at `/health`
- Swagger multi-version docs
- Correlation ID logging
- Elastic APM tracing

---

## 5. Background Jobs

All jobs are standalone .NET Generic Host applications under `Jobs/`. Each uses `IHostedService` with a `PeriodicTimer` for scheduling and Serilog for logging.

| Job | Purpose | Data Source |
|-----|---------|------------|
| **xCube.CalculateTWR.Job** | Time-Weighted Return calculations | Portfolio DB |
| **xCube.PortfolioGrowthCache.Job** | Pre-warm portfolio performance cache | Portfolio DB |
| **xCube.RebateCalculation.Job** | Islamic margin rebate calculations | Portfolio DB + Oracle CRM |
| **xCube.CustomerHoldings.Job** | Cache monthly customer shareholdings | Advisor DB |
| **xCube.CompanyDetails.Job** | Refresh company master data | MarketData DB |
| **xCube.CentralBank.Job** | Central Bank balance & settlement sync | Wallet DB |
| **xCube.AdxNinAndIpoSubscription.Job** | ADX NIN & IPO subscription processing | IPO DB |
| **NewsAndMarketData.Job** | Fetch market news; AI summarisation via OpenAI | MarketData DB |
| **xCube.DynamicCRM.SyncJob** | Hourly sync of customers/wallets/CMS to Dynamics 365 | Wallet, Onboarding, CMS DBs |
| **xCube.DynamicCRM.ActivityJob** | Log user activity events to CRM | CRM DB |
| **xCube.Flagright.OnboardingJob** | Sync KYC events to Flagright AML | Onboarding DB |
| **xCube.Flagright.OrderJob** | Sync order transactions to Flagright | Portfolio DB |
| **xCube.Flagright.DepositAndWithdrawalJob** | Sync fund movements to Flagright | Wallet DB |
| **xCube.Ticket.Job** | Process Zendesk support tickets | External: Zendesk API |
| **Shuaa.WelcomeUsers.Job** | Brand-specific onboarding workflow | Onboarding DB |

**Scheduling pattern:**

```csharp
var timer = new PeriodicTimer(GetScheduleTime()); // Timespan from config
while (runJobNow || await timer.WaitForNextTickAsync())
{
    await ProcessBatch();
}
```

---

## 6. Common Library

**Location:** `Common/xCube.Services.Common`

Shared across all services. Do not duplicate logic already in here.

| Folder | Contents |
|--------|----------|
| `ConfigFiles/` | Centralised JSON config files loaded by all services at startup |
| `Constants/` | `XCubeConstants`, `LogContextConstants`, `JobConstants` |
| `Enums/` | All platform enums: `OrderStatus`, `TransactionEnums`, `FlagrightEnums`, `DirectFNEnums`, `NotificationEnums`, `OnboardingStatusEnum`, `CustomerStatusEnum`, `WalletEnums`, etc. |
| `Filters/` | Global `ExceptionFilter` — applies to all controllers |
| `Helpers/` | `HttpHelper`, `DBHelper`, `FileHelper`, `DataProtectionHelper`, `TranslationHelper`, `ExtensionMethods`, `JSONHelper` |
| `Integrations/` | Response handlers for DirectFN, iVestor, nGenius |
| `Logging/` | `SeriLogger` setup — Elasticsearch + File + SQL Server + Email sinks; `LogContextMiddleware`, correlation ID enrichment |
| `Models/` | `IResponse<T>`, `Response<T>`, shared DTOs |
| `ChainOfResponsibilty/` | Base classes for multi-step pipeline workflows |
| `Resources/` | i18n files: `Translation.resx`, `ValidationMessage.resx`, `OrderRejectionMessage.resx` |
| `ValidationAttributes/` | Custom FluentValidation rules (email, phone, etc.) |

---

## 7. Databases

One database per service domain. All on SQL Server unless noted.

| Database Project | Service | Purpose |
|-----------------|---------|---------|
| `xCube.Database.Onboarding` | OnboardingService | User profiles, KYC documents, screening results, onboarding warnings |
| `xCube.Database.Portfolio` | PortfolioService | Portfolios, holdings, margin requests, rebate history, TWR data |
| `xCube.Database.Wallet` | WalletService | Deposits, withdrawals, IBAN/CC records, transaction history |
| `xCube.Database.Notification` | NotificationService | Notifications, OTPs, device tokens, scheduled templates |
| `xCube.Database.CMS` | CMSService | Config, FAQs, banners, brokerage fees, market timings, complaints |
| `xCube.Database.MarketData` | MarketDataService | Watch lists, company data, FIDS/RICS identifiers, custom highlights |
| `xCube.Database.AdminPanel` | Admin Portal | ASP.NET Identity: users, roles, claims, logins |
| `xCube.IPO.Database` | IPOService | IPO offerings, subscriptions, allocations, transaction records |
| `xCube.Logs.Database` | Platform-wide | Serilog centralised logs (SQL Server fallback; Elasticsearch is primary) |
| `xCube.PaymentGateway` | CBPaymentService | Central Bank payment transaction records |

**Additional data sources:**
- **Oracle** — Legacy CRM data (accessed from RebateCalculation job)
- **Elasticsearch** — Primary log store; Serilog writes here first

---

## 8. External Integrations

### KYC & Identity

| System | Purpose | Config File |
|--------|---------|------------|
| **Uqudo** | Background screening & identity verification | `UqudoApiConfiguration.json` |
| **UAE Pass** | National identity SAML-based sign-in | Inline in Auth/Onboarding `Program.cs` |
| **DigitalVault** | KYC document storage | `DigitalVaultConfiguration.json` |

### CRM

| System | Purpose | Config File |
|--------|---------|------------|
| **Microsoft Dynamics 365** | Customer records, activity logs, earnings | `DynamicCRMConfiguration.json` |

Used by: AuthService, OnboardingService, WalletService, NotificationService, AdvisorService, CRMService.

### AML / Compliance

| System | Purpose | Config File |
|--------|---------|------------|
| **Flagright** | AML transaction monitoring | `FlagrightConfiguration.json` |

Three dedicated jobs sync onboarding events, order transactions, and fund movements to Flagright.

### Payment Gateways

| System | Purpose | Config File |
|--------|---------|------------|
| **nGenius** | Primary payment gateway (deposits/withdrawals) | `NGeniusConfiguration.json` |
| **WorldPay** | Alternative payment gateway | `WorldPayConfiguration.json` |
| **Central Bank API** | Settlement & balance confirmation | Inline CBPaymentService config |

### Market Data

| System | Purpose | Config File |
|--------|---------|------------|
| **DirectFN (DFN)** | Real-time quotes, order status codes | `DFNApiConfiguration.json` |
| **iVestor** | Investor data feeds | `IVestorApiConfiguration.json` |
| **ADX** | Abu Dhabi exchange NIN & IPO data | `AdxConfiguration.json` |
| **OpenAI** | AI summarisation of market news | Inline in NewsAndMarketData job |

### Support

| System | Purpose | Config File |
|--------|---------|------------|
| **Zendesk** | Support ticket processing | `ZendeskConfiguration.json` |
| **IBAN Checker API** | IBAN validation for wallet | `IBANCheckerAPIConfiguration.json` |

---

## 9. Authentication & Security

### JWT Token Flow

1. Client calls `POST /api/v1/authmanagement/signin` (or UAE Pass SAML endpoint)
2. AuthService validates credentials + KYC/Flagright status
3. JWT access token + refresh token issued
4. Client sends `x-token` header on all subsequent requests
5. Services validate the token on each request

**Token endpoints:**

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v1/authmanagement/signin` | Username & password login |
| `POST /api/v1/authmanagement/signinwithuaepass` | UAE Pass SAML login |
| `POST /api/v1/authmanagement/refreshtoken` | Refresh using `x-refresh-token` header |

### Standard Request Headers

| Header | Purpose |
|--------|---------|
| `x-token` | JWT access token |
| `x-refresh-token` | Refresh token |
| `x-preferred-lang` | `EN` or `AR` |
| `x-channel` | Client identifier (gateway sets `"xCube"`) |
| `x-correlation-id` | Request tracing — auto-generated if absent |

### API Key (Gateway Layer)

`ApiKeyMiddleware` in the Ocelot gateway validates API keys before routing any request to a downstream service.

### Input Validation

All controller inputs go through FluentValidation. Custom validators cover domain-specific rules (phone formats, UAE IBAN, etc.). The `ExceptionFilter` catches and standardises all unhandled exceptions across every service.

---

## 10. Configuration Management

### Load Order

Each service loads configuration in this order at startup:

1. `appsettings.json`
2. `appsettings.{ASPNETCORE_ENVIRONMENT}.json`
3. All `*.json` files found in `{BuildDirectory}/ConfigFiles/`

```csharp
string[] filePaths = Directory.GetFiles($@"{buildDirectory}\ConfigFiles");
foreach (var configFilePath in filePaths)
{
    builder.Configuration.AddJsonFile(configFilePath);
}
```

### Key Config Files (in `Common/xCube.Services.Common/ConfigFiles/`)

| File | Contents |
|------|----------|
| `ConnectionStrings.json` | All database connection strings |
| `CommonSettings.json` | Runtime flags, rolling intervals, OTP settings |
| `LogsConfiguration.json` | Serilog sinks, Elasticsearch URI, index prefix |
| `ErrorMessages.json` | Localised error messages |
| `XCubeInternalAPIConfiguration.json` | Internal service-to-service URLs |
| `NotificationConfiguration.json` | SMS / email provider settings |
| `PortfolioConfiguration.json` | Portfolio calculation parameters |
| `WalletConfiguration.json` | Wallet transaction limits |
| `OnboardingConfiguration.json` | KYC workflow steps |
| `MarketDataConfiguration.json` | Market data service settings |
| `PaymentGatewaySettings.json` | nGenius / WorldPay credentials |
| `CMSConfiguration.json` | Content management settings |
| + all integration configs | (See Section 8 for per-integration config files) |

> **Rule:** New settings go into the appropriate `ConfigFiles/` JSON — never hardcode values or add settings only to `appsettings.json`.

---

## 11. Logging & Monitoring

### Serilog Setup

Every service uses the shared `SeriLogger` from `Common/xCube.Services.Common/Logging/`.

**Sinks (in priority order):**

| Sink | Purpose |
|------|---------|
| **Elasticsearch** | Primary — real-time search and dashboards (index: `{service}_yyyy-MM`) |
| **File** | Local backup in `Logs/` folder |
| **SQL Server** | Fallback persistent store (`SeriLogs` table) |
| **Email** | Critical error alerts |

**Automatic enrichments on every log event:**
- Client IP address
- Environment name
- Correlation ID (auto-generated if missing from request)
- Sensitive data masking (credit cards, passwords, API keys)

**Logging in code:**

```csharp
Log.ForContext(LogContextConstants.SectionName, "OrderProcessing")
   .ForContext(LogContextConstants.CorrelationId, correlationId)
   .Information("Order {OrderId} processing started", orderId);
```

### Elastic APM

Instrumented via `Elastic.Apm.NetCoreAll` in the gateway and BFF. Traces requests end-to-end across services.

### Health Checks

- `/healthcheck` — Raw health status (SQL Server probes per service)
- `/health` — Health Check UI (BFF only)

---

## 12. Key Architectural Patterns

### Repository Pattern

All data access is abstracted behind interfaces:
- **Interface** defined in `.Core` layer
- **Implementation** in `.Infrastructure` layer

This keeps business logic testable and decoupled from EF/Dapper specifics.

### Chain of Responsibility

Used for multi-step business workflows:
- Order validation & approval pipelines
- Onboarding document processing
- Payment processing

Base classes live in `Common/xCube.Services.Common/ChainOfResponsibilty/`.

### API Versioning

URL-based versioning. New behaviour goes in a new version, old versions stay working.

```
GET /api/v1/portfolio/get   ← stable
GET /api/v2/portfolio/get   ← updated contract
GET /api/v4/portfolio/get   ← latest (PortfolioService)
```

Each version gets its own Swagger document at `/swagger/v{N}/swagger.json`.

### Async Throughout

All service and repository methods must be `async`/`await`. No synchronous blocking calls.

---

## 13. Core User Flows

### User Registration & Onboarding

```
OnboardingService (register, document upload)
  → Flagright onboarding job (AML screening)
  → Uqudo (background check)
  → DynamicCRM sync job (create customer record)
  → AuthService (activate account)
  → NotificationService (welcome email/SMS)
```

### Order Placement

```
PortfolioService (validate, margin check)
  → Flagright order job (transaction monitoring)
  → OMS backend / DirectFN (execution)
  → AdvisorService (if delegated — advisor approval)
  → NotificationService (order confirmation)
```

### Deposit Flow

```
WalletService (initiate, IBAN/CC entry)
  → nGenius / WorldPay (payment processing)
  → CentralBank job (settlement confirmation)
  → Flagright deposit job (AML monitoring)
  → DynamicCRM sync (update customer record)
  → NotificationService (SMS/email confirmation)
```

### Market Data Refresh

```
NewsAndMarketData job (fetch DirectFN quotes + ADX data)
  → Store in MarketData DB
  → OpenAI (AI summarisation of news)
  → Clients query via MarketDataService API
```

---

## 14. Tech Stack

| Concern | Technology |
|---------|-----------|
| Language | C# (.NET 7.0) |
| Web Framework | ASP.NET Core 7.0 |
| API Gateway | Ocelot 22.x |
| ORM | Entity Framework Core 6 + Dapper |
| Database | SQL Server (primary), Oracle (CRM legacy) |
| Logging | Serilog + Elasticsearch, File, SQL Server, Email sinks |
| Caching | `IMemoryCache` |
| Validation | FluentValidation 11.x |
| Mapping | AutoMapper 12.x |
| API Docs | Swagger / OpenAPI (URL-based versioning) |
| Background Jobs | .NET Generic Host + `PeriodicTimer`; Hangfire (NotificationService) |
| Health Checks | AspNetCore.HealthChecks |
| Monitoring | Elastic APM |
| Encryption | RNCryptor, JwtBearer |
| AI | OpenAI via `Betalgo.OpenAI` (news summarisation) |
| String Matching | FuzzySharp |
| Phone Validation | libphonenumber-csharp |

---

## 15. Build, Run & Deploy

### Common Commands

```bash
# Build entire solution
dotnet build xCube.API.sln --configuration Release

# Run a specific service
dotnet run --project Services/AuthService/xCube.AuthService.API/xCube.AuthService.API.csproj

# Run a background job
dotnet run --project Jobs/xCube.CalculateTWR.Job/xCube.CalculateTWR.Job.csproj

# Run tests
dotnet test --configuration Release

# Add an EF migration (run from Infrastructure project directory)
dotnet ef migrations add {MigrationName}

# Apply migrations
dotnet ef database update
```

### CI/CD

- **Pipeline:** Azure Pipelines (`azure-pipelines.yml`)
- **Trigger:** Push to `main` branch
- **Build step:** `dotnet build --configuration Release`

### Adding a New Service (Checklist)

1. Copy an existing service structure (AuthService is a good reference)
2. Update all project names and namespaces
3. Add `.csproj` references to `xCube.API.sln`
4. Create `DbContext` in Infrastructure; add connection string to `ConnectionStrings.json`
5. Add EF migrations: `dotnet ef migrations add Initial`
6. Register layers in `Program.cs` following the DI extension pattern
7. Add health check for the new database
8. Add controller(s), validators, and Swagger docs
9. Log using `SeriLogger` with `LogContextConstants` correlation fields
10. Add any new config to the appropriate `ConfigFiles/` JSON file

### Troubleshooting Guide

| Symptom | First Check |
|---------|------------|
| Service fails to start | `ConnectionStrings.json` — DB connection reachable? |
| External API timeout | Check service config file for correct endpoint URLs |
| Flagright sync failing | `FlagrightConfiguration.json` credentials, API reachability |
| Token rejected | Client must call `/refreshtoken` — check token expiry config |
| Correlation ID missing from logs | Verify `LogContextMiddleware` is registered in `Program.cs` |
| OMS order stuck | Check `OrderStatus` reference doc — identify current status in state machine |

---

*For order state machine details see [OrderStatus_Reference.md](./OrderStatus_Reference.md).*
*For full database schemas see [xCube_Database_Schemas.md](./xCube_Database_Schemas.md).*
