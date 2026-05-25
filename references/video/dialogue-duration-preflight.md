# Dialogue Duration Preflight

Short clips need spoken lines that fit the available screen time.

Default budget:

1. assume 15 seconds when a scene has no `durationSeconds`
2. estimate dialogue at about 2.5 words per second
3. warn when estimated dialogue duration exceeds the clip target
4. promote warnings to errors only under strict director preflight

Rewrite guidance:

1. keep one spoken idea per shot
2. split multi-sentence explanations across scenes
3. use visuals for setup and proof instead of narration
4. reserve the final second for reaction, product beat, or transition
