---
name: videoclaw-portfolio-review
description: |
  Review the videoclaw project portfolio — what's in flight, what's
  blocked, what needs attention. Use for "review my videos", "what's
  pending", "portfolio status".
---

# videoclaw: portfolio review

```bash
vclaw video metrics          # aggregate counters
vclaw video next-actions     # what needs doing per project
vclaw video doctor-portfolio # health check across all projects
vclaw video export-csv       # tabular export for spreadsheets
```

All emit JSON (when piped). Combine `metrics` + `next-actions` for a
prioritized worklist. The MCP `list_projects` tool gives the same data
to MCP-aware hosts.
