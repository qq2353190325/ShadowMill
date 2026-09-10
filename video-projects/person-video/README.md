---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: f69bc2375915f6bd143015178aac0d6c_166657daac5a11f1b128525400f8a581
    ReservedCode1: Riuob+CFGGcI6l3zq37FdeRtdmP+bpZOkt05/A+Z4sD/fbYDS7OH3G7Om2ZwBuHFubYG5bQMlf+o8PgZCNhhMmltMtZlq2BUy2W/g3pB7BgiEpfjGU1hxVaGB6lRCeSOs46pgni9zgoQKWny2fveILmFXsUXYk3/4OxqM8UuMA0qE28vEdQpUr10fV4=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: f69bc2375915f6bd143015178aac0d6c_166657daac5a11f1b128525400f8a581
    ReservedCode2: Riuob+CFGGcI6l3zq37FdeRtdmP+bpZOkt05/A+Z4sD/fbYDS7OH3G7Om2ZwBuHFubYG5bQMlf+o8PgZCNhhMmltMtZlq2BUy2W/g3pB7BgiEpfjGU1hxVaGB6lRCeSOs46pgni9zgoQKWny2fveILmFXsUXYk3/4OxqM8UuMA0qE28vEdQpUr10fV4=
---

# Milo — Animated Character Intro

A HyperFrames video composition. Plain HTML + GSAP; rendered to MP4 by the `hyperframes` CLI.

A 2D / SVG cartoon character (Milo) stars in a personal-intro brand film: he zooms in, introduces
himself, shows off his skill set, reveals his superpower, flips through his portfolio, drops the
numbers, then lands the CTA. 1920x1080, 8 scenes, 25 seconds.

## Requirements

- **Node.js 22+** -- [nodejs.org](https://nodejs.org/)
- **FFmpeg** -- `brew install ffmpeg` (macOS) or `sudo apt install ffmpeg` (Debian/Ubuntu) or [ffmpeg.org/download](https://ffmpeg.org/download.html) (Windows)

Verify: `npx hyperframes doctor`

## Preview

```bash
npx hyperframes preview
```

Opens the HyperFrames Studio at `http://localhost:3002` with frame-accurate scrubbing.

## Refine with Claude Code

This project was drafted in Claude Design. To polish animations, timing, and pacing:

```bash
npx skills add heygen-com/hyperframes   # install HyperFrames skills (one-time)
npx hyperframes lint                     # verify structure (should pass with zero errors)
npx hyperframes preview                  # open the studio for live feedback
```

Then open in Claude Code and iterate:

- "Make scene 3's entrance snappier"
- "Add a counter animation to the stat in scene 5"
- "Tighten the pacing -- scenes 4 and 6 feel too long"
- "Change the shader on transition 3 to glitch"

## Render

Run from the project directory (the folder containing `index.html`). The
positional argument is the project directory, not a file, so pass a specific
composition with `-c` rather than as a bare path.

```bash
npx hyperframes render -o output.mp4
```

1920x1080 / 30fps by default. Use `--fps 60` or `--resolution 4k` to override.
*（内容由AI生成，仅供参考）*
