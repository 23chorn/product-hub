# Deployment & Promotion Runbook

> This runbook covers promoting the Product Automation Pipeline from a developer laptop
> to a shared staging or production instance. The app currently runs as a local Node.js
> process — there is no containerisation or cloud infrastructure yet. All procedures here
> assume a single-server deployment (e.g. a VPS or dedicated Mac mini).

---

## 1. Environment Topology

| Environment | Purpose | URL | DB location |
|---|---|---|---|
| **dev** | Local laptop, daily development | `localhost:3001` | `db/product-ops.db` (gitignored) |
| **staging** | Shared pre-production, QA and demos | `staging.internal:3001` | `/opt/pap/db/product-ops.db` |
| **production** | Live use, human-in-the-loop workflows | `pap.internal:3001` | `/opt/pap/db/product-ops.db` |

Staging and production are identical in structure — they differ only in environment variables and data.

### Promotion path

```
dev  →  staging  →  production
```

Always deploy to staging first. Run `npm run verify-schema` on staging before promoting to production.

---

## 2. Environment Variable Checklist

Copy `.env.example` to `.env` on each server and fill in the values. Variables that differ per environment are marked **env-specific**.

| Variable | dev | staging | production | Notes |
|---|---|---|---|---|
| `AI_PROVIDER` | `ollama` | `anthropic` | `anthropic` | Use Ollama for free local runs; Anthropic for staging/prod quality |
| `ANTHROPIC_API_KEY` | — | **env-specific** | **env-specific** | Never shared across environments |
| `AIRTABLE_API_KEY` | **env-specific** | **env-specific** | **env-specific** | Use a read-only PAT on staging if possible |
| `AIRTABLE_BASE_ID` | same | same | same | Points to the same Airtable base unless you have a staging base |
| `AIRTABLE_TABLE_NAME` | same | same | same | |
| `AZURE_DEVOPS_PAT` | — | **env-specific** | **env-specific** | Use a scoped PAT per environment |
| `PORT` | `3001` | `3001` | `3001` | Change if running behind a reverse proxy |
| `FRONTEND_URL` | `http://localhost:5173` | `http://staging.internal:5173` | `http://pap.internal:5173` | Must match actual frontend origin for CORS |
| `NODE_ENV` | `development` | `staging` | `production` | Disables stack traces in error responses when not `development` |
| `ENABLE_WORKFLOW_MODE` | `true` (default) | `true` | `true` | Set to `false` to hide Workflow Mode UI without removing the feature |

---

## 3. DB Migration Strategy

The app uses `better-sqlite3` with synchronous calls. Schema changes use **additive migrations only** — new tables and columns are added; existing ones are never dropped in a live migration.

### How migrations run

`initSchema()` in `database.ts` uses `CREATE TABLE IF NOT EXISTS` — safe to run on any existing DB.
`runMigrations()` runs immediately after, applying any structural changes via table-rebuild pattern.

**On every server restart**, both functions run automatically. There is no separate migration CLI.

### Adding a new column to an existing table

SQLite does not support `ALTER TABLE … ADD COLUMN` for columns with constraints.

**Allowed pattern (safe):**
```sql
ALTER TABLE my_table ADD COLUMN new_col TEXT;
```

**Required pattern for columns with CHECK constraints or NOT NULL:**
```
1. Add migration to runMigrations() in database.ts using the table-rebuild pattern:
   - CREATE TABLE my_table_migrated (...new schema...)
   - INSERT INTO my_table_migrated SELECT ... FROM my_table
   - DROP TABLE my_table
   - ALTER TABLE my_table_migrated RENAME TO my_table
   - Recreate indexes
2. Wrap in db.transaction() for atomicity
3. Run with PRAGMA foreign_keys = OFF / ON around the transaction
```

See the existing `Migration 1` in `runMigrations()` for a reference implementation.

### Deploying schema changes

1. Back up the DB (section 4).
2. Pull new code and install deps: `npm install`
3. Restart the server — migrations run automatically on startup.
4. Run `npm run verify-schema` to confirm all tables and columns are present.
5. If verify-schema fails, see section 6 (Rollback).

---

## 4. Data Directory Backup

The `data/` directory contains all conversation markdown files and exported artifacts. It is gitignored and must be backed up separately before any deployment.

### Before deploying

```bash
# On the server, from the project root:
tar -czf /opt/pap/backups/data-$(date +%Y%m%d-%H%M%S).tar.gz data/
cp db/product-ops.db /opt/pap/backups/product-ops-$(date +%Y%m%d-%H%M%S).db
```

Keep at least 3 daily backups. The `db/product-ops.db` file is a single-file SQLite database — a plain `cp` is safe when the server is stopped.

**If the server is running:** use SQLite's online backup API instead:

```bash
sqlite3 db/product-ops.db ".backup /opt/pap/backups/product-ops-$(date +%Y%m%d-%H%M%S).db"
```

This is safe against concurrent writes (WAL mode is enabled).

### Restore

```bash
# Stop the server
pm2 stop pap  # or: kill $(lsof -ti:3001)

# Restore DB
cp /opt/pap/backups/product-ops-TIMESTAMP.db db/product-ops.db

# Restore data directory
rm -rf data/
tar -xzf /opt/pap/backups/data-TIMESTAMP.tar.gz

# Restart
pm2 start pap
```

---

## 5. Deploy Procedure

### Standard deploy (no schema changes)

```bash
# 1. Backup
tar -czf /opt/pap/backups/data-$(date +%Y%m%d-%H%M%S).tar.gz data/
sqlite3 db/product-ops.db ".backup /opt/pap/backups/product-ops-$(date +%Y%m%d-%H%M%S).db"

# 2. Pull code
git pull origin main

# 3. Install dependencies
npm install

# 4. Build shared types (required when types.ts changes)
cd app/shared && npm run build && cd ../..

# 5. Restart server
pm2 restart pap  # or: kill old process and: npm run dev:backend &

# 6. Verify
npm run verify-schema
curl http://localhost:3001/health
```

### Restarting without losing in-flight sessions

Sessions are persisted in SQLite — they survive a server restart. The only in-flight state lost on restart is:

- Active SSE streams (client will see the connection drop; user must re-send their last message)
- In-memory project context cache (reloaded automatically on the next request)

To minimise disruption, restart during off-peak hours or when no active streaming sessions are visible in the UI.

---

## 6. Rollback Procedure

If a deployment fails (schema verify fails, server won't start, or errors in logs):

```bash
# 1. Stop the new server
pm2 stop pap

# 2. Restore previous code
git checkout HEAD~1  # or: git checkout <previous-tag>

# 3. Restore DB (if schema was changed)
cp /opt/pap/backups/product-ops-TIMESTAMP.db db/product-ops.db

# 4. Restore data directory (if needed)
rm -rf data/
tar -xzf /opt/pap/backups/data-TIMESTAMP.tar.gz

# 5. Reinstall old deps
npm install

# 6. Restart
pm2 start pap

# 7. Verify
curl http://localhost:3001/health
npm run verify-schema
```

### Schema rollback

SQLite does not support transactional DDL. If a migration ran partially:

1. Restore the pre-deploy DB backup (the safest option).
2. If no backup exists, manually inspect `sqlite3 db/product-ops.db ".tables"` and compare with the previous schema. Add missing columns with `ALTER TABLE … ADD COLUMN` (nullable only).

---

## 7. Post-Deploy Checklist

- [ ] `npm run verify-schema` exits 0
- [ ] `curl http://localhost:3001/health` returns `{"status":"healthy",...}`
- [ ] Frontend loads and shows correct AI provider in header
- [ ] Can create a new session and send a message
- [ ] Check logs for any `[ERROR]` lines on startup
