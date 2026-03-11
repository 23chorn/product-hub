# Current State

> **How to use this file:** Copy to `current-state.md`, fill in your real details, and delete this note.
> `current-state.md` is gitignored — your project state stays local. This example uses a fictional company.
> **Update this file regularly** — stale state actively misleads agents.

*Last updated: 2026-03-10*

## What is live today

- **Acme Sync v2.4** — core integration platform with 142 pre-built connectors
- **Guided setup wizard v1** — 14-day average time-to-live for new customers
- **Acme Insights (beta)** — dashboards for 4 pilot customers, limited to inventory views
- **Connector health monitoring** — real-time status page showing sync health per connector
- **Self-serve field mapping UI** — no-code drag-and-drop for all supported systems

## Active work (current sprint: Sprint 24, Mar 3–14)

- **SAP S/4HANA Cloud connector** — new connector for cloud-native SAP (in QA, shipping this sprint)
- **Setup wizard v2** — redesigned onboarding flow targeting 7-day time-to-live (in development, 60% complete)
- **Insights alerting MVP** — threshold-based alerts for inventory anomalies (in design review)
- **Sync retry improvements** — automatic retry with exponential backoff for transient failures (merged, in staging)

## Known debt and issues

- **Connector config encryption migration** — 23 legacy connectors still use AES-128; need to migrate to AES-256. Low risk but compliance flagged it for Q2.
- **Sync run table growth** — `sync_runs` table exceeds 50M rows. Query performance is fine with current indexes, but need a partition or archive strategy before Q3.
- **Field mapping undo** — no undo/redo in the mapping UI. Users have lost work — 3 support tickets in the last month.
- **Insights beta performance** — dashboard load time is 4–6 seconds for tenants with >100K sync records. Target is <2 seconds.

## Recent decisions

- **2026-03-05:** Chose OpenSearch over Elasticsearch for Insights query layer. Reason: AWS-native, lower operational overhead, sufficient for our query patterns.
- **2026-02-28:** Deferred mobile app to H2 2026. No demand signal from customer interviews. Will revisit after Insights GA.
- **2026-02-20:** Adopted Drizzle ORM replacing raw SQL queries. Migration in progress — 60% of queries converted. New code must use Drizzle.
