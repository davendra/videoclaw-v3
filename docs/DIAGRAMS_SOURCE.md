# Diagrams Source

This file is the **canonical source** for the diagrams used in `README.md`,
`docs/ARCHITECTURE.md`, and other top-level docs. The Mermaid blocks below
are the human-readable, version-controlled source of truth. The
corresponding JPGs in `docs/assets/diagram-*.jpg` are rendered from these
sources (via Go Bananas Pro `workflow-diagrams` skill, or any Mermaid
renderer).

If a diagram looks out of date in the rendered JPG, update the Mermaid
here first, then regenerate the JPG.

---

## 1. Architecture (`docs/assets/diagram-architecture.jpg`)

Shows the request flow from operator/agent through the CLI into the
domain layer, the artifact/event ledger, the execution runtime, and the
adapter tier. Plus the two opt-in sidecars (`vclaw-cli/` Bun package and
`skills/video-replicator/scripts/` Python pipeline) that the main
TypeScript repo invokes via subprocess when needed.

```mermaid
flowchart TD
  Operator(["Operator / AI Agent"]) --> CLI["vclaw CLI<br/>(src/cli/vclaw.ts)"]
  CLI --> Domain["Domain modules<br/>(src/video/*.ts)"]
  Domain --> Artifacts[("artifacts/<br/>JSON canonical")]
  Domain --> Checkpoints[("checkpoints/<br/>stage approvals")]
  Domain --> Events[("events/events.jsonl<br/>append-only ledger")]
  Domain --> Runtime["Execution runtime<br/>(execution-runtime.ts)"]
  Runtime --> Adapter["Adapter layer<br/>(provider-adapter-runner.ts)"]
  Adapter --> Native["Native in-process<br/>native-veo · native-seedance · native-runway"]
  Adapter --> Shim["Command shim<br/>(VCLAW_*_SUBMIT_CMD)"]
  Adapter --> Custom["Custom adapter binary<br/>(VCLAW_*_ADAPTER)"]
  Native -.optional sidecar.-> VclawCli["vclaw-cli/<br/>Bun · Google Flow + UseAPI"]
  Domain -.optional sidecar.-> Python["skills/video-replicator/scripts/<br/>Python 3.10+ · 122 modules"]

  classDef entry fill:#d4ed5b,stroke:#1a1815,color:#1a1815,stroke-width:2px
  classDef core fill:#1a1815,stroke:#1a1815,color:#faf8f5
  classDef store fill:#f0ece6,stroke:#7a756d,color:#1a1815
  classDef sidecar fill:#fff,stroke:#c4450c,color:#c4450c,stroke-dasharray: 5 3
  class Operator entry
  class CLI,Domain,Runtime,Adapter,Native,Shim,Custom core
  class Artifacts,Checkpoints,Events store
  class VclawCli,Python sidecar
```

---

## 2. Provider routing (`docs/assets/diagram-routing.jpg`)

Decision tree the dispatcher walks for each route. Hard-fails by design
if no path resolves — no silent fallback across materially different
provider paths.

```mermaid
flowchart TD
  Start(["Provider route selected<br/>(veo-direct · veo-useapi · seedance-direct ·<br/>runway-useapi · kling-useapi)"]) --> Q1{"VCLAW_*_ADAPTER<br/>env var set?"}
  Q1 -->|Yes| Custom["✅ Custom adapter binary<br/>stdin → JSON, stdout → JSON"]
  Q1 -->|No| Q2{"Built-in adapter<br/>supports route?<br/>(seedance-direct · veo-useapi ·<br/>runway-useapi)"}
  Q2 -->|No| Fail1["❌ Hard fail<br/>no silent fallback"]
  Q2 -->|Yes| Q3{"VCLAW_*_SUBMIT_CMD<br/>set?"}
  Q3 -->|Yes| Shim["✅ Command shim<br/>through built-in adapter"]
  Q3 -->|No| Q4{"Native creds available?<br/>SUTUI_API_KEY (seedance) ·<br/>local vclaw-cli (veo) ·<br/>USEAPI_API_TOKEN (runway)"}
  Q4 -->|Yes| Native["✅ Native in-process transport"]
  Q4 -->|No| Fail2["❌ Hard fail"]

  classDef decision fill:#d4ed5b,stroke:#1a1815,color:#1a1815
  classDef terminal fill:#1a1815,stroke:#1a1815,color:#faf8f5
  classDef fail fill:#c4450c,stroke:#1a1815,color:#faf8f5
  class Q1,Q2,Q3,Q4 decision
  class Custom,Shim,Native,Start terminal
  class Fail1,Fail2 fail
```

---

## 3. Skills ecosystem (`docs/assets/diagram-skills-ecosystem.jpg`)

52 skills as of 2026-05-25, grouped by purpose. The current canonical
source is `skills/catalog.json` — this diagram is illustrative.

> **Note on the rendered JPG:** the current `diagram-skills-ecosystem.jpg`
> header says "51 total" — off by one from the Mermaid source above.
> A v3 regeneration was attempted and produced WORSE artifacts
> (hallucinated headers and misplaced cards), so the v2 render was
> kept. The footnote in the JPG already directs readers to
> `skills/catalog.json` as the authoritative count, so the minor header
> drift is acceptable until the next clean regeneration.

Two canonical entry points (highlighted): **`video-framework`** for
generic video requests (delegates to specialist children), and
**`brand-presenter`** for branded host/presenter videos (specialized
by bunty / davendra / nex profiles).

```mermaid
flowchart LR
  subgraph Video["Video & Production skills"]
    direction TB
    VF["video-framework<br/>(canonical entry)"]:::entry
    VF --> VR["video-replicator"]
    VF --> VS["video-storyboard"]
    VF --> VAT["video-analyze-template"]
    VF --> VCA["video-clone-ad"]
    VF --> VTL["video-thumbnail-lab"]
    VF --> MD["movie-director"]
    VF --> UGC["ugc"]
    VF --> VP["video-post"]
    VF --> CC["character-creator"]
    VF --> CL["character-library"]
    VF --> SP["seedance-prompts"]
    VF --> VPO["video-portfolio-ops"]
    VF --> VPH["video-production-handoff"]
    VF --> VRR["video-release-readiness"]
    VF --> VRQ["video-review-ui-qa"]
    VF --> YA["youtube-audio"]
  end

  subgraph Presenters["Presenter skills"]
    direction TB
    BP["brand-presenter<br/>(canonical entry)"]:::entry
    BP --> DP["davendra-presenter"]
    BP --> NP["nex-presenter"]
    BP --> BUNTY["bunty"]
    UIUX["ui-ux-pro-max"]
  end

  subgraph Workflow["Workflow & dev skills"]
    direction TB
    Ralph["ralph"] --- RalphInit["ralph-init"]
    Ralplan["ralplan"]
    Team["team"] --- Worker["worker"]
    Autopilot["autopilot"]
    Pipeline["pipeline"]
    StudioMode["studio-mode"]
    DeepInterview["deep-interview"]
    Deepsearch["deepsearch"]
    CodeReview["code-review"]
    Review["review"]
    SecReview["security-review"]
    GitMaster["git-master"]
    BuildFix["build-fix"]
    AISlop["ai-slop-cleaner"]
    SkillsAuditor["skills-auditor"]
    WebClone["web-clone"]
  end

  subgraph Meta["Meta & utility skills"]
    direction TB
    Skill["skill"]
    Help["help"]
    HUD["hud"]
    Doctor["doctor"]
    Trace["trace"]
    Note["note"]
    Cancel["cancel"]
    OMXSetup["omx-setup"]
    ConfigNotif["configure-notifications"]
  end

  classDef entry fill:#d4ed5b,stroke:#1a1815,color:#1a1815,stroke-width:2px
```
