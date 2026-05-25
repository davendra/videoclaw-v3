# Templates

## Purpose

Templates are the reusable bridge between:

1. reference analysis
2. new project intent
3. seeded clone plans
4. storyboard generation

## Workflow

0. Inspect bundled provider playbooks:

```bash
vclaw video playbook-list
vclaw video playbook-show --name seedance-ugc
vclaw video prompt-lib-list
vclaw video prompt-lib-show --name veo-prompting-guide
```

## Built-in storyboard templates

Built-in storyboard templates are available for quick scene scaffolds:

```bash
vclaw video storyboard-template-list
vclaw video storyboard-template-show --name product-commercial-4
vclaw video storyboard --project new-project --template product-commercial-4 --environment "bright kitchen counter" --character-a "Maya"
```

Guide-inspired storyboard templates include:

1. `product-commercial-4` — short problem, reveal, proof, payoff ad
2. `food-tutorial-6` — ingredients, prep, cooking, plate, taste
3. `dance-social-6` — hook pose, choreography, loopable finish
4. `dramatic-short-6` — reveal, choice, confrontation, aftermath
5. `action-short-6` — threat, obstacle, impact, near miss, release

## Reference-derived templates

1. Analyze a reference:

```bash
vclaw video analyze --project ref-project --source <url-or-path> --title "Reference"
```

2. Save a template:

```bash
vclaw video template-save --project ref-project --name launch-template
```

3. List and inspect templates:

```bash
vclaw video template-list
vclaw video template-show --name launch-template
```

4. Generate a clone plan:

```bash
vclaw video clone-plan --template launch-template --project new-project --intent "Make a launch teaser for a smart bottle."
```

5. Initialize a new project from the template:

```bash
vclaw video clone-init --template launch-template --project new-project --intent "Make a launch teaser for a smart bottle."
```

6. Generate a first-pass storyboard from that clone plan:

```bash
vclaw video storyboard-from-clone --project new-project
```

## Stored data

Templates currently capture:

1. pacing
2. beat structure
3. motion classification
4. keep list
5. change list
6. reusable variables
7. style layers
8. beat-compression guidance
9. technical notes
10. dialogue notes
11. workflow checklist

Playbooks currently capture:

1. use-when guidance
2. prompt formula steps
3. constraints
4. adaptation checklist

Prompt-library references now capture:

1. provider prompting guides
2. style template schema notes
3. stage-director guidance
4. checkpoint protocol guidance
5. generation telemetry guidance
6. dialogue-duration preflight guidance
7. character reference-sheet guidance
8. clone-ad template workflow guidance

## Clone-plan enrichment

`analyze --auto` asks Gemini for the optional fields above. Manual analyze
commands can still provide the legacy beat/keep/change/variable data; when a
template is saved, V-Claw fills conservative defaults for missing style layers
and beat-compression guidance.

Clone plans preserve the template's style layers and compression rules. They do
not copy claims or brand-specific language; the checklist pushes operators to
replace product, audience, offer, proof, objection, and CTA variables for the
new intent.

## Current gap

Templates do not yet drive runtime execution directly. They currently seed:

1. clone plan
2. brief metadata
3. storyboard scaffold

## Character continuity note

If a cloned storyboard needs consistent characters, add them explicitly during
storyboard authoring and register matching profiles:

```bash
vclaw video storyboard --project new-project --scene "Hook shot" --scene-character 0:Nova
vclaw video character-add --project new-project --name Nova --ref refs/nova-sheet.png
vclaw video character-consistency --project new-project
```
