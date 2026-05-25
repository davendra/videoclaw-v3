# Video Checkpoint Protocol

Use this protocol for stage-based video work in VideoClaw.

## Purpose

1. Make stage completion explicit.
2. Prevent silent progression when a required artifact is missing.
3. Support resume, review, and project dashboard accuracy.

## Required checkpoint fields

Every stage checkpoint should record:

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

## Approval defaults

Default human approval behavior:

1. `brief` -> yes
2. `storyboard` -> yes
3. `assets` -> no, unless requested
4. `review` -> yes
5. `publish` -> yes

## Stage rules

`brief`

1. Must produce a brief artifact.
2. Must define intent, mode, and target output shape.

`storyboard`

1. Must produce a storyboard artifact.
2. Must define scene order and scene-level intent.

`assets`

1. Must produce an asset manifest.
2. Must record which scenes have usable assets and which require retry.

`review`

1. Must produce a review report.
2. Must include a verdict: `pass`, `retry`, or `fail`.

`publish`

1. Must produce a publish report.
2. Must record final output path or explicit publish blocker.

## Resume rule

When resuming:

1. find the latest checkpoint
2. load the latest valid artifact set
3. continue from the first incomplete or retry-required stage

## Hard rules

1. Do not mark a stage complete if its required artifact is missing.
2. Do not move to `publish` from a `retry` review verdict.
3. Do not silently reinterpret missing outputs as success.
