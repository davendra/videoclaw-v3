# Reference Video: Seedance Motion Design Workflow

Source: https://www.youtube.com/watch?v=K67WetORDEo

Video title: Seedance 2 for Motion Design Is Insane - Full Workflow Test

Date documented: 2026-05-05

## Purpose

This note captures reusable techniques from the reference video for improving
Video Claw's storyboard, prompt, transition, and execution workflows.

The source demonstrates a strong AI motion-design pipeline:

1. write the idea and voiceover first
2. gather visual references on one canvas
3. generate still storyboard frames in sequence
4. refine each still with focused edit prompts
5. upscale locked storyboard frames before animation
6. animate with Seedance using image references, start frames, and end frames
7. create alternate motion variants with long and short prompts
8. bridge difficult motion with extra intermediate poses
9. use final frames from one shot as continuity inputs for the next
10. polish timing and voiceover in an editor with simple time remapping

## Source Fidelity Notes

The reference video was reviewed through:

1. English captions
2. downloaded 1080p video frames
3. OCR of visible prompt panels

The prompt inventory below is intentionally paraphrased rather than copied
verbatim from the video. It preserves the usable structure, intent, inputs, and
technique without depending on the exact source wording.

## High-Level Workflow

### 1. Idea And Script First

The video starts with a concise product narrative before any generation work.
The script doubles as the voiceover and becomes the structure for the visual
storyboard.

Reusable Video Claw idea:

1. Treat `brief` as the master narrative.
2. Add a `voiceoverScript` field or artifact early.
3. Let storyboard scenes map to voiceover beats.
4. Warn when the storyboard has visual beats but no narration or timing anchor.

### 2. Reference Canvas Before Prompting

The creator builds an input board before generating scenes. The references
include:

1. character design
2. 3D abstract elements
3. meditation pose
4. icons and media-card concepts
5. UI screenshots
6. background and lookdev references
7. later frames from prior generated scenes

Reusable Video Claw idea:

1. Add a first-class `referenceBoard` artifact.
2. Each reference should have a role, such as `character`, `pose`, `lookdev`,
   `background`, `ui`, `prop`, `startFrame`, `endFrame`, or `texture`.
3. Prompt generation should cite reference roles instead of loose image paths.

### 3. Still Storyboard Before Motion

The first major phase is not video generation. It is still-frame design. The
creator builds a sequence of locked storyboard images, each solving composition,
character continuity, object layout, and visual metaphor before motion.

Reusable Video Claw idea:

1. Keep storyboard image prompts separate from motion prompts.
2. Store a still-frame lock state before execution.
3. Require review of still frames before expensive video generation.
4. Track which generated still was reused as the base for the next still.

### 4. Iterative Prompt Editing

The creator rarely accepts the first output. A common pattern is:

1. generate a first draft
2. select the output as the next input
3. run a narrow edit prompt
4. remove defects or simplify layout
5. lock the corrected result

Reusable Video Claw idea:

1. Add `promptHistory` per scene.
2. Differentiate prompt types: `create`, `edit`, `cleanup`, `variant`,
   `motion`, and `transition`.
3. Store what changed and what was preserved.

### 5. Preserve Identity With Explicit Constraints

Many prompts reinforce the same character, materials, color palette, background,
lighting, and camera angle. The creator repeatedly tells the model what must not
change.

Reusable Video Claw idea:

1. Generate continuity constraints automatically for recurring characters.
2. Add a reusable `preserve` block to scene prompts.
3. Add explicit negative guidance for unwanted logos, readable UI text,
   clutter, real humans, extra objects, distorted anatomy, and camera changes.

### 6. Upscale Before Seedance

Before motion generation, the creator upscales still frames to 4K for more
consistent Seedance results.

Reusable Video Claw idea:

1. Add an `upscaled` readiness check before image-to-video execution.
2. Store original and upscaled asset IDs separately.
3. Warn when Seedance input images are below a target resolution.

### 7. Seedance Start/End Frame Chaining

The strongest motion technique is continuity chaining:

1. use a still storyboard image as the first start frame
2. use the next still as the end frame
3. generate a transition
4. extract the final frame from that generated clip
5. upscale or lock that frame
6. use it as the start frame for the next shot

Reusable Video Claw idea:

1. Add `continuityFrames` to execution artifacts.
2. Support generated-frame extraction as a pipeline stage.
3. Let a scene consume `previousClip.endFrame` as its start reference.
4. Make start/end frame roles visible in storyboard review markdown.

### 8. Long Prompt For Control, Short Prompt For Variation

The creator uses detailed prompts when the action needs precise control, then
reruns the same selected inputs with a shorter prompt to get alternate motion
variants.

Reusable Video Claw idea:

1. Add a variant strategy per scene:
   - `control`: detailed motion prompt
   - `variation`: shorter motion prompt
2. Store both outputs as candidates.
3. Let scene-candidate review compare motion clarity, continuity, and pacing.

### 9. Intermediate Pose Bridging

For difficult actions, the creator generates extra still poses between the
source and target. Seedance then receives multiple references instead of trying
to infer the whole action from two distant endpoints.

Reusable Video Claw idea:

1. Add `bridgeFrame` or `inbetweenPose` assets.
2. Prompt quality checks should flag large motion jumps without bridge frames.
3. The execution plan should recommend pose bridging for hand-object
   interactions, object escapes, catches, throws, and character transformations.

### 10. Post Polish Is Simple But Planned

The final edit uses time remapping to speed up slow shots and then adds
voiceover. This matters because the creator accepts slightly slow 15-second
generations knowing they can be tightened later.

Reusable Video Claw idea:

1. Add `postPlan` to execution reports.
2. Store intended speed changes per generated scene.
3. Let voiceover timing inform duration choices.
4. Mark shots that are intentionally slow for post retiming.

## Technique Catalog

### Reference Techniques

1. Use a character reference plus a separate pose reference.
2. Use lookdev references only for material, lighting, and render quality.
3. Use prior generated scenes as canonical continuity references.
4. Use UI screenshots as structural references, not as text sources.
5. Use character close-up references to preserve texture in video generation.
6. Use full-body references when Seedance needs body shape and proportions.

### Still-Frame Prompt Techniques

1. Define one main subject and one visual metaphor per frame.
2. Describe exact preserved attributes before the requested edit.
3. Split create prompts from cleanup prompts.
4. Remove noisy elements with short edit prompts.
5. Use negative constraints for readable text, logos, UI clutter, extra
   objects, real humans, and unwanted camera changes.
6. Keep abstract UI content non-readable unless the brand or label is required.

### Motion Prompt Techniques

1. Use imported images as the source of truth.
2. State the start frame, target frame, and continuity requirements.
3. Keep the camera static when the motion graphics should feel clean.
4. Use one readable action per shot.
5. Use verbs that describe physical behavior: detach, lift, snap, settle,
   spiral, arc, flow, dissolve, reveal.
6. Add motion-design timing language: anticipation, easing, overshoot,
   staggered timing, motion blur, soft settle.
7. Use short reruns for alternate options after the controlled prompt works.

### Continuity Techniques

1. Preserve character identity, proportions, material, and colors across every
   scene.
2. Keep background, camera, and lighting consistent during transitions.
3. Use the end frame of one generated clip as the next start frame.
4. Create bridge poses when the model must understand a complicated action.
5. Keep asset movement physically coherent: cards travel in arcs, shapes snap
   into grids, objects shrink when entering containers.

## Prompt Inventory, Paraphrased

This inventory covers the visible prompt sequence from the video. It is not a
verbatim transcript.

| # | Approx Time | Prompt Type | Inputs | Reusable Prompt Intent |
|---|---:|---|---|---|
| 1 | 01:50 | Create still | character, abstract 3D lookdev, meditation pose | Place the character in a dark 3D space, seated in meditation with a formed idea represented by colorful abstract shapes in a glassy sphere. |
| 2 | 01:55 | Edit still | first generated character image | Preserve lookdev and character design, remove the large idea sphere, move the colorful idea shapes inside the transparent head, remove cursor-like shapes, and make the character hover. |
| 3 | 02:05 | Edit still | character image, dark-grid background | Preserve the character and internal idea shapes, remove the floor, and place the hovering character against the clean dark grid background. |
| 4 | 02:15 | Create still | character, abstract elements | Transform the calm character into an anxious floating figure surrounded by fragmented idea pieces, browser tabs, and parallax UI windows. |
| 5 | 02:30 | Create still | chaotic character scene | Make a medium close-up of the character crying with an empty transparent head while distant tabs and fragments fade into darkness. |
| 6 | 02:40 | Create still | browser or page frame, abstract elements | Assemble colorful abstract shapes into an organized whole inside a FlashBoards-style browser page, with clean premium motion-design lookdev. |
| 7 | 02:45 | Edit still | generated browser page | Preserve composition and contents, but replace the glossy page frame with a flatter dark UI frame and remove glow or glassiness from the frame. |
| 8 | 03:00 | Edit still | FlashBoards page | Replace abstract shapes with organized media cards representing image references, video cards, waveform cards, and prompt cards on one clean board. |
| 9 | 03:10 | Create still | organized board | Show one media card breaking out toward the camera with foreground blur while the rest of the board remains organized and tethered. |
| 10 | 03:15 | Create still | character, desk pose reference | Place the character at a desk in side view, working calmly on a computer in the established dark premium style. |
| 11 | 03:30 | Create still | desk scene, escaping media card | Make a wider side-view action scene where the character confidently stretches to catch an escaping media card. |
| 12 | 03:45 | Edit still | prompt-box hero image | Simplify the prompt box scene by reducing surrounding abstract elements, removing pointer arrows and hands, and keeping the prompt box as the hero. |
| 13 | 04:00 | Create still | prompt box, board/canvas references | Build a large creator process canvas around the prompt box, with references, clips, voice, prompts, notes, arrows, and media cards laid out naturally. |
| 14 | 04:05 | Create still | storyboard character | Create a hero close-up of the open glass head containing a tiny organized creative workspace made of media cards, prompt box, waveforms, notes, and idea shapes. |
| 15 | 04:20 | Planning board | script and storyboard | Review the full visual plan with script fragments, storyboard images, and voiceover lines aligned into one workflow board. |
| 16 | 04:25 | Asset prep | generated stills | Upscale final still frames before moving into Seedance video generation. |
| 17 | 04:45 | Motion | full-body character, close-up character, first scene | Animate the first scene from calm meditation toward the beginning of idea fragmentation while preserving character texture and style. |
| 18 | 05:05 | Motion transition | first scene as start, chaos scene as end, close-up texture reference | Transition from calm character to chaos using start/end frames and a detailed action prompt. |
| 19 | 05:10 | Variant motion | same selected inputs as prior motion | Reuse the same inputs with a shorter prompt to generate an alternate version of the same transition. |
| 20 | 05:30 | Continuity transition | extracted end frame, next storyboard still | Use the prior clip's ending frame as the next start frame, then transition into the following storyboard scene. |
| 21 | 05:55 | Motion transition | end frame from prior shot, next scene | Repeat continuity chaining: start from the last generated frame and move into the next scene with a short prompt. |
| 22 | 06:15 | Motion transition | sad character, browser/solution scene | Open a large clean browser tab over the sad chaos scene and pull colorful pieces into an organized page. |
| 23 | 06:35 | Motion transition | abstract page, media board | Transform abstract idea elements into a structured media board with snapping, sliding, scaling, and organized motion. |
| 24 | 06:50 | Motion | board scene, escaping-card reference | Animate one specific video card vibrating, popping out of the grid, tilting forward, and flying out with a motion trail. |
| 25 | 07:05 | Variant motion | same board and card references | Shorter playful version of the escaping-card action for alternate timing and feel. |
| 26 | 07:10 | Review frame | generated board action | Inspect and choose between board action outputs. |
| 27 | 07:30 | Cleanup still | desk/catch image | Remove the card from the character's hand and adjust the work pose while preserving body layout and scene style. |
| 28 | 07:40 | Motion | desk scene, escaping card, catch pose | Animate relaxed typing, a media card shooting out of the monitor, confident catch, and return throw into the screen. |
| 29 | 07:45 | Motion control | same desk and catch references | More detailed version of the catch-and-return action with static camera, precise hand behavior, and negative constraints. |
| 30 | 07:55 | Variant motion | same selected inputs | Short version of the catch-and-return prompt for a fast polished alternate. |
| 31 | 08:15 | Motion continuation | prompt-box center, final board layout | Animate board elements progressively appearing with slides, scales, fades, stacking, drawing, and staggered timing. |
| 32 | 08:20 | Motion control | prompt-box center, final full board | Move the prompt box from center to bottom-right while the rest of the creative board builds itself around it. |
| 33 | 08:30 | Variant motion | same selected inputs | Shorter version of the prompt-box-to-board build for alternate motion. |
| 34 | 08:45 | Review frame | generated board-to-character transition | Inspect output options before selecting the next continuity direction. |
| 35 | 09:00 | Motion | character with open jar, media elements | Animate media elements spiraling into the character's open head and arranging into a miniature creative workspace. |
| 36 | 09:15 | Transition | full board, open-head character | Turn the board's media elements into a flowing stream that enters the character's open head and settles as organized ideas. |
| 37 | 09:35 | Logo transition | open-head character, logo | Reverse the idea stream out of the character's head and transform the stream into the FlashBoards logo and wordmark. |
| 38 | 09:45 | Edit polish | generated clips, audio files | Assemble generated clips in After Effects with voiceover and time remapping. |
| 39 | 09:50 | Edit polish | final timeline | Adjust clip timing, opacity, and time remap settings for final pacing. |

## Reusable Prompt Patterns For Video Claw

### Still Storyboard Create Pattern

```text
Use [reference roles] as the source for [character/lookdev/pose/background].
Create a [shot size] scene where [one visual story beat happens].
Preserve [identity, materials, colors, lighting, camera angle].
Include [specific objects or UI elements] as abstract non-readable elements.
Mood and lookdev: [style, lighting, palette, material language].
Negative guidance: no [logos/readable text/clutter/extra objects/real people].
```

### Still Storyboard Edit Pattern

```text
Edit the provided image while keeping [locked attributes] exactly the same.
Only change [small list of changes].
Remove [specific defects].
Do not change [identity, pose, camera, lighting, composition, background].
```

### Seedance Motion Control Pattern

```text
Use image 1 as the start frame and image 2 as the end frame.
Preserve [character identity, style, background, lighting, camera].
Camera: [static / push-in / tracking / orbit].
Action: [one visible action sequence].
Motion style: polished motion graphics, smooth easing, anticipation,
subtle overshoot, soft settle, physically believable movement.
End exactly matching image 2.
Negative guidance: no [camera change, identity change, extra props,
chaotic motion, distorted anatomy].
```

### Seedance Short Variant Pattern

```text
Static camera. Use image 1 as the start and image 2 as the target.
Animate [single action] with clean, fast, playful motion.
Preserve character, background, composition, and style.
End matching image 2.
```

### Continuity Frame Pattern

```text
Use the final frame from the previous generated clip as the start frame.
Use the next locked storyboard frame as the end frame.
Create a seamless transition where [object/character/action] moves from the
previous state into the next state without a visible cut or glitch.
```

### Bridge Pose Pattern

```text
Before generating video, create one or more intermediate pose stills for
[hard action]. Use them as motion references so the model can understand the
path from start to end.
```

## Video Claw Refinement Ideas

### 1. Add A Reference Board Artifact

Proposed artifact: `reference-board.json`

Suggested fields:

1. `assetId`
2. `path`
3. `role`
4. `sceneRefs`
5. `lockedAttributes`
6. `allowedUse`
7. `notes`

This would let prompts say "use the character close-up reference for texture"
instead of treating every image equally.

### 2. Expand Scene Prompt Structure

Current storyboard work already separates `scenePrompt` details. The reference
video suggests going further:

1. `imagePrompt`
2. `editPrompts`
3. `motionControlPrompt`
4. `motionVariantPrompt`
5. `transitionPrompt`
6. `negativeConstraints`
7. `preserveConstraints`
8. `referenceRoles`

### 3. Add Prompt History

Every scene should know how it was refined:

1. original prompt
2. selected output
3. edit prompt
4. defect removed
5. locked output
6. prompt variant attempts

This would make the final project auditable and reusable.

### 4. Add Continuity Frame Extraction

Generated clips should produce optional frame assets:

1. `startFrame`
2. `midFrame`
3. `endFrame`
4. `selectedContinuityFrame`

The next scene can then consume `previousScene.selectedContinuityFrame`.

### 5. Add Bridge Pose Recommendations

A prompt-quality check should recommend bridge poses when a scene contains:

1. catching or throwing
2. hand-object contact
3. object escaping a screen or board
4. character pose change
5. logo transformation
6. complex multi-object choreography

### 6. Add Variant Strategy To Execution Plans

A scene should declare how many attempts to generate:

1. one control pass with the detailed prompt
2. one or more short variant passes
3. optional bridge-pose pass
4. optional transition-only pass

This fits the existing scene candidate direction in the repo.

### 7. Add Post Plan Metadata

The final edit matters. Add a post-production plan with:

1. voiceover file
2. target scene durations
3. retiming notes
4. expected speed-up ranges
5. music or sound-design notes
6. final logo reveal timing

## Suggested Agent Handoff

Use this note as the input for a follow-up implementation planning agent:

```text
Read docs/REFERENCE_VIDEO_SEEDANCE_MOTION_DESIGN_WORKFLOW.md and inspect the
current Video Claw storyboard, execution, prompt-quality, scene-candidate, and
readiness modules. Propose a small, staged implementation plan that brings the
reference workflow into Video Claw without adding dependencies. Prioritize
artifact schema changes, CLI review output, and tests. Keep the plan reversible.
```

## Recommended Next Build Sequence

1. Add reference-board artifact support.
2. Extend storyboard review markdown to display reference roles and prompt
   history.
3. Add continuity-frame fields to execution reports.
4. Add prompt-quality warnings for missing start/end frames, missing bridge
   poses, mixed still/motion prompts, and oversized motion beats.
5. Add a `postPlan` section to execution reports.
6. Add tests around schema validation, markdown rendering, and CLI output.

## Bottom Line

The idea is strong and directly applicable to Video Claw. The reference workflow
is not just "better prompting"; it is a production system:

1. assets are organized by role
2. still frames are locked before motion
3. prompts are iterated and audited
4. transitions are built from start/end frame continuity
5. hard actions are decomposed into bridge poses
6. final pacing is handled deliberately in post

Video Claw already has the right foundation for this. The next useful step is
to make these techniques first-class artifacts instead of ad hoc operator
behavior.
