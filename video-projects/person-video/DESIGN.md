---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: f69bc2375915f6bd143015178aac0d6c_1781ea45ac5a11f18874525400287e28
    ReservedCode1: Wwi74b86AAqtF2kwEAs04nOiiPkXMbv5l/qIRivp2DJGQiV/GqQUAX60DIpzMvJJIs1F0sYCu5d21Pxc2lgRAZPOMT0pI3mJG8Lj/2IzHxWBIQXDdH+VO4z7FiZbywfunGPGqa/U+q7tpvqBWoIqrhYuEqsIpUV/goWkwwn5Cs8WbZoxeSx3hMuVKLE=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: f69bc2375915f6bd143015178aac0d6c_1781ea45ac5a11f18874525400287e28
    ReservedCode2: Wwi74b86AAqtF2kwEAs04nOiiPkXMbv5l/qIRivp2DJGQiV/GqQUAX60DIpzMvJJIs1F0sYCu5d21Pxc2lgRAZPOMT0pI3mJG8Lj/2IzHxWBIQXDdH+VO4z7FiZbywfunGPGqa/U+q7tpvqBWoIqrhYuEqsIpUV/goWkwwn5Cs8WbZoxeSx3hMuVKLE=
---

# DESIGN.md — Milo: Animated Character Intro

Generated from the `:root` custom properties and scene plan of the HyperFrames composition.
Project directory: `person-video/`. Files: `index.html`, `preview.html`, `README.md`, `DESIGN.md`.

## 1. Concept

A personal-intro brand film starring an original flat-illustration SVG character, **Milo** (a
friendly creative illustrator & motion designer). The story arc is a single rising narrative:

> Enter → Who am I → What can I do → Superpower reveal → Proof/portfolio → Numbers → Invitation → CTA

Short, punchy Chinese copy + English brand wordmark. Every scene reuses the same character in a
different pose (wave, point, think, draw, jump, hold-clipboard, raise-hand, arms-open), so the
viewer bonds with one consistent persona — the classic mascot-driven brand intro pattern.

## 2. Technical choices

| Decision | Value | Why |
| --- | --- | --- |
| Skeleton | **Skeleton B** — Launch Teaser (1920x1080, ~25s, 8 scenes) | Brand-film format fits 16:9 launch-teaser timing; guide's recommended type for a 25s, 8-scene narrative |
| Composition id | `main` | Matches `data-composition-id="main"` and `window.__timelines["main"]` |
| Total duration | 25s | Scene windows tile end-to-end: `0,3,6,9,12.5,15.5,18.5,21.5` |
| Scene durations | 3 / 3 / 3 / 3.5 / 3 / 3 / 3 / 3.5 | Allocate by text/read time; never exceeds the 5s hard ceiling |
| Shader transitions | 3 (out of 7 cuts) | `cinematic-zoom` (hero reveal), `light-leak` (energy shift to CTA group), `cross-warp-morph` (CTA landing) |
| Anchor scenes | s4, s5, s7, s8 (`opacity:0`) | Bracketing the three shaders, per HyperShader anchor rule |
| Non-anchor scenes | s1, s2, s3, s6 (`visibility:hidden`) | Toggled via `tl.set(autoAlpha)` at both window edges |
| First-anchor shows | `tl.set("#s4",{opacity:1},9)` and `tl.set("#s7",{opacity:1},18.5)` | Required so the first anchor in each shader group is visible |

## 3. Palette (`:root`)

Reasonable default for a warm, studio-like creative brand (avoids generic cyan-on-dark / pure black).

```css
--bg: #1b1530;         /* deep plum — base backdrop */
--bg-deep: #120e22;    /* darker footer-layer plum */
--ink: #fbf0df;        /* warm cream — primary text (avoid pure #fff) */
--accent: #ff7a5c;     /* coral — primary accent */
--accent-soft: #ffb547;/* sun gold — secondary accent / highlights */
--muted: #b4a8cf;      /* lavender grey — secondary text */
--accent-dim: #8a3a2b; /* dimmed coral for depth/grain moments */
--line: #2c2340;       /* dark plum line / character ink */
```

Character internal palette: skin `#ffd9b8`, hair/ink `#2c2340`, shirt coral `#ff7a5c`,
pants gold `#ffd166`, shoes `#c98f2f`, cheek blush `#ffb3a0`.

## 4. Typography

| Role | Font | Size floor | Notes |
| --- | --- | --- | --- |
| Display | **Bricolage Grotesque** 700/900 | 96–176px headlines | Expressive modern grotesque; not on the banned list; dramatic weight contrast vs body |
| Body | **Work Sans** 300/500 | 30–46px | Light, readable supporting text; not banned |
| Data | **Space Mono** 400/700 | 44–96px | Monospace, `font-variant-numeric: tabular-nums` on counters/stats |

Avoided per guide: Inter, Roboto, Poppins, Outfit, Sora, Nunito, Lato, Open Sans, Playfair,
Fraunces etc. (all on the banned list). Pairing "Bricolage Grotesque + Work Sans + Space Mono" has
no forbidden pairing conflicts.

## 5. The character (Milo)

Drawn entirely as inline SVG (no external assets, no data-URL images, no base64 media). One
consistent mascot with interchangeable poses via per-scene arm groups / heads / props:

| Scene | Pose | Prop / detail |
| --- | --- | --- |
| 1 — opener | Waving hello, slides up from bottom | Raised hand, highlight dots |
| 2 — intro | Pointing toward his name | Big wordmark MILO |
| 3 — skills | Thinking, hand under chin | 4 skill chips + markers |
| 4 — hero | Drawing with a paintbrush | Swoosh stroke path + orbiting sparkles |
| 5 — works | Jumping, holding a framed card | Portfolio stat grid |
| 6 — data | Standing with a clipboard | 4 stat counters + progress bars |
| 7 — close | Curious, one hand raised | Question headline + sparkles |
| 8 — CTA | Arms wide open, smiling | Big CTA + button |

Character parts (head, arms) are animated with GSAP `svgOrigin` for pivot-accurate rotation;
containers use CSS wrapper floats.

## 6. Scenes & animation plan

Every scene = entrance tween(s) (offset 0.2–0.5s into the scene) + **≥2 sustained mid-scene
motions**. Patterns used across the film: character stagger, counter animation, SVG stroke draw,
breathing float, highlight sweep, bar-chart fill, rotation/orbit, glow pulse, dot drift.

| # | Window | Beat | Entrance | Mid-scene motion |
| --- | --- | --- | --- | --- |
| s1 | 0–3 | Opener | role slide, kicker char stagger, sub fade | arm wave loop, role float, glow pulse, dots drift |
| s2 | 3–6 | Intro | role back-spring, title, name char stagger, desc | name highlight sweep, head bob, body float, dots |
| s3 | 6–9 | Skills | chip stagger, role rise | chip float, head nod, role drift |
| s4 | 9–12.5 | Hero (SHADER) | kicker, headline char stagger, sub, role scale-in | brush stroke draw, spark orbit, role/head float |
| s5 | 12.5–15.5 | Works | title, role hop, cards bar-fill | counter 0→120, card float, role hop loop |
| s6 | 15.5–18.5 | Data | headline, stat card stagger, role slide, bars fill | 4 counter animations, role float, glow pulse |
| s7 | 18.5–21.5 | Invite (SHADER) | kicker, headline char stagger, role scale-in | role float, spark pulse, arm raise |
| s8 | 21.5–25 | CTA (SHADER) | role scale, CTA char stagger, tag, button | role float, glow pulse, button bob; final exit |

## 7. Transition plan

```
s1─cut→s2─cut→s3─cut→s4 ──cinematic-zoom──▶ s5 ──light-leak──▶ (s6 interstitial) ──cut─┐
s6─cut→s7 ──cross-warp-morph──▶ s8
```

Invariant `scenes.length === transitions.length + 1` holds (4 anchors / 3 transitions). Each
transition time centers on its scene boundary (e.g. s4→s5 boundary 12.5 → `time: 12.25`,
duration 0.5). Most cuts are hard cuts — only key moments get shaders.

## 8. Determinism & hard rules applied

- No `Math.random()`, no `Date.now()` / `performance.now()`, no `setInterval` / `setTimeout`, no
  `requestAnimationFrame` — all motion is fixed GSAP tweens on a single paused timeline.
- No `repeat: -1` — every loop uses finite `repeat: 1` or explicit duration-bound tweens.
- No `stagger:{from:"random"}` — always `"start"`.
- Scene containers: anchors `opacity:0` (HyperShader owns); non-anchors `visibility:hidden` with
  `tl.set(autoAlpha)` toggles (NOT plain `visibility`) to survive the shader blanket reset.
- No exit tweens before shader transitions (shader IS the exit); only s8 has a final exit.
- No template literals in selectors; no SVG-filter grain (CSS radial-gradient grain used).
- Media rules: no `<video>`/`<audio>`; no base64; no placeholder URLs.

## 9. Caveats & open items

- Stats (120+ works, 6 years, 40+ brands, 98% satisfaction) are **fictional defaults** for the
  demo persona — replace with the real subject's numbers before shipping.
- Milo's design is an original placeholder mascot; refine facial expressions and brand-consistent
  palette as needed.
- The s5→s6→s7 zone uses the guide's pre-wired energy-shift shader (light-leak) with s6 as a
  runtime-managed interstitial — if it looks crowded, consider moving s6 to pure hard cut.
- Scene 4's brush stroke and scene 5's counter are the two spots most worth richer polish
  (evaluate longer stroke draw, additive twinkle on sparkles).
- Google Fonts are fetched from CDN at render/preview time — requires network connectivity.
*（内容由AI生成，仅供参考）*
