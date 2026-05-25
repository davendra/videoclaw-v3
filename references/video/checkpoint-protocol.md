# Video Checkpoint Protocol

## Required checkpoint fields

1. `stage`
2. `status`
3. `generatedAt`
4. `artifacts`
5. `summary`
6. `issues`
7. `nextAction`

## Status values

1. `completed`
2. `awaiting-approval`
3. `retry-required`
4. `failed`
5. `pending`

## Hard rules

1. Do not mark a stage complete if its required artifact is missing.
2. Do not move to publish from a retry review verdict.
3. Do not silently reinterpret missing outputs as success.
4. Keep resume logic artifact-based, not log-based.
