## Interactive Review Mode

**Version 2.2** - Review dashboard with checkpoints at each pipeline stage.

### Overview

Interactive mode adds web-based review checkpoints throughout the pipeline:

```
┌─────────────────────────────────────────────────────────────────┐
│  INTERACTIVE PIPELINE FLOW                                       │
├─────────────────────────────────────────────────────────────────┤
│  Phase 1: Analyze Video                                          │
│      ↓                                                          │
│  ★ CHECKPOINT 1: Review Prompts                                  │
│    - View/edit all T2V/I2V prompts                              │
│    - Confirm aspect ratio choice                                 │
│    - [Approve] [Edit] [Cancel]                                  │
│      ↓                                                          │
│  Phase 3: Generate Images (Go Bananas)                          │
│      ↓                                                          │
│  ★ CHECKPOINT 2: Review Images                                   │
│    - View all generated images                                   │
│    - Validate aspect ratio consistency                          │
│    - [Approve All] [Regenerate Scene X] [Auto-Fix]              │
│      ↓                                                          │
│  Phase 4: Generate Videos (veo-cli)                             │
│      ↓                                                          │
│  ★ CHECKPOINT 3: Review Videos                                   │
│    - Video player for each scene                                │
│    - Primary vs Alt comparison                                   │
│    - [Approve All] [Regenerate Scene X]                         │
│      ↓                                                          │
│  Phase 6: Stitch Final Video                                    │
│      ↓                                                          │
│  ★ CHECKPOINT 4: Final Review                                    │
│    - Play final video                                           │
│    - [Export] [Start Over]                                      │
└─────────────────────────────────────────────────────────────────┘
```

### Starting Interactive Mode

**1. Start the review server** (handles approval/rejection):
```bash
python skills/video-replicator/scripts/review_server.py
# Runs on http://localhost:8765
```

**2. Start VitePress dev server** (serves the dashboard):
```bash
cd doc-site && npm run docs:dev
# Runs on http://localhost:5173
```

**3. Run pipeline with `--interactive` flag**:
```bash
python skills/video-replicator/scripts/parallel_video_gen.py \
  --product "{slug}" \
  --mode frames-to-video \
  --images-dir "projects/{slug}/images" \
  --scenes '{"1":"motion prompt"}' \
  --interactive
```

The pipeline pauses at each checkpoint and prints a URL to review:
```
★ CHECKPOINT: Review at http://localhost:5173/review/?project={slug}
Waiting for approval...
```

### Review Dashboard Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /state?project=<name>` | Get review state for project |
| `POST /approve` | Approve checkpoint |
| `POST /reject` | Reject checkpoint |
| `POST /autofix` | Auto-fix aspect ratios and approve |
| `GET /projects` | List all projects |
| `GET /health` | Health check |

### Aspect Ratio Validation & Auto-Fix

The image review checkpoint validates all images have consistent aspect ratios.

**Detection**:
- Portrait: width/height < 0.8
- Landscape: width/height > 1.2
- Square: 0.8 ≤ ratio ≤ 1.2

**Auto-Fix**: Center-crops mismatched images to target ratio:
```bash
# Enable auto-fix via CLI
python scripts/parallel_video_gen.py \
  --product "{slug}" \
  --interactive \
  --auto-fix-ratio

# Or click "Auto-Fix" button in web dashboard
```

**Manual Fix**: Regenerate specific scenes via dashboard checkbox selection.

### Adding Aspect Ratio Hints to Prompts

Use the `--ratio` flag when rewriting prompts to add composition hints:

```bash
python scripts/rewrite_prompts.py \
  --analysis "sealcam_analysis.json" \
  --subject "New subject description" \
  --output "rewritten_prompts.json" \
  --ratio portrait  # or landscape

# With choreography layer (adds CH micro-movement descriptions)
python scripts/rewrite_prompts.py \
  --analysis "projects/{slug}/analysis/sealcam_analysis.json" \
  --subject "..." \
  --output "projects/{slug}/analysis/rewritten_prompts.json" \
  --mode i2v \
  --choreography
```

This adds ratio-specific instructions based on scene type:
- **Product shots**: Extra emphasis for portrait orientation
- **Character shots**: Standard ratio instructions
- **Mixed scenes**: Balanced composition hints

### Review State File

Each project stores its review state in `projects/{slug}/review_state.json`:

```json
{
  "project": "summer-sandals",
  "stage": "images",
  "status": "pending_review",
  "data": { /* stage-specific data */ },
  "regenerate_scenes": [],
  "auto_fix": false,
  "timestamp": "2026-01-17T10:30:00"
}
```

**Stages**: `prompts` → `images` → `aspect_mismatch` → `videos` → `final` → `complete`

**Statuses**: `pending_review` | `approved` | `rejected`

---


## Agent-Assisted Review Mode

**Version 2.3** - AI agents pre-analyze content and provide recommendations during review checkpoints.

### Overview

Agent-assisted mode adds intelligent pre-validation to the review pipeline:

```
┌─────────────────────────────────────────────────────────────────┐
│  AGENT-ASSISTED PIPELINE FLOW                                    │
├─────────────────────────────────────────────────────────────────┤
│  Phase 3: Generate Images (Go Bananas)                          │
│      ↓                                                          │
│  review-orchestrator spawns image-qa agents                     │
│      ↓                                                          │
│  image-qa analyzes each scene (quality, composition, ratio)     │
│      ↓                                                          │
│  ★ CHECKPOINT: Review Images + Agent Insights                   │
│    - QA scores displayed per image                              │
│    - Recommendations: approve / review / regenerate             │
│    - Auto-select scenes flagged for regeneration                │
│      ↓                                                          │
│  If rejected → regeneration agent auto-executes Go Bananas      │
│      ↓                                                          │
│  Phase 4: Generate Videos                                       │
│      ↓                                                          │
│  video-comparison agent ranks primary vs alt variants           │
│      ↓                                                          │
│  ★ CHECKPOINT: Review Videos + Agent Rankings                   │
│    - Confidence scores per scene                                │
│    - Auto-select recommended variants                           │
└─────────────────────────────────────────────────────────────────┘
```

### Enabling Agent-Assisted Mode

**Option 1: Via CLI flag**
```bash
python scripts/parallel_video_gen.py \
  --product "{slug}" \
  --mode frames-to-video \
  --interactive \
  --agent-assisted
```

**Option 2: Via dashboard**
Click "Enable Agents" button in the Agent Progress banner on the review dashboard.

**Option 3: Via API**
```bash
curl -X POST http://localhost:8765/agent/enable \
  -H "Content-Type: application/json" \
  -d '{"project": "summer-sandals"}'
```

### Agent Workflow

#### Image Review Stage

1. **Orchestrator** spawns `image-qa` agents (haiku model for speed)
2. Each agent analyzes one image:
   - Aspect ratio match
   - Composition quality
   - Prompt adherence
   - Technical quality
3. Results aggregated into QA report
4. Dashboard shows:
   - Overall score (0-100%)
   - Per-scene scores and recommendations
   - Auto-approve eligibility (all scores >= 85%)

#### Video Review Stage

1. **Orchestrator** spawns `video-comparison` agent
2. Agent compares primary vs alt for each scene:
   - Motion smoothness
   - Prompt adherence
   - Visual quality
3. Results include:
   - Recommended version per scene
   - Confidence level (high/medium/low)
   - Auto-selections applied to dashboard

#### Regeneration Handling

When images are rejected:

1. **Old flow**: MCP modal shows commands for manual execution
2. **New flow**: `regeneration` agent auto-executes Go Bananas MCP calls
   - Uses saved character/product context
   - Downloads new images to project directory
   - Updates review state for re-review

### Review State Fields

Agent-assisted mode adds these fields to `review_state.json`:

```json
{
  "agent_assisted": true,
  "agent_status": "idle | working | complete | error",
  "agent_working": {
    "type": "image-qa",
    "progress": "3/5 scenes analyzed",
    "percent": 60
  },
  "data": {
    "qa_report": {
      "overall_score": 0.87,
      "recommendations": [...],
      "auto_approve_eligible": false
    },
    "video_comparison": {
      "auto_selections": {"1": "primary", "2": "alt"},
      "confidence_levels": {
        "high": [1, 3],
        "low": [2]
      }
    }
  }
}
```

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/agent/enable` | POST | Enable agent-assisted mode |
| `/agent/status` | GET | Get agent status and reports |
| `/agent/qa-report` | POST | Submit QA report from agents |
| `/agent/video-comparison` | POST | Submit video comparison results |
| `/agent/regeneration-complete` | POST | Notify regeneration finished |
| `/agent/pending-tasks` | GET | Get agent work queue |
| `/agent/update-status` | POST | Update agent working status |

### Agent Coordinator Script

```bash
# Check agent status
python scripts/agent_coordinator.py --project "summer-sandals" --action status

# Start QA workflow
python scripts/agent_coordinator.py --project "summer-sandals" --action start-qa --stage images

# Aggregate QA reports
python scripts/agent_coordinator.py --project "summer-sandals" --action aggregate-qa

# Start regeneration
python scripts/agent_coordinator.py --project "summer-sandals" --action start-regen --scenes 1,3

# Aggregate video comparisons
python scripts/agent_coordinator.py --project "summer-sandals" --action aggregate-video
```

### QA Score Interpretation

| Score | Action | Meaning |
|-------|--------|---------|
| >= 85% | Approve | High confidence, ready for video generation |
| 65-84% | Review | Acceptable but user should verify |
| < 65% | Regenerate | Issues detected, recommend regeneration |

### Confidence Levels (Video Comparison)

| Level | Threshold | Dashboard Behavior |
|-------|-----------|-------------------|
| High | >= 80% | Auto-select, green badge |
| Medium | 65-79% | Auto-select, amber badge |
| Low | < 65% | Manual review, pink badge |

### Benefits

1. **Faster Reviews**: Agents pre-analyze content before you see it
2. **Better Quality**: QA catches issues early (aspect ratios, composition)
3. **Less Manual Work**: Regeneration agent handles Go Bananas calls automatically
4. **Informed Decisions**: Confidence scores help prioritize attention
