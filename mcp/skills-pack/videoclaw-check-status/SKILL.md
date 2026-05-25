---
name: videoclaw-check-status
description: |
  Check the status of a videoclaw project. Use when the user asks
  "where is my video", "is it done", or wants a progress update.
---

# videoclaw: check status

```bash
vclaw video status --project <slug>
```

Returns JSON with the current stage, checkpoint states, and the
`storyboardReviewState` (`missing|current|stale`). Pipe to `jq` to
extract specifics.

For a live MCP-based query (if the host supports MCP):
- Connect to the `videoclaw` MCP server (`vclaw mcp serve`)
- Call the `get_project_status` tool with `{ slug: "<slug>" }`

For the whole portfolio:

```bash
vclaw video list
vclaw video metrics
```
