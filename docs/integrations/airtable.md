# Airtable Integration (Roadmap)

Airtable is used as the roadmap data source. The app reads initiatives from an Airtable base and writes back PRD links and work-item IDs after they are created.

## When to use

Use Airtable if your team already manages a product roadmap there. If you don't have Airtable, set `ROADMAP_INTEGRATION=none` — the initiative list will be hidden and all other features continue to work.

## Setup

### 1. Create an Airtable base

Your base needs a table with these fields (names must match exactly):

| Field | Type | Notes |
|-------|------|-------|
| Initiative | Single line text | Primary field — the initiative name |
| Description | Long text | |
| Status | Single select | Options: Discovery, Ready, In Progress, Blocked, Deferred, Shipped |
| Business Value | Number | 1–10 |
| Priority Score | Formula | Calculated; can be a dummy value |
| Estimate | Single select | XS, S, M, L, XL |
| Confidence | Number | 0–1 |
| Target Quarter | Single line text | Optional |
| Target Window | Single select | Now, Next, Later, Under Review, Someday, Shipped |
| Product Area | Single line text | Optional |
| Strategic Theme | Single line text | Optional |
| Affected Stakeholders | Multiple select | Optional |
| Requires Dev Work | Single select | Yes, No |
| Planned Start Date | Date | Optional |
| Planned End Date | Date | Optional |
| Notes | Long text | Optional |
| Release Logs | Long text | Optional |
| Owner | Single line text | Optional |
| PRD Link | URL | Written back by the app |
| Epic Link | URL | Written back by the app |
| Azure Epic ID | Single line text | Written back when ADO integration is active |
| Azure Feature IDs | Single line text | Written back when ADO integration is active |
| Azure Story IDs | Single line text | Written back when ADO integration is active |

### 2. Get API credentials

1. Go to [airtable.com/create/tokens](https://airtable.com/create/tokens)
2. Create a personal access token with scopes: `data.records:read`, `data.records:write`
3. Add your base to the token's base list
4. Copy the token (starts with `pat…`)

To find your base ID: open the base in browser — the URL is `https://airtable.com/{baseId}/…`

### 3. Configure `.env`

```env
ROADMAP_INTEGRATION=airtable

AIRTABLE_API_KEY=pat...
AIRTABLE_BASE_ID=app...
AIRTABLE_TABLE_NAME=YourTableName
```

The `AIRTABLE_TABLE_NAME` must match the exact tab name in the base (case-sensitive, spaces allowed).

## Airtable filter notes

The app uses Airtable formula filtering:

- **Items needing PRDs**: `AND(OR({Status} = 'Discovery', {Status} = 'Ready'), NOT({PRD Link}), {Requires Dev Work} = 'Yes')`
- **Items ready for backlog**: `AND({Status} = 'In Progress', {PRD Link}, NOT({Epic Link}))`

`NOT({Field})` is required for URL/link fields — `{Field} = BLANK()` causes a `SERVER_ERROR` from Airtable.

## Mock mode

Set `USE_MOCK_DATA=true` to bypass Airtable and use built-in fixture data. Useful for development without a live Airtable connection. The `ROADMAP_INTEGRATION` setting is ignored in mock mode (it defaults to `airtable`).
