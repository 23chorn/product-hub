# Full Pipeline Integration Plan
## From Product Hub → Azure DevOps → Claude Code → Real Tests

---

## Vision

When a backlog ticket is approved in Product Hub and pushed to Azure DevOps, an automated pipeline triggers. Claude Code clones the relevant repos, reads the ticket context and architecture docs, writes the implementation, creates a PR, and runs the QA test cases Vera wrote — on real iOS, Android, and web platforms. The developer reviews a PR that is already ~70% done, with test results attached.

---

## Is This Realistic?

**Yes.** None of this requires technology that doesn't exist. The confidence breakdown:

| Piece | Confidence | Notes |
|-------|-----------|-------|
| ADO ticket tag → pipeline trigger | High | ADO service hooks, standard feature |
| `claude --print` in CI pipeline | High | CLI works headlessly, already used in this app |
| Claude Code creating a PR | High | `gh pr create` or ADO REST API |
| Playwright / web tests in pipeline | High | Any Linux agent, no special setup |
| Android emulator / Firebase Test Lab | Medium | KVM on Linux agents or Firebase offload |
| Claude Code multi-repo context | Medium | Works, but needs careful prompt engineering |
| iOS Simulator in CI | Lower | Requires macOS agents (expensive) or self-hosted Mac Minis |
| Vera test case IDs → runnable test code | Lower | Needs BDD framework setup or Claude to write test files |

---

## Phase 1 — Backend API + Web (2–4 weeks)
*Lowest risk. One repo. No mobile.*

### 1.1 — ADO service hook

In Azure DevOps: **Project Settings → Service hooks → Create subscription**

- Trigger: *Work item updated*
- Filter: `Tags contains ai-ready` AND `State = Active`
- Action: *Trigger an Azure Pipeline* (or HTTP POST to your app's webhook endpoint)

This fires whenever a developer tags a ticket `ai-ready` and moves it to Active — the signal that it's been reviewed and is ready for Claude Code.

### 1.2 — Pipeline YAML (`azure-pipelines/ai-coding.yml`)

```yaml
trigger: none
resources:
  pipelines:
    - pipeline: workItemTrigger

variables:
  - group: claude-secrets  # ANTHROPIC_API_KEY stored here

pool:
  vmImage: ubuntu-latest

steps:
  - checkout: self

  - script: npm install -g @anthropic-ai/claude-code
    displayName: Install Claude Code CLI

  - script: |
      # Pull ticket context from Product Hub
      CONTEXT=$(curl -s "$PRODUCT_HUB_URL/api/workflow/$WORKFLOW_ID/ticket-context?workItemId=$WORK_ITEM_ID")

      # Run Claude Code with ticket context injected via stdin
      echo "$CONTEXT" | claude --print \
        --allowedTools Read,Bash,Edit,Glob,Grep,Write \
        --max-turns 25 \
        --no-color \
        --output-format json > claude-output.json

      # Create PR
      BRANCH="feat/$(echo $WORK_ITEM_TITLE | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | cut -c1-50)"
      git checkout -b $BRANCH
      git add -A
      git commit -m "feat: $WORK_ITEM_TITLE [ADO#$WORK_ITEM_ID]"
      git push origin $BRANCH
      gh pr create \
        --title "feat: $WORK_ITEM_TITLE" \
        --body "$(cat claude-output.json | jq -r '.summary')" \
        --label "ai-generated"
    displayName: Claude Code implementation
    env:
      ANTHROPIC_API_KEY: $(ANTHROPIC_API_KEY)
      GH_TOKEN: $(GH_TOKEN)

  - script: npx playwright test --reporter=json > playwright-results.json
    displayName: Run web tests

  - script: |
      curl -X POST "$PRODUCT_HUB_URL/api/workflow/$WORKFLOW_ID/pipeline-result" \
        -H "Content-Type: application/json" \
        -d "$(cat playwright-results.json)"
    displayName: Report results back to Product Hub
```

### 1.3 — Ticket context endpoint (`GET /api/workflow/:id/ticket-context`)

New backend endpoint that assembles the prompt Claude Code receives:

```typescript
// Returns a structured prompt string containing:
// 1. The backlog story (title, acceptance criteria, story points)
// 2. The PRD section relevant to this feature
// 3. The architecture decisions from Atlas's output
// 4. The tech stack (from context/tech-stack.md)
// 5. Vera's QA test cases for this story (as "expected behaviour" hints)
// 6. Instruction: create a branch, implement, write tests matching TC-XXX IDs, commit
```

The `ado_work_item_map` table already maps work item IDs to workflow + story keys. Use this to look up the right story and its parent workflow's artifacts.

### 1.4 — Results callback (`POST /api/workflow/:id/pipeline-result`)

Receives the test run JSON from the pipeline. Stores in a new `pipeline_runs` table. The `PipelineStatusSection` component polls this instead of running mock timers.

```sql
CREATE TABLE pipeline_runs (
  id          INTEGER PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  pr_url      TEXT,
  branch      TEXT,
  pipeline_id TEXT,
  status      TEXT NOT NULL DEFAULT 'running',  -- running | complete | failed
  test_results TEXT,  -- JSON
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

---

## Phase 2 — Android + Firebase Test Lab (4–6 weeks)

### 2.1 — BDD test framework (React Native)

Add [Detox](https://wix.github.io/Detox/) + [Cucumber.js](https://cucumber.io/docs/installation/javascript/) to the mobile repo.

Vera's test cases map to Gherkin features. The key convention: step definitions are named to match Vera's test case IDs. Claude Code is instructed to write the step implementations alongside feature code:

```gherkin
# features/TC-001-send-message.feature
Feature: Send a message in a chat room
  Scenario: TC-001 User can send a message
    Given I am logged in as a verified trader
    When I open a chat room and type "AAPL looks bullish"
    And I tap Send
    Then the message appears in the chat within 2 seconds
```

The pipeline runs these and reports pass/fail against TC-IDs that match Vera's artifact — closing the loop.

### 2.2 — Firebase Test Lab (avoids managing emulators)

```yaml
- script: |
    cd android && ./gradlew assembleDebug assembleAndroidTest
    gcloud firebase test android run \
      --type instrumentation \
      --app app/build/outputs/apk/debug/app-debug.apk \
      --test app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk \
      --device model=Pixel6,version=33,locale=en,orientation=portrait \
      --results-bucket gs://your-bucket/test-results \
      --results-dir "$BUILD_ID"
    gsutil cp gs://your-bucket/test-results/$BUILD_ID/test_result_merged.xml ./android-results.xml
  displayName: Android tests on Firebase Test Lab
```

Firebase Test Lab costs ~$1–5 per test run and handles device lifecycle. Far more reliable than managing emulators in CI.

### 2.3 — Map Firebase XML to Vera IDs

Firebase returns JUnit XML. Parse it to extract test names (which include TC-IDs by convention from step 2.1). Match to `qa_tests` artifact and report structured results to Product Hub.

---

## Phase 3 — iOS + macOS Agents (6–10 weeks)

### 3.1 — Self-hosted macOS agent pool

Azure-hosted macOS agents cost ~10× Linux. For a permanent setup, register Mac Mini(s) as self-hosted agents:

```bash
# On each Mac Mini:
mkdir agent && cd agent
curl -O https://vstsagentpackage.azureedge.net/agent/3.x.x/vsts-agent-osx-arm64-3.x.x.tar.gz
tar zxvf vsts-agent-osx-*.tar.gz
./config.sh --url https://dev.azure.com/your-org --auth pat --token $PAT
./run.sh &  # or install as a service
```

Pre-install: Xcode, iOS simulators, Homebrew, Node.

### 3.2 — XCUITest + Cucumber wrappers

Use [cucumberish](https://github.com/Ahmed-Ali/Cucumberish) or write a thin Swift BDD runner that maps Gherkin steps to `XCUITest` calls. Same TC-ID convention as Android.

```yaml
- script: |
    xcodebuild test \
      -workspace App.xcworkspace \
      -scheme AppTests \
      -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.0' \
      -resultBundlePath TestResults.xcresult \
      | tee xcode-output.txt
    xcrun xcresulttool get --format json --path TestResults.xcresult \
      > ios-results.json
  displayName: iOS Simulator tests
```

### 3.3 — Parallel execution

All three platform jobs run in parallel — iOS, Android, Backend — using ADO pipeline stages with `dependsOn: []`. Total wall time is the slowest platform, not the sum.

```yaml
stages:
  - stage: Implementation
    jobs: [ClaudeCode]
  - stage: Testing
    dependsOn: Implementation
    jobs:
      - job: iOS       # macOS agent
      - job: Android   # Linux agent + Firebase
      - job: Backend   # Linux agent + Playwright
  - stage: Report
    dependsOn: Testing
    jobs: [ReportToProductHub]
```

---

## Phase 4 — Closed Loop + Review UX (2–3 weeks)

### 4.1 — Real-time status in Product Hub

Replace the timed mock in `PipelineStatusSection` with a live SSE endpoint that streams pipeline events:

```typescript
// GET /api/workflow/:id/pipeline-live (SSE)
// Polls ADO pipeline API and streams events as they happen:
// { type: 'stage_update', stage: 'cloning', status: 'complete' }
// { type: 'test_result', testId: 'TC-003', passed: true }
// { type: 'pr_created', url: 'https://dev.azure.com/...' }
```

### 4.2 — PR link

The `pipeline_runs.pr_url` replaces the `href="#"` placeholder in `PipelineStatusSection`. One click opens the real PR in ADO.

### 4.3 — Failed test → Claude Code Studio

When a test fails, the failure message + stack trace is shown in-app. The "Fix with Claude Code" button opens Claude Code Studio pre-loaded with:
- The failing test name and error
- The relevant source files
- Vera's original acceptance criteria

The developer can ask Claude to debug without leaving Product Hub.

### 4.4 — Deployment signal (closing the loop)

When the PR is merged, ADO fires a webhook back. Product Hub marks the workflow as deployed. The initiative card shows "Shipped" status. The full cycle — from typed goal to deployed feature — is tracked in one place.

---

## What to Build First

**Phase 1, steps 1.1–1.3** is the quickest path to a non-mocked demo. It requires:

- One ADO service hook (10 minutes to configure)
- One pipeline YAML file
- One new backend endpoint to assemble the Claude Code prompt

The result: a real ADO ticket triggers real Claude Code, makes real code changes, creates a real PR, and Playwright results appear in Product Hub. That's compelling to stakeholders without any mobile infrastructure.

**The Vera → runnable tests mapping (step 2.1)** is the design decision to nail early, because the TC-ID naming convention needs to be established before any test infrastructure is built. Once it's agreed, iOS, Android, and web can all adopt it independently.

---

## Open Questions

1. **Multi-repo feature spans** — if a feature touches iOS, Android, and backend, Claude Code needs to create three branches and three PRs. How should these be coordinated? Option: one "orchestrator" pipeline spawns three parallel `claude --print` subprocesses, each pointed at a different repo clone.

2. **Claude Code prompt size** — injecting the full PRD + architecture doc + test cases into stdin can exceed context limits for large features. Solution: inject only the specific story's section of each artifact, not the full document.

3. **Compliance for financial apps** — MiFID II record-keeping, FCA rules on automated trading. Any AI-generated code that touches trade execution, order routing, or compliance logging needs human sign-off before merge. The PR review step should flag these paths explicitly.

4. **ADO story type** — the current `AZURE_DEVOPS_STORY_TYPE` env var defaults to "User Story". The `ai-ready` tag convention needs to be documented so teams know what triggers the pipeline.
