# Repository Structure

This document describes the purpose and boundaries of each repository in the TradeEasy ecosystem.

## Web Platform

### `tradeeasy-web` (Monorepo)
**Purpose**: Web trading platform (React SPA + .NET API)  
**Tech**: React 18, TypeScript, Vite, ASP.NET Core 8, PostgreSQL  
**Teams**: Web Frontend, Backend API  
**Deployed to**: CloudFront (frontend), ECS Fargate (backend)

**Structure**:
```
apps/
  web/        # React SPA (port 5173 in dev)
  api/        # .NET 8 API (port 5000 in dev)
packages/
  ui/         # Shared React components
  types/      # Shared TypeScript types (generated from C# DTOs)
  utils/      # Shared utilities
```

**Typical feature scope**:
- User-facing web features (watchlist, alerts, portfolio)
- API endpoints consumed by the web SPA
- Database migrations for web-specific tables
- Shared types between frontend and backend

**Does NOT include**:
- Mobile app code (separate repos)
- Background workers (separate repo)
- Market data ingestion (separate service)

---

## Mobile Platform

### `tradeeasy-ios`
**Purpose**: iOS native trading app  
**Tech**: Swift, SwiftUI, Combine, Core Data  
**Team**: iOS Engineering  
**Deployed to**: App Store  
**Min iOS version**: 16.0

**Typical feature scope**:
- Native iOS screens and navigation
- Push notification handling (APNs)
- Biometric authentication (Face ID, Touch ID)
- Offline-first data sync with Core Data

**Consumes APIs from**: `tradeeasy-api` (shared backend)

---

### `tradeeasy-android`
**Purpose**: Android native trading app  
**Tech**: Kotlin, Jetpack Compose, Room, WorkManager  
**Team**: Android Engineering  
**Deployed to**: Google Play Store  
**Min Android API**: 26 (Android 8.0)

**Typical feature scope**:
- Native Android screens and navigation
- Push notification handling (FCM)
- Biometric authentication (BiometricPrompt API)
- Offline-first data sync with Room

**Consumes APIs from**: `tradeeasy-api` (shared backend)

---

## Backend Services

### `tradeeasy-api`
**Purpose**: Shared REST API consumed by web, iOS, and Android  
**Tech**: .NET 8, ASP.NET Core, PostgreSQL, Redis  
**Team**: Backend Engineering  
**Deployed to**: ECS Fargate (ALB for load balancing)

**API versioning**: `/api/v1/*`, `/api/v2/*`

**Typical feature scope**:
- RESTful endpoints for client consumption
- Business logic and validation
- Database access via Entity Framework Core
- Authentication (OAuth 2.0 via Auth0)
- Real-time push via SignalR

**Does NOT include**:
- Long-running background jobs (see `tradeeasy-workers`)
- Market data ingestion (see `tradeeasy-market-data`)

---

### `tradeeasy-workers`
**Purpose**: Background job processing (alerts, settlements, notifications)  
**Tech**: .NET 8, Hangfire, Redis (job queue), PostgreSQL  
**Team**: Backend Engineering  
**Deployed to**: ECS Fargate (long-running services)

**Key workers**:
- `AlertEvaluationWorker` — evaluates price alerts every 5s
- `NotificationWorker` — sends push notifications via FCM/APNs
- `SettlementWorker` — processes T+2 trade settlements nightly
- `ReportGenerationWorker` — generates monthly statements

**Typical feature scope**:
- Scheduled jobs (cron)
- Event-driven jobs (message queue consumers)
- Batch processing (reports, reconciliation)

**Consumes**: Shared PostgreSQL database with `tradeeasy-api`  
**Publishes to**: Redis pub/sub (for SignalR fanout)

---

### `tradeeasy-market-data`
**Purpose**: Market data ingestion and quote distribution  
**Tech**: .NET 8, Polygon.io WebSocket client, Redis pub/sub  
**Team**: Backend Engineering  
**Deployed to**: ECS Fargate (1 dedicated task)

**Responsibilities**:
- Connect to Polygon.io WebSocket streams
- Normalize quote data to internal format
- Publish to Redis channels (`quotes:{ticker}`)
- Store quote snapshots in Redis (15s TTL)

**Typical feature scope**:
- New market data providers (fallback to Finnhub)
- Quote normalization logic
- Rate limit handling

**Does NOT include**:
- Client-facing APIs (see `tradeeasy-api`)

---

## Shared Libraries

### `tradeeasy-shared` (NuGet package)
**Purpose**: Shared C# types, utilities, and abstractions  
**Tech**: .NET 8 class library  
**Consumed by**: `tradeeasy-api`, `tradeeasy-workers`, `tradeeasy-market-data`

**Contents**:
- Domain models (User, Ticker, Alert, Trade)
- DTOs (API request/response objects)
- Utilities (date formatting, validation)
- Constants (work item types, API endpoints)

**Versioned via**: NuGet (internal feed or GitHub Packages)

---

### `tradeeasy-design-system` (npm package)
**Purpose**: Shared React components and design tokens  
**Tech**: React, TypeScript, Tailwind CSS, Storybook  
**Consumed by**: `tradeeasy-web/apps/web`, future web apps

**Contents**:
- React components (Button, Input, Modal, Toast, Card)
- Design tokens (colors, spacing, typography)
- Tailwind CSS config
- Storybook documentation

**Versioned via**: npm (private registry or GitHub Packages)

---

## Infrastructure & DevOps

### `tradeeasy-infrastructure`
**Purpose**: Infrastructure as Code (Terraform)  
**Tech**: Terraform, AWS (VPC, ECS, RDS, S3, CloudFront)  
**Team**: DevOps / Platform Engineering

**Manages**:
- ECS clusters and task definitions
- RDS PostgreSQL instances (UAT, Prod)
- ElastiCache Redis clusters
- S3 buckets and CloudFront distributions
- ALB and security groups
- Secrets Manager entries

**Typical changes**:
- Add new environment (staging)
- Provision new service (new ECS task)
- Update capacity (RDS instance size)

---

## Decision Guidelines

### When does a feature touch multiple repos?

**Example 1: Watchlist feature (web-only)**
- **Repos touched**: `tradeeasy-web` (frontend + API)
- **Reason**: Self-contained web feature, no mobile or background workers needed

**Example 2: Price alerts (cross-platform)**
- **Repos touched**:
  - `tradeeasy-api` (create alert endpoint)
  - `tradeeasy-workers` (alert evaluation worker)
  - `tradeeasy-ios` (alert creation UI, push notification handling)
  - `tradeeasy-android` (alert creation UI, push notification handling)
  - `tradeeasy-web` (alert creation UI)
- **Reason**: Feature spans all clients and requires background processing

**Example 3: Real-time quote streaming (backend infrastructure)**
- **Repos touched**:
  - `tradeeasy-market-data` (ingest from Polygon.io)
  - `tradeeasy-api` (SignalR hub for client fanout)
- **Reason**: Backend-only feature, clients already have WebSocket support

### When to create a new repo?

**Create a new repo if**:
- Service has independent deployment lifecycle
- Service has different scaling requirements
- Service has different team ownership
- Service has no shared code with existing repos (clear bounded context)

**Do NOT create a new repo if**:
- It's just a few new API endpoints (add to `tradeeasy-api`)
- It's a new background job (add to `tradeeasy-workers`)
- It's a shared utility (add to `tradeeasy-shared`)

---

## Cross-Repo Dependencies

### API Contracts
- **Who owns**: Backend team (C# DTOs in `tradeeasy-shared`)
- **How shared**: Auto-generated TypeScript types via `dotnet-typegen`
- **Breaking changes**: Require API versioning (`/api/v2/*`) and migration plan

### Database Schema
- **Who owns**: Backend team (EF Core migrations in `tradeeasy-api`)
- **Shared by**: `tradeeasy-api`, `tradeeasy-workers`, `tradeeasy-market-data`
- **Breaking changes**: Require backward-compatible migrations (additive only)

### Redis Pub/Sub Channels
- **Who owns**: Backend team (documented in `tradeeasy-api` README)
- **Publishers**: `tradeeasy-market-data`, `tradeeasy-workers`
- **Subscribers**: `tradeeasy-api` (SignalR fanout)
- **Schema**: JSON payloads, versioned via `__version` field

---

## Repository Contact & Links

| Repo | Team Lead | GitHub | Deployment |
|------|-----------|--------|------------|
| `tradeeasy-web` | Sarah Chen | [github.com/tradeeasy/web](https://github.com/tradeeasy/web) | [app.tradeeasy.com](https://app.tradeeasy.com) |
| `tradeeasy-ios` | Mike Torres | [github.com/tradeeasy/ios](https://github.com/tradeeasy/ios) | App Store (Bundle ID: com.tradeeasy.app) |
| `tradeeasy-android` | Priya Patel | [github.com/tradeeasy/android](https://github.com/tradeeasy/android) | Play Store (Package: com.tradeeasy.app) |
| `tradeeasy-api` | Jordan Lee | [github.com/tradeeasy/api](https://github.com/tradeeasy/api) | api.tradeeasy.com |
| `tradeeasy-workers` | Jordan Lee | [github.com/tradeeasy/workers](https://github.com/tradeeasy/workers) | ECS (internal) |
| `tradeeasy-market-data` | Jordan Lee | [github.com/tradeeasy/market-data](https://github.com/tradeeasy/market-data) | ECS (internal) |
| `tradeeasy-infrastructure` | Alex Kim | [github.com/tradeeasy/infra](https://github.com/tradeeasy/infra) | N/A (Terraform state in S3) |
