# Generation Telemetry

Use this reference whenever a provider route submits, polls, or completes a generation.

Record:

1. route id, operation kind, dry-run/live status, and external job id
2. task count, scene indices, average clip duration, prompt word count, and reference counts
3. provider-reported credits, USD cost, generation time, and issues when available
4. output ingestion count after polling

Cost estimates should use provider-reported USD samples only when the route and task count are clear. Credits are kept as telemetry unless a route-specific conversion exists in code.

Avoid:

1. mixing dry-run estimates with live provider cost samples
2. converting credits to USD without a route-specific conversion contract
3. dropping failed or blocked events; they explain why no output was produced
