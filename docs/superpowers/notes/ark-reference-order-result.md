# ARK `@imageN` reference-order probe — result

**binding: unknown**

Status: the live `--live` probe has NOT been run yet (credit-gated — xskill ARK was
previously below the 1000-credit floor; can alternatively run via the Dreamina/UseAPI
Seedance route). Until a live run records `positional` or `ignored`, WS5/WS6 treat
`@imageN` as **prompt-text guidance only** (no hard positional binding claimed) and the
`buildReferenceMap` payload-binding fix is applied independently.

To upgrade this result, run:

```
PROBE_REF_A=<stylized-ref-A-url> PROBE_REF_B=<stylized-ref-B-url> \
  node scripts/probes/ark-reference-order-probe.mjs --live
```

then submit the printed payload via the active Seedance route and set this file to
exactly one of `binding: positional` / `binding: ignored`.
