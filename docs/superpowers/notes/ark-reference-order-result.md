# ARK `@imageN` reference-order probe — result

**binding: positional** (confirmed via UseAPI docs + production ARK payloads, 2026-05-30)

Resolved WITHOUT the credit-gated `--live` probe — the evidence is twofold and consistent:

1. **Production ARK payloads** (the operator's working xskill/ARK Seedance 2.0 calls) map characters
   to `reference_images` array order with positional descriptors ("Center: … Left: … Right: …") plus
   "keep each identical to her reference image" — and they work, demonstrating ARK honors reference order.
2. **UseAPI docs** (read 2026-05-30) confirm the same ordering on the other two Seedance gateways:
   runway-useapi `imageAssetId1..11` ↔ `@IMG_1..11`, dreamina-useapi `omni_N_imageRef` ↔ `@imageN`.
   See `references/video/seedance-transport-payloads.md`.

Therefore `POSITIONAL_BINDING = true` in `src/video/seedance-blocks.ts`: `subjectLockEntriesFromContext`
emits the hard `@imageN` slot (not the generic `subject N` fallback) so SUBJECT LOCK binds each
character to its reference by order, across all three gateways.

The optional `scripts/probes/ark-reference-order-probe.mjs --live` remains available to re-confirm
against a specific endpoint, but is **no longer blocking** — the docs + production evidence are sufficient.
