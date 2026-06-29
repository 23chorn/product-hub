# Edit Initiative Description Before Launch

Product users can review and edit the initiative description in the launch modal before starting a workflow. Changes sync back to Airtable automatically.

## Use Case

Before launching a workflow, Product users often want to:
- Add missing context that agents need
- Clarify ambiguous requirements
- Include links to supporting documents
- Note constraints or assumptions

The description field feeds directly into the `goal` parameter passed to the workflow, so enriching it before launch ensures agents have the best possible context from the start.

## Workflow

### Step 1: Click "Launch" on an Initiative Card

When a Product user clicks **Launch →** on an initiative card, the launch modal opens.

### Step 2: Review/Edit Description (Product Users Only)

The modal shows:
- Initiative title (read-only)
- **Description field** (editable by Product users)
- Pipeline selection (Full / Small)

**If no description exists:**
```
Description (optional)     [Add description]
┌────────────────────────────────────────────────┐
│ No description provided                        │
└────────────────────────────────────────────────┘
```

**If description exists:**
```
Description (optional)     [Edit]
┌────────────────────────────────────────────────┐
│ Enable users to receive notifications when... │
│ (displays existing description)               │
└────────────────────────────────────────────────┘
```

### Step 3: Edit Description

Click **[Edit]** or **[Add description]** to open the textarea:

```
Description (optional)
┌─────────────────────────────────────────────────┐
│ Enable users to receive push notifications      │
│ when stock prices hit target thresholds.        │
│                                                  │
│ External API: CoinGecko (free tier: 50/min)     │
│                                                  │
│ [Save]  [Cancel]                                 │
└─────────────────────────────────────────────────┘
```

- **[Save]** — updates local DB and syncs to Airtable (if source is `airtable`)
- **[Cancel]** — reverts to original description

### Step 4: Launch Pipeline

After saving (or if no edits needed), select **Full Pipeline** or **Small Workflow** and click **Launch pipeline →**.

The workflow receives:
```typescript
goal = `${item.initiative}\n\n${description}`
```

Example:
```
Add Price Alerts

Enable users to receive push notifications when stock prices hit target thresholds.

External API: CoinGecko (free tier: 50 calls/min)
Existing infra: Node.js backend, PostgreSQL, no job queue yet.
```

## Airtable Sync

**If the initiative is sourced from Airtable:**
- Description update calls `PATCH /api/initiatives/:id/description`
- Local DB is updated first
- Airtable sync happens asynchronously (best-effort)
- If Airtable sync fails, local update still succeeds (logged as warning)
- Airtable receives: `{ fields: { "Description": "<new description>" } }`

**If the initiative is local-only:**
- Description update only affects local DB
- No Airtable call is made

## API Endpoint

```
PATCH /api/initiatives/:id/description
```

**Authorization:** Product role required

**Request:**
```json
{
  "description": "Enable users to receive push notifications..."
}
```

**Response:**
```json
{
  "success": true,
  "description": "Enable users to receive push notifications..."
}
```

**Errors:**
- `403` — Only Product users can edit descriptions
- `404` — Initiative not found
- `500` — Update failed

## Implementation Details

### Backend (`app/backend/src/routes/initiatives-routes.ts`)

**New endpoint:**
```typescript
router.patch('/:id/description', async (req: AuthRequest, res: Response) => {
  if (!isProductUser(req.user)) {
    return res.status(403).json({ error: 'Only Product users can edit initiative descriptions' });
  }

  // Update local DB
  db.prepare(`UPDATE items SET description = ?, updated_at = ? WHERE id = ?`)
    .run(trimmedDescription, now, req.params.id);

  // Sync to Airtable if source is 'airtable'
  if (row.source === 'airtable' && row.airtable_id) {
    const airtable = getAirtableClient();
    await airtable.updateItem(row.airtable_id, { description: trimmedDescription ?? '' });
  }

  res.json({ success: true, description: trimmedDescription });
});
```

### Frontend (`app/frontend/src/components/home/LaunchPipelineModal.tsx`)

**Enhanced modal:**
- Added `description` state (initialized from `item.description`)
- Added `isEditingDescription` toggle
- Product users see editable textarea before pipeline selection
- **[Save]** calls `api.updateItemDescription()`
- Toast notifications for save success/failure

**Frontend API (`app/frontend/src/services/api/initiatives.ts`):**
```typescript
async updateItemDescription(id: string, description: string): Promise<{ success: boolean; description: string | null }> {
  const response = await axios.patch(`${API_BASE_URL}/api/initiatives/${id}/description`, { description });
  return response.data;
}
```

## Role Restrictions

- **Product users** — can edit descriptions before launch
- **Tech Lead, Design, QA, Admin (non-Product)** — cannot edit descriptions (field hidden)
- **No-auth mode** — edit field is visible (no restrictions)

This matches the existing pattern: only Product users can **launch** workflows, so only Product users can **enrich** the goal input before launch.

## Benefits

✅ **Contextual enrichment** — Add details at the moment of launch  
✅ **Bi-directional sync** — Keeps Airtable and Product Hub in sync  
✅ **Agent-friendly input** — Description feeds directly into the workflow `goal`  
✅ **No document hunting** — Product users review/add context in one place  
✅ **Role-appropriate** — Only Product users (who launch workflows) can edit  

## Example: Before vs. After

**Before (insufficient context):**
```
Initiative: Add Price Alerts
Description: (empty)
```

Workflow agents receive:
```
goal = "Add Price Alerts"
```

**After (enriched context):**
```
Initiative: Add Price Alerts
Description:
  Enable users to receive push notifications when stock prices hit target thresholds.
  
  External API: CoinGecko (free tier: 50 calls/min)
  Existing infra: Node.js backend, PostgreSQL, no job queue yet.
  Constraint: Must support 100k active alerts with <60s latency
```

Workflow agents receive:
```
goal = "Add Price Alerts\n\nEnable users to receive push notifications when stock prices hit target thresholds.\n\nExternal API: CoinGecko (free tier: 50 calls/min)\nExisting infra: Node.js backend, PostgreSQL, no job queue yet.\nConstraint: Must support 100k active alerts with <60s latency"
```

Now the Analyst agent knows:
- **What external APIs to research** (CoinGecko pricing, rate limits)
- **What existing infrastructure matters** (Node.js patterns, PostgreSQL scale)
- **What constraints to validate against** (100k alerts, 60s latency)

The PRD, architecture, and story decomposition stages all inherit this context.
