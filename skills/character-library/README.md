# Character Library

Operational library hygiene for Go Bananas character records used by
`vclaw video create`, `director-preflight`, and storyboard-driven execution.

This package is intentionally paired with `skills/character-creator/`:

- use `character-creator` to create or refresh rich character anchors
- use `character-library` to browse, audit, patch, and delete polluted entries

The supporting shell helpers avoid hardcoded repo paths and operate against the
Go Bananas API surface directly through `GO_BANANAS_API_KEY`.
