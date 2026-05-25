# Deprecation Plan

This document defines the deprecation path from the original `videoclaw` (v0.11.x)
and the intermediate `vclaw-video-core` rebuild to **`videoclaw-v2`** — the
merged successor (npm package: `videoclaw`).

## Goal

Make `videoclaw-v2` the primary execution surface without pretending the
predecessor repos never existed.

## Current decision

Primary:

1. `videoclaw-v3` (npm: `videoclaw`)

Reference/fallback only:

1. `videoclaw` v0.11.x (the original repo) — legacy reference / migration source
2. `vclaw-video-core` — intermediate clean-room rebuild whose foundation was merged into v2

## Deprecation boundaries

What should stop growing in the old repo:

1. new user-facing workflow surfaces
2. new canonical artifact contracts
3. new reporting layers
4. new migration-target state models

What can still be consulted in the old repo:

1. legacy scripts
2. older provider behaviors
3. reference patterns not yet ported

## Cutover criteria

The clean repo is considered the primary product surface once these are true:

1. provider status works
2. produce / execute-status works
3. clone-execute works
4. template and prompt-library surfaces exist
5. migration docs exist
6. core tests are green

Those conditions are now satisfied.

## Remaining non-blocking work

1. richer provider-specific options
2. better automatic prompt guidance during execution
3. operator education and release communication

## Operational policy

When a user asks to create or run video work:

1. prefer `videoclaw-v3` (`vclaw` CLI)
2. fall back to the legacy `videoclaw` v0.11.x runtime only when the missing feature is clearly identified
3. track every such fallback as a porting task

## Suggested release language

Use this internal framing:

1. `videoclaw-v3` (npm: `videoclaw`) is now the recommended runtime
2. `omx` remains available only as a temporary CLI alias for `vclaw`
3. `videoclaw` v0.11.x and `vclaw-video-core` remain available as migration/reference sources
4. old workflows should not be expanded further unless they are being ported

## Sunset rule

Do not archive or delete the old repo until:

1. migration of active operators is complete
2. no critical workflow depends exclusively on the old runtime
3. the clean repo has been stable through multiple real runs
