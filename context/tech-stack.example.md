# Tech Stack

> **How to use this file:** Copy to `tech-stack.md`, fill in your real details, and delete this note.
> `tech-stack.md` is gitignored — your technical details stay local. This example uses a fictional company.

## Frontend

- **Framework:** React 18 with TypeScript
- **State management:** Zustand (lightweight stores, no Redux boilerplate)
- **Styling:** Tailwind CSS + Headless UI for accessible components
- **Build tool:** Vite
- **Key libraries:** React Query (server state), React Hook Form (forms), Recharts (dashboards)
- **Testing:** Vitest + React Testing Library

## Backend

- **Runtime:** Node.js 20 LTS
- **Framework:** Express with TypeScript
- **API style:** REST — versioned at `/api/v1/*`
- **Auth:** Auth0 (JWT-based), middleware validates on every request
- **Validation:** Zod schemas shared between frontend and backend via a `shared` package

## Data

- **Primary DB:** PostgreSQL 15 on AWS RDS (Multi-AZ)
- **Cache:** Redis 7 on ElastiCache — used for session state and connector sync locks
- **Search:** OpenSearch for log and event querying in Insights dashboards
- **Migrations:** Drizzle ORM with migration files checked into git

## Infrastructure

- **Hosting:** AWS — ECS Fargate for API, S3 + CloudFront for frontend SPA
- **CI/CD:** GitHub Actions — lint, test, build, deploy on merge to `main`
- **Environments:** `dev` (auto-deploy on PR), `staging` (deploy on merge), `prod` (manual promote from staging)
- **Monitoring:** Datadog APM + logs, PagerDuty for on-call alerts
- **IaC:** Terraform for all AWS resources

## Key integrations

- **ERP connectors:** SAP RFC SDK, NetSuite SuiteTalk REST, Dynamics 365 OData
- **WMS connectors:** Manhattan SOAP, Blue Yonder REST, Fishbowl API
- **Payments:** Stripe (subscription billing)
- **Email:** SendGrid (transactional emails, onboarding sequences)
- **Analytics:** Segment → Amplitude for product analytics
