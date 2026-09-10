---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: f69bc2375915f6bd143015178aac0d6c_da90fdafac5e11f18f50525400aeaaa3
    ReservedCode1: bhrmtGP4IUG584wZsk0LIA+2G/OyrGIlj20yvwteJMLcyZwK6a7xALsJJBjrRoUZxzq7Ywp+8cTCku+8XP7FthPtghJqCdkrkXYmNwXD6r17m8crYDu7i01tvINpdNlcTdaI2URWrvHMIKngmC2+05/eU8U88gPQSQGnaprksd7KXNATgDyPPWa3a8Y=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: f69bc2375915f6bd143015178aac0d6c_da90fdafac5e11f18f50525400aeaaa3
    ReservedCode2: bhrmtGP4IUG584wZsk0LIA+2G/OyrGIlj20yvwteJMLcyZwK6a7xALsJJBjrRoUZxzq7Ywp+8cTCku+8XP7FthPtghJqCdkrkXYmNwXD6r17m8crYDu7i01tvINpdNlcTdaI2URWrvHMIKngmC2+05/eU8U88gPQSQGnaprksd7KXNATgDyPPWa3a8Y=
---

# DESIGN.md — Walk Cycle ("Every Step Counts")

Design decision document for the HyperFrames composition in this directory. Drafted in Claude Design following the Template-First (Download-ZIP) creative guide.

## Concept

A quiet, hopeful 5-second vignette: an original flat-style cartoon character walks forward on a scenic path while the world scrolls past. No dialogue, no cut — the whole clip is one continuous walking loop. The visual story: "every step counts," literally and figuratively.

- Aspect ratio: 1920x1080 (16:9), 30fps (HyperFrames render default)
- Duration: 5 s, 1 scene (no shader transitions by design — this is a continuous motion piece)
- Structure: plain HTML + CSS + one paused GSAP timeline

## Technical choices

- **Single scene** (`data-start="0" data-duration="5"`, root `data-duration="5"`), scene windows tile end-to-end.
- **No `HyperShader.init()`** — the piece is one continuous shot. All motion is carried by entrance tweens plus sustained mid-scene loops; nothing needs a transition shader.
- **Character built from layered SVG groups**: `#char` (position/bob) contains `#leg-l/#leg-r/#arm-l/#arm-r` (`.limb` groups rotated/lifted at hip and shoulder pivots via `transform-box: fill-box; transform-origin: 50% 0%`), plus torso, head, cap and face details. Original flat-style design, no external assets.
- **Background scroll** uses seamless periodic repetition: road dashes (`stroke-dasharray="120 200"`, period 320), tree row (period 320) and cloud row (period 960) all translate by exactly −960 px (an integer number of periods), so the end layout matches the start layout — a looping "walking in place, world moving" effect.

## Palette

Defined in `:root`; chosen to avoid tired "cyan-on-dark" and pure black/white defaults — a warm dusk palette:

- `--bg: #121c2b` — deep blue-night canvas
- `--ink: #f7efdf` — warm cream text
- `--accent: #ff8a5c` — warm coral (character clothing, shoes, kicker)
- `--accent-dim: #b84a2c` — deep terracotta (belt, cap, contrast)
- `--muted: #9fb0c4` — steel blue-grey (sub-line)
- `--pant: #2e4057` — denim blue trousers
- `--skin: #ffd7b0` — light skin tone
- `--hair: #3b2a20` — dark brown hair
- `--ground: #1a2738` — rolling ground band
- `--sun: #ffc36e` — setting sun / halo

Sky is a `linearGradient` (#1c2a3f → #0f1826) drawn as the first SVG rect.

## Typography

Avoiding the banned list (no Inter/Roboto/Open Sans/Lato/Poppins/Outfit/Sora/Fraunces/Playfair Display/Nunito/Source Sans/PT Sans/Arimo and banned pairings):

- Display headline: **Bricolage Grotesque** (800), 64 px, "Every Step Counts" — per-character stagger entrance
- Kicker label: **Space Mono** (400), 16 px, letter-spaced, "A 5-SECOND WALK"
- Sub line: **Work Sans** (400), 22 px, "keep moving forward"

Sizes respect video minima (60px+ headline, 20px+ body, 16px+ labels).

## Scene / animation plan (single scene, s1: 0–5s)

### Entrance tweens (tl.from)

| Target | From | Ease | Window |
|---|---|---|---|
| `#char` | x +150, autoAlpha 0 | power3.out | 0.12 – 0.67 |
| `#clouds` | autoAlpha 0 | power2.out | 0.30 – 1.10 |
| `#trees` | autoAlpha 0 | power2.out | 0.35 – 1.15 |
| `#kicker` | y +18, autoAlpha 0 | power2.out | 0.35 – 0.75 |
| `#title .char` (stagger from "start") | y +44, autoAlpha 0 | back.out(1.6) | 0.45 – ~0.95 |
| `#rm` (road dashes) | autoAlpha 0 | power2.out | 0.50 – 1.00 |
| `#sub` | autoAlpha 0 | power2.out | 0.70 – 1.20 |

### Walking cycle — deterministic loops (no Math.random / no repeat:-1)

All loop tweens use fixed `repeat` counts computed so they fit inside the 5 s window. Signature: leg-l / arm-l run 0.60–4.20; leg-r / arm-r are phase-offset by half a stride (start 1.05, end 4.65) for alternating steps.

| Target | Property | Tween | repeat (yoyo) | End |
|---|---|---|---|---|
| `#char` | y −12 (body bob) | 0.225 s sine.inOut | 7 | 4.20 |
| `#leg-l` | y −30 (left step lift) | 0.45 s sine.inOut | 3 | 4.20 |
| `#leg-r` | y −30 (right step, offset) | 0.45 s sine.inOut | 3 | 4.65 |
| `#arm-l` | rotation +16 (swing) | 0.45 s sine.inOut | 3 | 4.20 |
| `#arm-r` | rotation −16 (swing, offset) | 0.45 s sine.inOut | 3 | 4.65 |

### Background scroll — seamless, linear (ease: none, single tween)

All translate exactly −960 px over 4.0 s (0.60–4.60); −960 is an integer multiple of each element's repetition period, so the displaced layout is identical to the initial one → loop-safe.

| Element | Motion | Notes |
|---|---|---|
| `#rm` (road dash line) | x −960 | dash period 320 → 3 full periods |
| `#trees` (7 trees, spacing 320) | x −960 | 3 full periods |
| `#clouds` (period 960) | x −960 | 1 full period |

### Sustained accents

- `#title` float — y −6, 0.5 s sine.inOut, yoyo repeat 3 (0.70–4.70)
- `#halo` glow pulse — opacity 0.25→0.45, 0.66 s sine.inOut, yoyo repeat 2 (0.60–4.56)
- `#kicker` opacity pulse — 1→0.55, 0.7 s sine.inOut, yoyo repeat 2 (0.70–4.90)

Latest tween ends at 4.90 ≤ 5.00 — the timeline never exceeds the scene window.

## Hard-rule compliance

- **Determinism:** no `Math.random`, no `Date.now/performance.now`, no `setInterval/setTimeout`, no `requestAnimationFrame`, no `repeat:-1` (all repeats are finite integers), no `stagger from:"random"` (uses "start"). Loops sized via `duration × (repeat+1) × (yoyo?2:1)` fits the window.
- **Media:** no video/audio/base64/placeholder URLs.
- **Animation:** no exit tweens before shaders (no shaders at all); no `tl.set/tl.to` on scene containers; CSS `transform` not used for centering (absolute positioning instead); grain is `radial-gradient` CSS, **not** SVG filter `data:image/svg+xml`.
- **Structure:** `.scene.clip` + all data attributes; `.scene-content` wrapper present (padding zeroed, block layout); `window.__timelines["main"] = tl` matches `data-composition-id="main"`; `preview.html` copied verbatim from the guide.

## Known caveats / refinement suggestions for Claude Code

- **Front-view walk readability:** legs animate as alternate vertical lifts (positive stride reads as marching in place). A side/three-quarter camera angle with real stride swing would read as more natural — suggested polish if desired.
- **Arms** are single-segment with shoulder rotation; adding elbow bend (two-segment arms) would look more organic.
- **Body bob frequency** is twice the stride frequency (0.45 s vs 0.9 s gait); softer single-per-step bob may feel calmer.
- **Foot shadow** stays static while the character bobs — pairing shadow scale/opacity with the step phase is a good end-pass touch.
- Type & palette are placeholder creative choices; swap to the brand guide if one exists.
*（内容由AI生成，仅供参考）*
