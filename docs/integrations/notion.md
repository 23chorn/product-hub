# Notion Integration (Knowledge Base)

Notion is used as a knowledge base source. Pages from a Notion database are fetched and injected into agent system prompts, giving agents access to your team's documentation.

## When to use

Use Notion if you maintain documentation in Notion that you want agents to reference during conversations. If you don't need this, set `KNOWLEDGE_BASE_INTEGRATION=none` (the default).

## Setup

### 1. Create a Notion integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **New integration**, give it a name (e.g. "Product AI Agent")
3. Set **Capabilities**: Read content is sufficient
4. Copy the **Internal Integration Secret** (starts with `secret_…`)

### 2. Connect the integration to your database

1. Open the Notion database you want to expose
2. Click **…** (top right) → **Add connections** → select your integration
3. Pages in this database will now be readable by the integration

### 3. Find your database ID

Open the database in the browser. The URL format is:

```
https://www.notion.so/{workspace}/{databaseId}?v=...
```

The database ID is the 32-character hex string before the `?v=` query parameter.

### 4. Configure `.env`

```env
KNOWLEDGE_BASE_INTEGRATION=notion

NOTION_API_KEY=secret_...
NOTION_DATABASE_ID=your-database-id
```

## How it works

On the first agent message after server start, the app queries your Notion database, fetches all pages (title + text content), and injects them into the agent's system prompt under a `## Knowledge Base` section. Pages are cached for the session; restart the server to refresh.

Only text-type blocks are extracted (paragraphs, headings, bullets, etc.). Inline databases, images, and files within pages are skipped.

## Tips

- Keep the database focused. Only include pages that are genuinely useful for the agent to know. Every page adds to input tokens on every request.
- Use page titles that describe the content clearly — the agent uses titles to orient itself.
- For large knowledge bases, consider splitting into multiple smaller databases and only connecting the most relevant one.

## Troubleshooting

**403 / object_not_found** — The integration is not connected to the database. Go to the database in Notion and add the connection via the **…** menu.

**No pages returned** — Check that `NOTION_DATABASE_ID` is correct and the database has at least one page that the integration can access.
