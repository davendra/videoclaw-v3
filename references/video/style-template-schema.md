# Style Template Schema

## Purpose

Store reusable style knowledge separately from one-off project execution.

## Required fields

1. `name`
2. `sourceProject`
3. `summary`
4. `pacing`
5. `structure`
6. `motionClassification`
7. `keep`
8. `change`
9. `reusableVariables`

## Recommended additions

1. primary provider
2. preferred ratio
3. continuity notes
4. winning prompts
5. failed prompt patterns
6. benchmark runtime/cost notes

## Reuse rule

Templates should capture:

1. what to preserve
2. what to vary
3. what to avoid

They should not capture:

1. provider-specific credentials
2. one-off filesystem paths
3. billing/account assumptions
