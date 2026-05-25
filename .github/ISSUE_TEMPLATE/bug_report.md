---
name: Bug report
about: Report something that broke
title: ''
labels: bug
assignees: ''
---

## What happened

<!-- One sentence: what command/action triggered the bug, what did you expect, what happened instead. -->

## Reproduce

```bash
# minimal command(s) that produce the bug
vclaw video init my-test
vclaw video <command-that-failed> --project my-test
```

## Expected

<!-- What should have happened. -->

## Actual

<!-- What did happen. Paste any error output below. -->

```
<paste stderr / stdout / stack trace here>
```

## Environment

- videoclaw version: `<output of `vclaw --version` or commit SHA>`
- Node version: `<node --version>`
- OS: `<macOS 15 / Ubuntu 22.04 / Windows 11 WSL2 / ...>`
- Route (if relevant): `<veo-direct | veo-useapi | seedance-direct | runway-useapi>`
- vclaw-cli used? `<yes / no>` (Bun version if yes: `<bun --version>`)
- Python pipeline used? `<yes / no>` (Python version if yes)

## Anything that helps

<!-- Sample project slug, redacted artifact, link to a public scorecard, etc. -->
