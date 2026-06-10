# Product Hub — System Flow Diagrams

## 1 · Current State: Full Pipeline with Integrations

```mermaid
flowchart TD
    %% ── Input layer ───────────────────────────────────────────────────────────
    AT_IN[("Airtable\nRoadmap")]
    LOCAL["Product Hub UI\nNew Initiative"]
    WEBHOOK["Demo Webhook\nPOST /api/demo/webhook/trigger"]

    %% ── Coordinator planning ──────────────────────────────────────────────────
    subgraph PLAN ["🧠 Coordinator Planning  ·  ≤ 3 message rounds"]
        CTX_FILES["Context Files\ncompany.md · strategy.md\ncurrent-state.md · tech-stack.md\ndb-schema.md · process.md"]
        COORD["Coordinator Agent\n(Chief of Staff)"]
        STAGE_SEL["User configures\nstage sequence"]
    end

    %% ── Pipeline ──────────────────────────────────────────────────────────────
    subgraph PIPELINE ["⚙️  Autonomous Pipeline"]

        subgraph S1 ["Stage 1 · Analyst"]
            direction LR
            A_AG["Specialist Agent\n+ Critic\n(auto-revise ≤ 1×)"]
            A_ART[/"Research Brief\n.md artifact"/]
            A_CP(["⏸ Checkpoint\nhuman review"])
        end

        subgraph S2 ["Stage 2 · PM – PRD"]
            direction LR
            P_AG["Specialist Agent\n+ Critic\n(auto-revise ≤ 1×)"]
            P_ART[/"PRD Document\n.md artifact"/]
            P_CP(["⏸ Checkpoint\nhuman review"])
        end

        subgraph S3 ["Stage 3 · Solution Architect"]
            direction LR
            SA_AG["Specialist Agent\n+ Critic\n(auto-revise ≤ 1×)"]
            SA_ART[/"Architecture Doc\n.md artifact"/]
            SA_CP(["⏸ Checkpoint\nhuman review"])
        end

        subgraph S4 ["Stage 4 · PM – Backlog"]
            direction LR
            B_AG["Specialist Agent\n+ Critic\n(auto-revise ≤ 1×)"]
            B_ART[/"Backlog JSON\n+ sprint estimates"/]
            B_CP(["⏸ Checkpoint\nhuman review"])
        end

        subgraph S5 ["Stage 5 · Context Curator  (silent — no human gate)"]
            direction LR
            CU_AG["Curator Agent"]
            CU_DIFFS[/"Context Diffs\n(proposed edits to context/*.md)"/]
            CTX_UPDATED["Context files\nupdated on disk\ncache invalidated"]
        end

    end

    %% ── Integration targets ───────────────────────────────────────────────────
    subgraph INT ["🔗  External Integrations"]
        direction TB
        WIKI[("ADO Wiki\nProduct Documentation/\nFeatures/{Name}/…")]
        BOARD[("ADO Boards\nEpic → Features → Stories")]
        SLACK_N(["Slack\nIncoming Webhook"])
        AT_OUT[("Airtable\nRecord — link fields")]
    end

    %% ── Post-completion ───────────────────────────────────────────────────────
    subgraph POST ["✅  Post-Completion"]
        direction TB
        CR["Change Request\n(targeted stage reruns)"]
        PROTO["Prototype Generator\n(React sandbox)"]
    end

    DONE(("🏁 Workflow\nComplete"))

    %% ── Edges: input → planning ───────────────────────────────────────────────
    AT_IN -->|"initiatives pulled\non demand"| LOCAL
    LOCAL --> COORD
    CTX_FILES -. "loaded into\nsystem prompt" .-> COORD
    COORD --> STAGE_SEL
    STAGE_SEL -->|"POST /api/workflow/start"| A_AG
    WEBHOOK -->|"skip coordinator\nauto-launch all stages"| A_AG

    %% ── Pipeline internal flow ────────────────────────────────────────────────
    A_AG --> A_ART --> A_CP
    A_CP -->|"✓ approved"| P_AG
    P_AG --> P_ART --> P_CP
    P_CP -->|"✓ approved"| SA_AG
    SA_AG --> SA_ART --> SA_CP
    SA_CP -->|"✓ approved"| B_AG
    B_AG --> B_ART --> B_CP
    B_CP -->|"✓ approved"| CU_AG
    CU_AG --> CU_DIFFS --> CTX_UPDATED --> DONE

    %% ── Context fed into downstream stages ───────────────────────────────────
    A_ART -. "research brief\ninjected into brief" .-> P_AG
    P_ART -. "PRD injected\ninto brief" .-> SA_AG
    P_ART -. "PRD injected\ninto brief" .-> B_AG
    SA_ART -. "architecture\ninjected into brief" .-> B_AG

    %% ── Wiki publishing (on checkpoint approval) ──────────────────────────────
    A_CP -->|"PUT wiki page\nResearch Brief"| WIKI
    P_CP -->|"PUT wiki page\nPRD"| WIKI
    SA_CP -->|"PUT wiki page\nArchitecture"| WIKI

    %% ── Airtable link pushbacks ───────────────────────────────────────────────
    A_CP -->|"PATCH researchBriefLink"| AT_OUT
    P_CP -->|"PATCH prdLink"| AT_OUT
    SA_CP -->|"PATCH architectureLink"| AT_OUT

    %% ── Board push (on backlog approval) ─────────────────────────────────────
    B_CP -->|"POST push-to-board\nEpic / Features / Stories"| BOARD
    BOARD -->|"PATCH epicLink\n+ story IDs stored"| AT_OUT

    %% ── Slack notifications ───────────────────────────────────────────────────
    A_CP -->|"checkpoint pending"| SLACK_N
    P_CP -->|"checkpoint pending"| SLACK_N
    SA_CP -->|"checkpoint pending"| SLACK_N
    B_CP -->|"checkpoint pending"| SLACK_N
    WIKI -->|"page published"| SLACK_N
    DONE -->|"workflow complete"| SLACK_N

    %% ── Post-completion ───────────────────────────────────────────────────────
    DONE --> CR
    DONE --> PROTO
    CR -->|"targeted stage reruns\ncheckpoints for changed stages"| PIPELINE

    %% ── Styling ───────────────────────────────────────────────────────────────
    classDef external fill:#1e3a5f,stroke:#3b82f6,color:#93c5fd
    classDef artifact fill:#1a3a2a,stroke:#22c55e,color:#86efac
    classDef checkpoint fill:#3b2a00,stroke:#f59e0b,color:#fde68a
    classDef agent fill:#1e1b4b,stroke:#818cf8,color:#c7d2fe
    classDef terminal fill:#1a1a1a,stroke:#6b7280,color:#e5e7eb
    classDef slack fill:#2d1b4e,stroke:#a78bfa,color:#ddd6fe

    class AT_IN,AT_OUT,WIKI,BOARD external
    class A_ART,P_ART,SA_ART,B_ART,CU_DIFFS artifact
    class A_CP,P_CP,SA_CP,B_CP checkpoint
    class A_AG,P_AG,SA_AG,B_AG,CU_AG,COORD agent
    class DONE terminal
    class SLACK_N slack
```

---

## 2 · Goal State: Adding Claude Code + Automated Testing

The additions below extend the post-approval board push into a full code-generation and test-validation loop.

```mermaid
flowchart TD
    %% ── Shared with current state ─────────────────────────────────────────────
    BOARD[("ADO Boards\nEpic → Features → Stories\n+ Work Item IDs stored")]
    BACKLOG_JSON[/"Approved Backlog JSON\n(stories · ACs · effort)"/]
    DONE(("🏁 Workflow Complete\n(current state)"))

    %% ── Claude Code Studio entry ──────────────────────────────────────────────
    subgraph STUDIO ["⚡ Claude Code Studio  (new)"]
        direction TB
        WS_CONN["WebSocket\n/ws/ai-coding?workflowId=…"]

        subgraph CTX_LOAD ["Context Assembly"]
            direction LR
            WF_GOAL["Workflow goal\n+ PRD summary"]
            BACKLOG_CTX["Backlog stories\n(acceptance criteria)"]
            ADO_TICKETS["ADO ticket IDs\n+ URLs pulled from\nado_work_item_map"]
        end

        CLAUDE_CLI["claude --print\n--allowedTools Read,Bash,Glob,Grep\n--max-turns 8\n(spawned as child process)"]

        subgraph IMPL ["Implementation Loop"]
            direction LR
            READ_CODE["Read existing\ncodebase"]
            WRITE_CODE["Write / edit\nsource files"]
            RUN_BUILD["Run build\n+ lint checks"]
        end
    end

    %% ── Test runner ───────────────────────────────────────────────────────────
    subgraph TESTING ["🧪 Automated Test Validation  (goal state)"]
        direction TB
        TEST_TRIGGER["Test suite triggered\nafter implementation"]

        subgraph TEST_TYPES ["Test Types"]
            direction LR
            UNIT["Unit Tests\n(Vitest)"]
            INTEGRATION["Integration Tests\nairtable · bedrock · ado"]
            E2E["E2E / Smoke Tests"]
        end

        TEST_RESULTS{{"Test Results\nPass / Fail / Partial"}}
    end

    %% ── Feedback & sync ───────────────────────────────────────────────────────
    subgraph FEEDBACK ["🔄 Feedback & Sync"]
        direction TB
        PASS_PATH["✅ All tests pass\nmark ADO stories Done\npost summary to Slack"]
        FAIL_PATH["❌ Failures detected\nfeed failing tests + diff\nback to Claude Code\nfor targeted fix"]
        ADO_UPDATE[("ADO Boards\nstory status updated\n+ PR linked")]
        SLACK_RESULT(["Slack\ntest summary posted"])
    end

    %% ── Entry: from current-state workflow ────────────────────────────────────
    DONE -->|"board pushed\nunlocks Studio button"| WS_CONN
    BOARD -->|"GET /api/workflow/:id/ado-mappings\nfetches work item IDs"| ADO_TICKETS
    BACKLOG_JSON --> BACKLOG_CTX

    %% ── Studio internal ───────────────────────────────────────────────────────
    WS_CONN --> CTX_LOAD
    WF_GOAL & BACKLOG_CTX & ADO_TICKETS --> CLAUDE_CLI
    CLAUDE_CLI --> IMPL
    READ_CODE --> WRITE_CODE --> RUN_BUILD
    RUN_BUILD -->|"output streamed\nline-by-line via WS"| TEST_TRIGGER

    %% ── Testing ───────────────────────────────────────────────────────────────
    TEST_TRIGGER --> UNIT & INTEGRATION & E2E
    UNIT & INTEGRATION & E2E --> TEST_RESULTS

    %% ── Feedback paths ────────────────────────────────────────────────────────
    TEST_RESULTS -->|"pass"| PASS_PATH
    TEST_RESULTS -->|"fail"| FAIL_PATH
    FAIL_PATH -->|"re-enter\nimplementation loop"| CLAUDE_CLI
    PASS_PATH --> ADO_UPDATE
    PASS_PATH --> SLACK_RESULT

    %% ── Styling ───────────────────────────────────────────────────────────────
    classDef external fill:#1e3a5f,stroke:#3b82f6,color:#93c5fd
    classDef artifact fill:#1a3a2a,stroke:#22c55e,color:#86efac
    classDef terminal fill:#1a1a1a,stroke:#6b7280,color:#e5e7eb
    classDef claude fill:#2d1b00,stroke:#f97316,color:#fed7aa
    classDef test fill:#1a2a3a,stroke:#06b6d4,color:#a5f3fc
    classDef feedback fill:#1a1a2e,stroke:#8b5cf6,color:#ddd6fe
    classDef slack fill:#2d1b4e,stroke:#a78bfa,color:#ddd6fe

    class BOARD,ADO_TICKETS,ADO_UPDATE external
    class BACKLOG_JSON,BACKLOG_CTX artifact
    class DONE terminal
    class WS_CONN,CLAUDE_CLI,READ_CODE,WRITE_CODE,RUN_BUILD claude
    class TEST_TRIGGER,UNIT,INTEGRATION,E2E,TEST_RESULTS test
    class FAIL_PATH,PASS_PATH,FEEDBACK feedback
    class SLACK_RESULT slack
```

---

## 3 · Integration Reference

| Integration | Direction | Trigger | Data | API |
|---|---|---|---|---|
| **Airtable → Hub** | Pull | On demand / page load | Initiative titles, descriptions, status | `GET /api/initiatives` |
| **Hub → Airtable** | Push | Stage checkpoint approved | `researchBriefLink`, `prdLink`, `architectureLink`, `epicLink` | Airtable REST PATCH |
| **Hub → ADO Wiki** | Push | analyst / pm_prd / solution_architect approved | Page content under `Product Documentation/Features/{Name}/` | ADO Wiki REST PUT |
| **Hub → ADO Boards** | Push | Backlog approved (`push-to-board`) | Epic → Feature → Story hierarchy with effort, ACs | ADO Work Items REST POST |
| **ADO Boards → Hub** | Pull | On `push-to-board` | Work item IDs stored in `ado_work_item_map` for diff-sync | ADO Work Items REST GET |
| **Hub → Slack** | Push | Checkpoint pending · wiki published · workflow complete | Stage label, initiative title, wiki URL | Incoming Webhook POST |
| **Hub → Claude CLI** | Spawn | Code Studio opened (post board-push) | Goal, backlog stories, ADO ticket IDs via stdin | `claude --print` child process |
| **ADO Boards (goal)** | Push | Tests pass | Story status → Done, PR URL linked | ADO Work Items REST PATCH |
| **Slack (goal)** | Push | Test run complete | Pass/fail summary, story count | Incoming Webhook POST |
