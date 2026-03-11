# Database Schema

> **How to use this file:** Copy to `db-schema.md`, fill in your real details, and delete this note.
> `db-schema.md` is gitignored — your schema details stay local. This example uses a fictional company.

## Tables

### tenants
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| name | varchar(255) | Company name |
| plan | varchar(50) | `starter`, `professional`, `enterprise` |
| created_at | timestamptz | |

### users
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| tenant_id | uuid | FK → tenants.id |
| email | varchar(255) | Unique per tenant |
| role | varchar(50) | `admin`, `operator`, `viewer` |
| auth0_sub | varchar(255) | Auth0 subject ID |
| created_at | timestamptz | |

### connectors
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| tenant_id | uuid | FK → tenants.id |
| source_system | varchar(100) | e.g. `sap_s4hana` |
| target_system | varchar(100) | e.g. `manhattan_wms` |
| status | varchar(50) | `active`, `paused`, `error` |
| config | jsonb | Encrypted connection credentials and mapping rules |
| last_sync_at | timestamptz | Nullable — null until first successful sync |
| created_at | timestamptz | |

### sync_runs
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| connector_id | uuid | FK → connectors.id |
| status | varchar(50) | `running`, `success`, `partial_failure`, `failed` |
| records_processed | integer | |
| records_failed | integer | |
| error_summary | text | Nullable |
| started_at | timestamptz | |
| completed_at | timestamptz | Nullable |

### field_mappings
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| connector_id | uuid | FK → connectors.id |
| source_field | varchar(255) | Field path in source system |
| target_field | varchar(255) | Field path in target system |
| transform | varchar(100) | `direct`, `uppercase`, `date_format`, `lookup` |
| transform_config | jsonb | Parameters for the transform function |

## Key relationships

- `tenants` → `users`: one-to-many. Every query is tenant-scoped via RLS policies.
- `tenants` → `connectors`: one-to-many. A tenant can have multiple connector pairs.
- `connectors` → `sync_runs`: one-to-many. Each sync run is an immutable audit record.
- `connectors` → `field_mappings`: one-to-many. Mappings are user-configured via the no-code UI.

## Indexes worth noting

- `idx_sync_runs_connector_started` on `sync_runs(connector_id, started_at DESC)` — powers the "recent syncs" dashboard
- `idx_users_tenant_email` on `users(tenant_id, email)` — unique constraint for per-tenant email uniqueness
- `idx_connectors_tenant_status` on `connectors(tenant_id, status)` — filters active connectors on the dashboard
