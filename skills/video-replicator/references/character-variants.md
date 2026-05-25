# Character Variant Management

*Last Updated: 2026-01-24*

When using Go Bananas character references, the model cannot reconcile mismatches between reference appearance and prompt requirements. This document explains how to handle character variants for different ages, styles, and appearances.

---

## The Problem

| Scenario | What Happens | Result |
|----------|--------------|--------|
| Young reference + "50 years old" in prompt | Model picks one or the other | Inconsistent - either young face or generic old man |
| Character ref + different hairstyle | Model ignores one | Wrong appearance |
| Same character, different age across scenes | Can't use same character_id | Need separate characters |

**Key Insight**: Reference images MUST match the desired appearance. The model will not age, restyle, or transform a character based on prompt instructions alone.

---

## Solution: Character Variants

Create separate character references for each distinct appearance:

```
Original:  "Ram Patel"        (ID: 27) - Young adult, 20s
Variants:  "Ram Patel 50"     (ID: 28) - Aged to 50
           "Ram Patel Formal" (ID: 29) - Formal attire variant
           "Ram Patel Casual" (ID: 30) - Casual style variant
```

### Workflow to Create an Aged Variant

1. **Generate aged version using original character as reference**:
   ```python
   mcp__go-bananas__generate_image(
       prompt="Ram Patel at 50 years old, distinguished Indian man, gray at temples, mature features, portrait headshot, professional lighting",
       character_id=27,  # Original young character
       aspect_ratio="9:16",
       model_id="gemini-pro-image"
   )
   ```

2. **Create new character from the generated image**:
   ```python
   mcp__go-bananas__create_character(
       character_name="Ram Patel 50",
       base_prompt="Ram Patel at 50 years old, distinguished Indian man, mature features, gray at temples",
       reference_image_ids=[generated_image_id],
       description="Aged variant of Ram Patel for father/mature scenes"
   )
   ```

3. **Use new character_id for relevant scenes**:
   ```python
   mcp__go-bananas__generate_image(
       prompt="Family walking together in snowy forest...",
       character_ids=[28, 25, 24],  # Ram Patel 50 + other family members
       aspect_ratio="9:16",
       model_id="gemini-pro-image"
   )
   ```

---

## Decision Flow

```
Scene Analysis
     ↓
Does scene require character appearance
different from existing reference?
     ↓
  ┌──NO──┐          ┌──YES──┐
  ↓      ↓          ↓       ↓
Use existing     Does variant
character_id     already exist?
                     ↓
              ┌──YES──┐  ┌──NO──┐
              ↓       ↓  ↓      ↓
           Use       Create new
           variant   variant:
           char_id   1. Generate with original char
                     2. Prompt: "Character at [age/style]"
                     3. Create new character from result
                     4. Use new character_id
```

---

## Rules for Character Matching

### Rule 1: Age Mismatch Detection

| Reference Age | Scene Requires | Action |
|---------------|----------------|--------|
| ~20s | 20s-30s | Use existing |
| ~20s | 40s-50s+ | Create aged variant |
| ~50s | 50s+ | Use existing |
| ~50s | 20s-30s | Create younger variant (rare) |

**Detection Keywords in Scene:**
- Age indicators: "50 years old", "elderly", "mature", "young adult", "teenager"
- Relationship indicators: "father", "grandfather", "mother", "daughter" (implies age)
- Temporal indicators: "years later", "as an older man", "in his prime"

### Rule 2: Style/Appearance Consistency

| Change Type | Action |
|-------------|--------|
| Clothing only | Use existing (clothing is in prompt, not ref) |
| Hair color/style | Create variant |
| Facial hair (beard/clean-shaven) | Create variant |
| Body type change | Create variant |
| Accessories (glasses, jewelry) | Usually safe to add in prompt |

### Rule 3: When NOT to Create Variants

- Same scene, different pose → Use existing
- Same character, different environment → Use existing
- Same character, different clothing → Use existing (clothing in prompt)
- Same character, different lighting → Use existing

---

## Variant Naming Conventions

Use consistent naming for easy identification:

| Pattern | Example | Use Case |
|---------|---------|----------|
| `{Name} {Age}` | "Ram Patel 50" | Age variants |
| `{Name} {Style}` | "Ram Patel Formal" | Style variants |
| `{Name} {Context}` | "Ram Patel Wedding" | Occasion-specific |
| `{Name} Young` | "Ram Patel Young" | Explicitly young version |

---

## Common Age Variant Prompts

**CRITICAL INSIGHT**: Keep prompts SIMPLE. The character reference already contains all facial features - you just need to tell the model the age change. Over-describing will cause the model to ignore the reference.

### The Working Pattern

```
{name} when his {age}
```

That's it. Don't add "distinguished", "gray at temples", "mature features" etc. The model handles aging naturally when you keep the prompt minimal.

### Examples That Work

| Age Change | Prompt | Why It Works |
|------------|--------|--------------|
| 20s → 45 | `ram when his 45` | Simple, lets model age naturally |
| 20s → 50 | `ram when his 50` | Just the name and target age |
| 30s → 70 | `priya when her 70` | Same pattern for any age |

### Examples That DON'T Work

| Bad Prompt | Problem |
|------------|---------|
| `Ram at 50, distinguished, gray temples, mature features, portrait` | Over-described - model ignores character ref |
| `Ram Patel aged to 50 years old with subtle aging lines around eyes` | Too verbose - confuses the model |
| `Same person Ram aged to 54, same face same features, Indian man` | Redundant - character ref already has this |

### Optional Additions

Only add extra details if you need something specific:

```
{name} when his {age}, with beard
{name} when her {age}, formal attire
```

---

## Multi-Character Family Scenes

When creating family scenes with multiple characters at different ages:

1. **Identify all characters and their required ages**:
   - Father (50s) → Need aged variant
   - Mother (45-50) → Need aged variant
   - Daughter (20s) → Can use young reference
   - Son (late teens) → May need young variant

2. **Create all needed variants FIRST**:
   ```python
   # Father variant
   mcp__go-bananas__generate_image(
       prompt="Ram Patel at 50...",
       character_id=27,  # Original
       ...
   )
   # Create "Ram Patel 50" (ID: 28)

   # Mother variant
   mcp__go-bananas__generate_image(
       prompt="Priya Patel at 48...",
       character_id=24,  # Original
       ...
   )
   # Create "Priya Patel 48" (ID: 29)
   ```

3. **Generate family scene with all correct variants**:
   ```python
   mcp__go-bananas__generate_image(
       prompt="Happy family walking together in snowy forest...",
       character_ids=[28, 29, 25, 26],  # Father 50, Mother 48, Daughter, Son
       aspect_ratio="9:16",
       model_id="gemini-pro-image"
   )
   ```

---

## Examples

### Example 1: Family Ad (Prada Winter Campaign)

**Original characters:**
- Ram Patel (ID: 27) - Reference photo is 18 years old
- Priya Patel (ID: 24) - Reference photo is 20 years old
- Riya Patel (ID: 25) - Reference photo is 18 years old
- Arjun Patel (ID: 26) - Reference photo is 16 years old

**Scene requirement:** "Father in his 50s walking with family"

**Problem:** Ram Patel reference is 18yo, but scene needs 50yo father.

**Solution:**
1. Generate aged Ram: `prompt="Ram Patel at 50 years old..."`, `character_id=27`
2. Create "Ram Patel 50" (ID: 28) from result
3. Use `character_ids=[28, 24, 25, 26]` for family scenes

### Example 2: Brand Story (Before/After)

**Requirement:** Show same person at age 25 and age 55

**Solution:**
1. Create base character "Alex" (ID: 40) from 25yo reference
2. Generate aged version: `prompt="Alex at 55..."`, `character_id=40`
3. Create "Alex 55" (ID: 41) from result
4. Use ID 40 for "before" scenes, ID 41 for "after" scenes

---

## Automation Support

### Check Character Match Before Generation

```bash
python scripts/generate_images.py \
  --project "prada-family-ad" \
  --character-id 27 \
  --check-character-match \
  --dry-run
```

This outputs a report showing which scenes need variants.

### Create Variants Script

```bash
# Analyze scenes and suggest variants
python scripts/character_variants.py --analyze \
  --analysis "projects/{slug}/analysis/rewritten_prompts.json" \
  --character-id 27

# Create aged variant interactively
python scripts/character_variants.py --create-variant \
  --source-character-id 27 \
  --target-age 50 \
  --new-name "Ram Patel 50"
```

---

## Best Practices

1. **Plan variants before starting image generation** - Analyze all scenes for age/style requirements
2. **Generate portrait headshots for variants** - Better reference quality than full-body shots
3. **Test variant consistency** - Generate 2-3 test images before using in production
4. **Document your variants** - Keep a mapping of character IDs to names/descriptions
5. **Use Pro model for variant creation** - Better adherence to the aging/styling instructions

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Aged variant looks like different person | Weak reference adherence | Use clearer base prompt, add distinctive features |
| Variant has inconsistent features | Single reference image | Generate 2-3 good variants, pick best for new character |
| Multi-character scene shows wrong ages | Using original IDs instead of variants | Double-check character_ids list |
| Variant creation fails | Conflicting prompt elements | Simplify prompt, focus on age/style changes only |

---

## Related Documentation

- `gobananas-guide.md` - Go Bananas prompt building and style presets
- `troubleshooting.md` - General troubleshooting guide
- `SKILL.md` Phase 3b.5 - Character evaluation workflow
