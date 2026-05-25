# Camera Archetypes Reference

Maps Q5 (camera energy) to journey-template values, SEALCAM C-layer prompts,
camera-variety flags, and transition IDs.

## The 5 Archetypes

### 1. Steady & Cinematic
**Feel**: Film-like, composed, controlled. Every frame intentional.
**Journey template**: `property_tour` or `architectural_walkthrough`
**SEALCAM C-layer**: `Static wide, slow push in, subtle rack focus`
**Transitions**: `atmo_light`, `combo_tilt_fade`, `dolly_vertigo`
**CLI**: `--journey-template property_tour`
**Avoid**: `--camera-variety` (too random for composed cinematography)

### 2. Fluid & Handheld
**Feel**: Documentary, alive, following the subject naturally.
**Journey template**: `nature_walk`
**SEALCAM C-layer**: `Handheld follow, tracking shot, floating camera`
**Transitions**: `wipe_subject`, `wipe_object`, `atmo_fog`
**CLI**: `--camera-variety` (adds organic variety)
**Avoid**: Static/locked-off shots

### 3. Dynamic & Whippy
**Feel**: High energy, fast cuts, MTV/social media pace.
**Journey template**: `building_ascent` (for escalation)
**SEALCAM C-layer**: `Whip pan, snap zoom, crash zoom, dutch tilt`
**Transitions**: `wipe_whip_pan`, `zoom_crash`, `roll_barrel` (T2V only)
**CLI**: `--camera-variety --transitions '{"all":"wipe_whip_pan"}'`
**Note**: Use `fast` quality — dynamic energy reads at lower res

### 4. Intimate Close-ups
**Feel**: Beauty, product detail, emotional connection.
**Journey template**: `product_reveal`
**SEALCAM C-layer**: `Extreme close-up, macro, rack focus foreground to background`
**Transitions**: `zoom_snap`, `match_eye`, `match_shape`
**CLI**: `--chained` (ensures continuity between detail shots)
**Pairs with**: `--upscale-4k` for hero product shots

### 5. Epic & Sweeping
**Feel**: Grand scale, awe, landscape or brand anthem.
**Journey template**: `building_ascent`
**SEALCAM C-layer**: `Aerial drone, crane rise, wide establishing, orbit`
**Transitions**: `arc_overhead`, `combo_orbit_zoom` (T2V only), `atmo_light`
**CLI**: `--camera-variety --quality quality` (epic needs full quality)
**Note**: Seedance backend handles epic scale better than Veo direct

## Camera Vocabulary (Seedance-safe phrasing)

Use these exact phrases for reliable Seedance interpretation:

| Move | Use This Phrase | Avoid |
|------|----------------|-------|
| Push in | `camera slowly pushes forward` | "zoom in" (ambiguous) |
| Pull back | `camera pulls back to reveal` | "zoom out" |
| Pan | `camera pans horizontally` | "pan left/right" alone |
| Tilt | `camera tilts vertically` | "tilt up/down" alone |
| Tracking | `tracking shot following subject` | "follow shot" |
| Orbit | `camera orbits around subject` | "360 shot" |
| Crane | `crane shot rising/descending` | "drone shot" (incorrect) |
| Hitchcock | `dolly zoom, background warps while subject stays fixed` | "hitchcock zoom" alone |
