---
name: video-framework
description: Unified OMX-native front door for creating videos by routing across copy, create, narrated, presentation, long-form, film, and UGC workflows while reusing proven legacy engines behind adapters.
---

<Purpose>
Video Framework is the flagship OMX-native video production surface. It gives users one place to start — “make me a video” — and then internally routes to the appropriate workflow mode while keeping the public experience inside OMX.
</Purpose>

<Use_When>
- The user wants to make a video, copy an ad, generate a product video, create a narrated explainer, restyle a presentation, or run a longer-form cinematic workflow
- The user wants a unified OMX-native experience instead of raw Python/Bun scripts
- The task should reuse legacy `veo-cli` and `vclaw-video-core` capabilities behind adapters
</Use_When>

<Do_Not_Use_When>
- The user only wants a single static image
- The user wants low-level backend debugging on a specific legacy script without the OMX product surface
- The user is asking for a generic non-video orchestration task
</Do_Not_Use_When>

<Current_Product_Boundary>
This skill is the new front door. It should:
- classify requests into internal modes such as COPY, CREATE, COPY NARRATED, PRESENTATION, LONG-FORM, FILM, and UGC
- gather missing inputs and preferences
- prefer OMX-native orchestration and `.omx/` state
- reuse legacy engines behind wrappers instead of exposing raw scripts directly

Initial migration direction:
- `veo-cli` is treated as a backend/service adapter source
- the imported `skills/video-replicator/` tree is treated as the legacy
  workflow/phase-engine reference set
- the public UX should not leak `.claude` path assumptions, printed MCP commands, or raw Python/Bun entrypoints

Reference guides:
- `references/checkpoint-protocol.md`
- `references/stage-directors.md`
- repo-local follow-on skills:
  - `skills/video-analyze-template/SKILL.md`
  - `skills/video-clone-ad/SKILL.md`
  - `skills/video-storyboard/SKILL.md`
</Current_Product_Boundary>

<Example_Requests>
- "make me a product ad video from these assets"
- "copy this ad with a new subject"
- "create a narrated explainer video"
- "turn this presentation into an animated video"
- "start a cinematic film workflow for this concept"
</Example_Requests>
