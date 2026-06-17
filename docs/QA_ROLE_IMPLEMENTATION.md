# QA Role Implementation

## Overview
This document describes the implementation of the QA role and the requirement for QA approval on test plan stages.

## Changes Made

### 1. Database Migration (`db/migrations/0005_qa_role_and_stage_approvals.sql`)
- Added a new `qa` role to the `roles` table with description "QA Engineers — approve test plans and quality assurance stages"
- Mapped the following stages to require the `qa` role for approval:
  - `qa_engineer` (base QA stage)
  - `qa_engineer_F1` (QA tests for Feature 1)
  - `qa_engineer_F2` (QA tests for Feature 2)
  - `qa_engineer_F3` (QA tests for Feature 3)

### 2. Backend Changes

#### User Management (`app/backend/src/scripts/seed-users.ts`)
- Added a new sample user `qa` (Quinn QA) with the `qa` role
- Updated the `admin` user to include the `qa` role alongside existing roles

#### Skill Routes (`app/backend/src/routes/skill-routes.ts`)
- Changed the `qa_engineer` skill edit permission from `['tech_lead']` to `['qa']`
- This ensures only users with the QA role (or admins) can edit QA engineer agent configurations

### 3. Frontend Changes

#### Auth Store (`app/frontend/src/stores/authStore.ts`)
- Added `qa: 'QA'` to the `ROLE_LABELS` constant
- This allows the QA role to be displayed in user management interfaces

#### User Management Panel (`app/frontend/src/components/settings/UserManagementPanel.tsx`)
- Added QA engineer stages to the `STAGE_ROLE_STAGES` array:
  - `qa_engineer`
  - `qa_engineer_F1`
  - `qa_engineer_F2`
  - `qa_engineer_F3`
- This enables administrators to configure role requirements for these stages in the UI

#### Stage Labels (`app/frontend/src/constants/stage-labels.ts`)
- Added `qa_engineer: 'QA Engineer — Vera'` to `STAGE_LABELS_BASE`
- Added `qa_engineer: 'QA Tests'` to `STAGE_SHORT_LABELS_BASE`
- Enhanced the proxy handlers to map dynamic QA stages (`qa_engineer_F1`, etc.) to appropriate labels

## How It Works

### Checkpoint Approval Flow
1. When a `qa_engineer` stage completes, a checkpoint is created with `required_role` set to `["qa"]`
2. The checkpoint approval middleware (`canApproveCheckpoint` in `app/backend/src/middleware/auth.ts`) checks if the current user has the `qa` role
3. If the user lacks the required role and is not an admin, the approval request is rejected with a 403 error
4. Users with the `qa` role (or admins) can approve, reject, or request revisions to the QA test plan

### Stage-Role Mapping
The `stage_roles` table maintains the mapping between stages and required roles. After this migration:
- `qa_engineer` → requires `qa` role
- `qa_engineer_F1` → requires `qa` role
- `qa_engineer_F2` → requires `qa` role
- `qa_engineer_F3` → requires `qa` role

### User Assignment
To grant QA approval permissions to a user:
1. Navigate to Settings → Access → Users tab
2. Select the user to edit
3. Add the `qa` role to their role assignments
4. Save the changes

Alternatively, create a new user with the `qa` role using the "New User" form.

## Testing

### Sample User Credentials
After running the seed script (`npx tsx app/backend/src/scripts/seed-users.ts`), the following test account is available:

- **Username**: `qa`
- **Name**: Quinn QA
- **Password**: `password123`
- **Roles**: `qa`

### Verification Steps
1. Start a workflow that includes QA engineer stages
2. When the QA stage completes and creates a checkpoint, log in as a user **without** the `qa` role (e.g., `product` or `design`)
3. Attempt to approve the checkpoint — you should receive a 403 error indicating the `qa` role is required
4. Log in as the `qa` user (or `admin`)
5. Approve the checkpoint — it should succeed

## Related Files

### Backend
- `db/schema.ts` — Schema definitions for `roles`, `stage_roles`, `checkpoints`
- `app/backend/src/data/users.ts` — User and role management functions
- `app/backend/src/middleware/auth.ts` — `canApproveCheckpoint()` authorization logic
- `app/backend/src/routes/workflow-routes.ts` — Checkpoint approval endpoint (`POST /api/workflow/checkpoint/:id/resolve`)
- `agents/personas/qa-engineer.md` — Vera the QA Engineer persona

### Frontend
- `app/frontend/src/stores/authStore.ts` — Role labels and authorization helpers
- `app/frontend/src/components/settings/UserManagementPanel.tsx` — User and stage-role configuration UI
- `app/frontend/src/constants/stage-labels.ts` — Display labels for QA stages

## Migration Execution
The migration runs automatically on server startup via the Drizzle migration system. To manually verify:

```bash
# Check that the migration has been applied
sqlite3 db/product-ops.db "SELECT * FROM __drizzle_migrations WHERE tag = '0005_qa_role_and_stage_approvals';"

# Check that the qa role exists
sqlite3 db/product-ops.db "SELECT * FROM roles WHERE name = 'qa';"

# Check that QA stages are mapped to the qa role
sqlite3 db/product-ops.db "SELECT * FROM stage_roles WHERE role_name = 'qa';"
```

## Future Enhancements
- Add Slack notifications when QA approval is required
- Create a dedicated QA dashboard showing all pending test plan approvals
- Support role-based filtering in the workflows list (e.g., "Show me all workflows awaiting my approval")
