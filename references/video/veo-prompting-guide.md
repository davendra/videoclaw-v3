# Veo Prompting Guide

## When to use

Use for:

1. direct local `veo-cli` execution
2. text-to-video shots
3. image-to-video shots where the first frame matters
4. cleaner cinematic motion with straightforward prompt structure

## Prompt formula

1. shot tag
2. optional image or frame reference
3. core scene description
4. visible action
5. camera movement
6. output framing or ratio intent

## Veo-specific guidance

1. Keep prompts literal and compact.
2. Prefer one scene and one main action per call.
3. Use the `image:` prefix for image-to-video.
4. Use the `frames:` prefix only when start/end frame control is explicit.
5. Avoid placeholder paths in real execution prompts.

## Adaptation checklist

1. Is the call text-to-video or image-to-video?
2. Does the prompt describe visible motion instead of brand strategy language?
3. Is the local `veo-cli` workspace present?
4. Does `cookie.json` exist for direct mode?
5. Is the expected output directory known before execution?

## Failure patterns

1. vague “make it cinematic” prompts without a visible action
2. long concept paragraphs passed straight to `google.ts`
3. mixed input modes in one prompt
4. missing first-frame image for i2v calls
