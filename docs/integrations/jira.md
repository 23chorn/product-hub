# Jira Integration (Work Items)

Jira is used to push backlog structures (epics, stories, tasks) created by the AI agent into your Jira project as issues.

## When to use

Use Jira if your engineering team tracks work in Jira Cloud. If you use Azure DevOps instead, see [azure-devops.md](azure-devops.md). If you don't want automatic push, set `WORK_ITEMS_INTEGRATION=none`.

## Setup

### 1. Create an API token

1. Go to [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Create API token**, give it a label, and copy the value

### 2. Find your Jira host and project key

- **Host**: `https://yourorg.atlassian.net` (no trailing slash)
- **Project key**: the 2–5 character prefix shown in issue IDs (e.g. `PROJ` in `PROJ-123`)

### 3. Configure `.env`

```env
WORK_ITEMS_INTEGRATION=jira

JIRA_HOST=https://yourorg.atlassian.net
JIRA_EMAIL=you@yourorg.com
JIRA_API_TOKEN=your-api-token
JIRA_PROJECT_KEY=PROJ
```

### 4. Optional: customize issue types

If your Jira project uses custom issue type names, override them:

```env
JIRA_EPIC_TYPE=Epic
JIRA_STORY_TYPE=Story
JIRA_TASK_TYPE=Task
```

These default to standard Jira Software issue type names.

## How it works

When you press **Push to Jira** in the backlog preview:

1. An Epic is created from `backlog.epic`
2. For each feature, a Story is created with the Epic as parent
3. For each story under a feature, a Story is created with the Feature story as parent
4. Issue keys (e.g. `PROJ-42`) are returned and the Epic URL is shown in the UI

> **Note:** Jira's parent/child hierarchy depends on your project's issue type scheme. If you use team-managed projects, the hierarchy is flatter — epics contain stories directly.

## Troubleshooting

**401 Unauthorized** — Check that `JIRA_EMAIL` and `JIRA_API_TOKEN` are correct. The token authenticates as the email address owner.

**400 Bad Request / issue type not found** — The issue type name doesn't exist in your project. Check `JIRA_EPIC_TYPE`, `JIRA_STORY_TYPE`, `JIRA_TASK_TYPE` against your project's issue type scheme in Jira settings.

**Parent field errors** — The implementation uses the `parent` field (Jira Cloud REST API v3). Older Jira Server instances may use a different field for epic links.
