// scripts/probes/ark-reference-order-probe.mjs
// Manual probe: does reference_images[0]/[1] bind to @image1/@image2?
// Submits one generation with two visually distinct, content-filter-safe
// reference images in a known order and a prompt that names @image1/@image2
// for different roles, so the rendered output reveals whether array order
// is honored. Reads creds from .env (USEAPI_API_TOKEN etc.). DRY-RUN by default.
//
// Usage:
//   node scripts/probes/ark-reference-order-probe.mjs            # dry-run (prints payload)
//   PROBE_REF_A=<url> PROBE_REF_B=<url> node scripts/probes/ark-reference-order-probe.mjs --live
//
// After a --live run, inspect the rendered output and record the result in
// docs/superpowers/notes/ark-reference-order-result.md as exactly one of:
//   binding: positional   (red cloak rendered on the LEFT == array order honored)
//   binding: ignored      (order did not determine placement)
//   binding: unknown       (could not run; WS5 falls back to guidance-only)

const DRY_RUN = !process.argv.includes('--live');

// Two stylized (NON-photoreal-face) reference URLs the operator supplies. Real
// human faces trip the ARK/Seedance content filter — use stylized characters.
const REF_A = process.env.PROBE_REF_A ?? '<stylized-ref-A-url>';
const REF_B = process.env.PROBE_REF_B ?? '<stylized-ref-B-url>';

const prompt =
  'Two stylized figures. @image1 wears a red cloak; @image2 wears a blue cloak. ' +
  'Render @image1 on the LEFT and @image2 on the RIGHT, full frame, single shot.';

const payload = {
  model: process.env.PROBE_MODEL ?? 'seedance-2.0',
  prompt,
  reference_images: [REF_A, REF_B], // order under test
};

if (DRY_RUN) {
  console.log(JSON.stringify({ dryRun: true, payload }, null, 2));
  process.exit(0);
}

// --live path is intentionally delegated to the operator's active Seedance
// transport / curl shim (native-seedance or the Dreamina UseAPI route) so this
// probe stays free of route-specific submit/poll logic. Print instructions.
console.log(JSON.stringify({ dryRun: false, payload }, null, 2));
console.log(
  '\nSubmit the payload above via the active Seedance route, then inspect the render:\n' +
    '  - Red cloak on the LEFT  => binding: positional\n' +
    '  - Otherwise              => binding: ignored\n' +
    'Record the verdict in docs/superpowers/notes/ark-reference-order-result.md',
);
