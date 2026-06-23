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

## 2. Agent config (in-app **Settings** panel)

Controls how agents address you and what language they use. Edit these in the
app's **Settings** panel (they persist to the database, not a file):

- `name` — agents greet you by this name
- `projectName` — used in document titles and references
- `skillLevel` — `beginner | intermediate | expert`; affects how much explanation agents provide
- `communicationLanguage` — language agents use when talking to you

The same panel also holds sprint planning (velocity, capacity factor, AI-assist
toggle) and the pipeline stage on/off switches.

---

## 3. Agent personas (`agents/personas/`) — optional

Each agent has a persona markdown file that defines its role, tone, and
behavior. You can edit these to adjust how agents communicate. `agents/personas/`
has one file per agent — see the **Specialist agents** list in the root
[README.md](../README.md) for the current persona roster (Sage, Rex, Atlas,
Apex, Shard + platform engineers, Nova, Luma, Cass, Discovery Scout, Critic,
Curator, Context Keeper). A few worth knowing by name:

| File | Agent | What it controls |
|------|-------|------------------|
| `pm.md` | PM Strategy (Rex) | PRD writing style |
| `analyst.md` | Analyst (Sage) | Research depth, analysis approach |
| `architect.md` | Architect (Atlas) | Architecture design approach |
| `coordinator.md` | Coordinator (Chief of Staff) | Goal decomposition, planning style |
| `story-decomposition.md` | Story team (Shard) | Backlog/story writing style |
| `critic-core.md` | Critic (Flint) | Review identity, output format, severity calibration (shared across every stage) |
| `critic-<stage>.md` (e.g. `critic-prd.md`, `critic-backlog.md`) | Critic (Flint) | Stage-specific review checks layered on top of `critic-core.md` |
| `curator.md` | Context Curator (Ivy) | How context files are updated |

Most users will not need to change these. Edit them if you want to shift the
tone (e.g., more concise, more formal) or add domain-specific instructions.
Personas can also be edited from the UI — click **Knowledge Studio → Agents**.

---

## 4. Output templates (`agents/templates/`) — optional

Templates define the structure of documents agents produce:

| File | Output |
|------|--------|
| `research.template.md` | Research/analysis report (Analyst) |
| `prd.template.md` | Product Requirements Document (PM Strategy) |
| `epic-features.template.md` | Epic + feature shells (Epic Feature Planner) |
| `architecture.template.md` | Solution architecture document (Architect) |
| `backlog.template.md` | Stories with acceptance criteria (Story Decomposition team) |
| `prototype.template.md` | Wireframe prototype spec (Prototype Builder) |
| `figma-design.template.md` | Figma design brief (Figma Designer) |
| `discovery.template.md` | Opportunity drafts (Discovery Scout) |
| `doc-review.template.md` | Documentation review comments (Doc Reviewer) |

Edit these to match your team's preferred document format. The section headings
and structure guide the agent's output — keep the overall shape but adjust
headings, add sections, or remove ones you don't need.

Templates can also be edited from the UI — click **Knowledge Studio → Agents**,
select a persona, and switch to its Template tab. Saves require
double-confirmation since changes affect all future outputs.

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
`PROVIDER_MODELS` in `app/backend/src/utils/model-config.ts` (re-exported from
`ai-provider.ts`, but defined there).

---

## 6. Integrations (`.env`) — optional

By default all integrations are disabled (`none`). Enable them by changing the
integration flags and adding the required credentials:

```bash
# Roadmap source — where initiatives come from
ROADMAP_INTEGRATION=none        # none | airtable

# Work item tracker — where backlog items are pushed
WORK_ITEMS_INTEGRATION=none     # none | ado

# Knowledge base — where drafts are auto-published (Azure Wiki only; reuses ADO credentials)
KNOWLEDGE_BASE_INTEGRATION=none # none | azure_wiki
```

See `.env.example` for the full list of credentials needed for each integration.
