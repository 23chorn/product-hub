# Customizing the Product Automation Pipeline

After running `./scripts/setup.sh`, customize these files to make the pipeline
work for your product. Listed in priority order — the first two are essential,
the rest are optional.

---

## 1. Product knowledge (`context/`)

These files are injected into every agent's system prompt, so agents understand
your product, company, and strategy without you repeating it each session.

### `context/company.md` (required)

Describe your company, team, customers, and business model. The example file
created by setup has a template to follow. Key sections:

- Company overview and mission
- Target customers and user personas
- Business model and revenue streams
- Team structure relevant to product decisions

### `context/strategy.md` (required)

Capture your current product strategy. Key sections:

- North-star metric
- Current OKRs or quarterly goals
- Roadmap themes and priorities
- Known constraints or trade-offs

### Additional context files (optional)

Drop any `.md` file into `context/` and it will be picked up automatically
(restart the server after adding). Useful additions:

| File | What to put in it |
|------|-------------------|
| `tech-stack.md` | Frontend, backend, infrastructure, key libraries |
| `db-schema.md` | Database tables and relationships |
| `process.md` | Dev lifecycle, definition of ready/done, release cadence |
| `current-state.md` | Active work, known debt, recent releases |

See `context/README.md` for detailed guidelines on each file.

---

## 2. Agent config (`agents/config.yaml`)

Controls how agents address you and what language they use:

```yaml
user_name: Your Name
communication_language: English
document_output_language: English
project_name: My Product
user_skill_level: intermediate   # beginner | intermediate | expert
```

- `user_name` — agents greet you by this name
- `project_name` — used in document titles and references
- `user_skill_level` — affects how much explanation agents provide

---

## 3. Agent personas (`agents/personas/`) — optional

Each agent has a persona markdown file that defines its role, tone, and
behavior. You can edit these to adjust how agents communicate:

| File | Agent | What it controls |
|------|-------|------------------|
| `pm.md` | PM Strategy & PM Backlog | PRD writing style, backlog format |
| `analyst.md` | Research Analyst | Research depth, analysis approach |
| `coordinator.md` | Coordinator | Goal decomposition style |
| `critic.md` | Critic | Review strictness and severity |
| `curator.md` | Context Curator | How context files are updated |

Most users will not need to change these. Edit them if you want to shift the
tone (e.g., more concise, more formal) or add domain-specific instructions.

---

## 4. Output templates (`agents/templates/`) — optional

Templates define the structure of documents agents produce:

| File | Output |
|------|--------|
| `prd.template.md` | Product Requirements Document |
| `backlog.template.md` | Epic and story backlog |
| `research.template.md` | Research/analysis report |
| `product-brief.template.md` | Product brief |

Edit these to match your team's preferred document format. The section headings
and structure guide the agent's output — keep the overall shape but adjust
headings, add sections, or remove ones you don't need.

---

## 5. AI provider (`.env`)

The `.env` file controls which AI provider agents use:

```bash
# Free local inference (default)
AI_PROVIDER=ollama

# Anthropic direct API
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...

# AWS Bedrock
AI_PROVIDER=bedrock
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

**Cost tiers:**

| Tier | Provider | Approx. cost | Use case |
|------|----------|-------------|----------|
| 0 | Ollama (local) | Free | Pipeline testing, development |
| 1 | Anthropic Haiku | ~$0.001/run | Output quality checks |
| 2 | Anthropic Sonnet/Opus | ~$0.05-0.20/run | Final acceptance runs |

The model is selected at runtime from the UI header dropdown — you do not need
to set a model in `.env`. To add or remove models from the dropdown, edit
`PROVIDER_MODELS` in `app/backend/src/utils/ai-provider.ts`.

---

## 6. Integrations (`.env`) — optional

By default all integrations are disabled (`none`). Enable them by changing the
integration flags and adding the required credentials:

```bash
# Roadmap source — where initiatives come from
ROADMAP_INTEGRATION=none        # none | airtable

# Work item tracker — where backlog items are pushed
WORK_ITEMS_INTEGRATION=none     # none | ado | jira

# Knowledge base — where PRDs are published
KNOWLEDGE_BASE_INTEGRATION=none # none | notion
```

See `.env.example` for the full list of credentials needed for each integration.
