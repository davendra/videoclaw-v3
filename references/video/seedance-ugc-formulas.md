# Seedance UGC Formulas

## When to use

Use for:

1. character-led product ads
2. UGC-style hooks
3. stylized social clips
4. short promotional scenes where motion and performance matter more than strict realism

## Prompt formula

1. subject identity
2. environment
3. primary action
4. camera movement
5. emotional tone
6. lighting and texture
7. audio cues if relevant
8. negative constraints

## UGC layer stack

For ad-style or creator-style scenes, keep the prompt grounded in production layers:

1. subject or presenter identity
2. product or offer context
3. first-second hook action
4. proof, demo, or reaction beat
5. hand, face, or product motion
6. camera move and shot size
7. lighting and practical texture
8. spoken line or caption intent when audio is enabled
9. transition or CTA beat

Use only the layers that matter for the shot. A short Seedance clip should not carry a full script, multiple locations, and multiple camera moves at once.

## Seedance-specific guidance

1. Prefer concise, concrete prompts.
2. Put the key action early.
3. Keep one main camera move per shot.
4. Use explicit continuity wording for recurring characters.
5. For character continuity, prefer reference images over purely textual reminders.

## Storyboard Image -> Seedance Motion

Use separate prompts for the still storyboard frame and the Seedance animation pass:

1. Storyboard image prompts describe static composition, character design, wardrobe, props, lighting, and framing.
2. Seedance image-to-video prompts describe only the motion to add to that source image.
3. Do not restate a full image-generation prompt in the Seedance prompt. Treat the imported frame as the source of truth.
4. Keep the Seedance prompt to one visible action and one camera move for a short clip.
5. Use natural motion and physics cues instead of abstract mood language.

### Image-import prompt template

```text
Use the imported source image as the exact visual reference. Preserve the composition, framing, character appearance, outfit, props, environment, lighting direction, and color palette. Animate only: [one visible action]. Camera: [one move]. Keep movement natural and physically plausible for a [duration]-second clip. Do not change identity, wardrobe, scene layout, or object placement.
```

Recommended duration wording:

1. `4-second clip` for a single gesture, reveal, product action, or facial reaction.
2. `5-second clip` for a short walk, turn, handoff, or simple camera move.
3. Avoid asking for scene changes, new locations, or multi-beat action in one Seedance pass.

Dialogue guidance:

1. Fit spoken dialogue to the clip length before execution.
2. Treat 15 seconds as roughly 35-38 comfortable spoken words.
3. Prefer one memorable line plus a visual proof beat.
4. Move disclaimers, dense explanation, and multi-sentence objections into separate scenes.

### Camera move vocabulary

Use one of these per shot:

1. `push-in` / `dolly in` - move closer to intensify attention on the subject.
2. `pull-out` / `dolly out` - move away to reveal context or product placement.
3. `tracking` - follow the subject laterally or forward through the frame.
4. `orbit` - move around the subject while keeping them centered.
5. `static` / `locked-off` - no camera travel; let performance or product motion carry the clip.
6. `crane reveal` - rise or descend to reveal scale, environment, or a product detail.

Shot-size terms are framing, not movement. `wide shot`, `medium shot`, and `close-up` can pair with one camera move, such as `wide shot, slow push-in`.

## Adaptation checklist

1. Does the prompt name one main subject?
2. Is the camera direction singular and readable?
3. Is the desired tone visible, not abstract?
4. Are unsafe brand/IP references removed?
5. Are continuity anchors stated when scenes are linked?

## Failure patterns

1. multiple unrelated actions in one prompt
2. too many adjectives without a concrete action
3. switching camera intent mid-prompt
4. implicit continuity with no reference asset
5. mixing static image-composition instructions with motion-only Seedance instructions
6. using both a moving camera and `static` / `locked-off` in the same prompt
