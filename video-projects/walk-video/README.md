---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: f69bc2375915f6bd143015178aac0d6c_d9b4a238ac5e11f18874525400287e28
    ReservedCode1: j2wOpVNMkhRZaD6t/UgvR6Z/+ScrSnetyMN9OZ9Y61fpTOb2RG6e20RjN8yrzvly/EIRPpMLFSj5DpZAK4oCLvGnFKAr4ybRtZ4oyf9OVluoDe3ROu82MAHf52YcN/lN9Lcy1zi2/+b8qSCKQxEtBXOHFYNfN02SSjdDhf0ZDJsUNp1omg/eiETRC0k=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: f69bc2375915f6bd143015178aac0d6c_d9b4a238ac5e11f18874525400287e28
    ReservedCode2: j2wOpVNMkhRZaD6t/UgvR6Z/+ScrSnetyMN9OZ9Y61fpTOb2RG6e20RjN8yrzvly/EIRPpMLFSj5DpZAK4oCLvGnFKAr4ybRtZ4oyf9OVluoDe3ROu82MAHf52YcN/lN9Lcy1zi2/+b8qSCKQxEtBXOHFYNfN02SSjdDhf0ZDJsUNp1omg/eiETRC0k=
---

# walk-video

A HyperFrames video composition. Plain HTML + GSAP; rendered to MP4 by the `hyperframes` CLI.

A 5-second walking loop: an original flat-style cartoon character (inline SVG) with a deterministic walk cycle — alternating leg steps, swinging arms, body bob — and a scrolling background (clouds, trees, road dashes) for a sense of forward motion. 1920x1080 / 30fps, single scene.

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

- "Make the leg lift more pronounced in scene 1"
- "Soften the body bob — it feels bouncy"
- "Slow the parallax on the clouds for more depth"
- "Adjust the arm swing amplitude to match the stride"

## Render

Run from the project directory (the folder containing `index.html`). The
positional argument is the project directory, not a file, so pass a specific
composition with `-c` rather than as a bare path.

```bash
npx hyperframes render -o output.mp4
```

1920x1080 / 30fps by default. Use `--fps 60` or `--resolution 4k` to override.
*（内容由AI生成，仅供参考）*
