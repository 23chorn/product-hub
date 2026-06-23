# Azure DevOps Integration (Work Items)

Azure DevOps (ADO) is used to push backlog structures (epics, features, stories) created by the AI agent directly into your ADO project as work items.

## When to use

Use ADO if your engineering team tracks work in Azure DevOps — it's currently the only supported work-item tracker. If you don't want automatic push, set `WORK_ITEMS_INTEGRATION=none` — the "Push to ADO" button will be hidden and you can export backlog JSON manually.

## Setup

### 1. Create a Personal Access Token (PAT)

1. In Azure DevOps, go to **User Settings → Personal Access Tokens**
2. Click **New Token**
3. Scopes required: **Work Items → Read & Write**
4. Set expiry as appropriate for your team
5. Copy the token immediately (it won't be shown again)

### 2. Find your organization and project

- **Organization**: the subdomain in `https://dev.azure.com/{org}/`
- **Project**: the project name visible in the URL after the org

### 3. Configure `.env`

```env
WORK_ITEMS_INTEGRATION=ado

AZURE_DEVOPS_ORG=your-org-name
AZURE_DEVOPS_PROJECT=YourProject
AZURE_DEVOPS_PAT=your-pat-here
```

Both the plain org name (`myorg`) and the full URL (`https://dev.azure.com/myorg`) are accepted for `AZURE_DEVOPS_ORG`.

### 4. Optional: customize work item types

If your ADO project uses a custom process template, override the work item type names:

```env
AZURE_DEVOPS_EPIC_TYPE=Epic
AZURE_DEVOPS_FEATURE_TYPE=Feature
AZURE_DEVOPS_STORY_TYPE=User Story
AZURE_DEVOPS_TASK_TYPE=Task
```

These default to the Agile process template values shown above.

## How it works

When you press **Push to ADO** in the backlog preview:

1. The app creates one Epic from `backlog.epic`
2. For each entry in `backlog.features`, it creates a Feature linked to the Epic
3. For each story under a feature, it creates a User Story linked to the Feature
4. IDs and the Epic URL are written back to the Airtable row (if Airtable integration is active)

## Troubleshooting

**401 Unauthorized** — PAT has expired or lacks Work Items write scope. Regenerate it.

**400 Bad Request** — Work item type name doesn't match your process template. Check `AZURE_DEVOPS_EPIC_TYPE` etc.

**Parent link errors** — The project may use a different hierarchy. Check your process template type in ADO project settings.
