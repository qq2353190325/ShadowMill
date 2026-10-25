---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: f69bc2375915f6bd143015178aac0d6c_566161c2aff911f18874525400287e28
    ReservedCode1: n/C5UHkbt+XC6mkpM4VL9VQRQd3Dsoc+VZMHRkeuxPkaoSGJCTttJ/VxjAbsAfX0tg/SXnwD7YjPAQBajvZysJP/9v6lZdO+bUuF2cQaPPsZI+azcbIzv8Sdj84OVjS2y+uPuP7HC4KjfrB2KGVYFYWKmtFZR3OOcddmxIJ5i3grX3KOkEGru7E7hFI=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: f69bc2375915f6bd143015178aac0d6c_566161c2aff911f18874525400287e28
    ReservedCode2: n/C5UHkbt+XC6mkpM4VL9VQRQd3Dsoc+VZMHRkeuxPkaoSGJCTttJ/VxjAbsAfX0tg/SXnwD7YjPAQBajvZysJP/9v6lZdO+bUuF2cQaPPsZI+azcbIzv8Sdj84OVjS2y+uPuP7HC4KjfrB2KGVYFYWKmtFZR3OOcddmxIJ5i3grX3KOkEGru7E7hFI=
---

# ShadowMill — an all-in-one audio/video production pipeline

[简体中文](README.md) | **English**

A desktop app built with **Electron + Vue 3 + electron-vite + TypeScript**. It works at the granularity of a **project** and wires five production stages — **content script → voice-over → subtitles → HTML animation → video** — into one continuous pipeline. Every project maps to one local directory. Subtitles can be generated from the script's narration, or produced by **transcribing audio locally with the bundled whisper.cpp**. Video is **rendered locally by HyperFrames + FFmpeg** — neither speech recognition nor video rendering consumes any API quota.

> Engineering knowledge base (source-level notes, IPC contract, per-file docs) lives in [`wiki/README.md`](wiki/README.md);
> the changelog (a record of every change, per version — this is what to read before a release) lives in [`CHANGELOG.md`](CHANGELOG.md);
> the UI design spec (deep-space / Cyber UI colors and component style) lives in [`src/renderer/agents.md`](src/renderer/agents.md);
> the history of the Vue3 + TS refactor is in [`REFACTOR_PLAN.md`](REFACTOR_PLAN.md).

## Download

- **Latest release (v0.0.7)**: <https://chaoming-zhaoling.oss-cn-beijing.aliyuncs.com/shadowmill/ShadowMill%20Setup%200.0.7.exe>
- Platform: **Windows x64**, NSIS installer (`.exe`). A macOS build is not published yet.
- The install package **does not include** the rendering runtime (ffmpeg / hyperframes, ~146 MB in total). The app only *detects* what is missing on first launch; the download starts after you confirm it inside the app, and it can be cancelled. Speech recognition (`whisper-cli.exe`) ships with the installer, so transcription works offline right after installation.
- First run: fill in the custom model and the Qwen-TTS API key on the **Settings** page.

---

## 1. What it does

### 1.1 The five production stages

```
① Voice management  →  ② Voice-over   →   ③ Subtitles        →   ④ HTML generation   →   ⑤ Video preview
(cloned voices)        (text-to-speech /   (hand-written /       (custom-model agent    (play / locate
                        per-sentence align) script-generated /    streaming generation   the rendered MP4)
                                            whisper local ASR)    + render to video)
```

| Stage | Page | Highlights |
|---|---|---|
| — Content script | Content script | Per-scene "narration / visual direction / duration hint"; the shared content source for voice-over, subtitles and HTML generation (the **global visual style** is set on the ④ HTML generation page) |
| ① Voice management | Voice management (no sidebar entry; opened from "Manage voices" on the voice-over page) | Create a Qwen cloned voice by uploading / pasting audio; the input method switches automatically per target model; keeps a local Chinese display name bound to the model |
| ② Voice-over | Voice-over | Two tabs: "TTS synthesis" and "Subtitle voice-over (per-sentence alignment)" |
| ③ Subtitles | Subtitles | Entry editor, `[mm:ss]` / `[start-end]` timelines, two-way SRT editing and export, whisper transcription |
| ④ HTML | HTML generation | Set the **global visual style** and the canvas (output size); prompt-driven streaming generation / modification by an agent; embedded proportional preview; this page also holds the **role selection** for the current project |
| — Roles | Roles | The **global role library** (independent of projects): create a role, redraw how it looks, edit its info, delete it; each role exists once and every project ticks the ones it uses |
| ⑤ Video | Video preview | Play / locate the rendered MP4; **the "Render to video" button lives on the ④ HTML generation page** (with quality / frame-rate presets) |
| — Settings | Settings | Four blocks: custom model / Qwen speech / speech recognition models / default render presets |

### 1.2 Projects and pipeline state

- A project = one directory under `userData/projects/<project name>/`, holding `project.json`, `subtitle.txt`, `content.json`, `index.html`, `audio/` and `video/`.
- "My projects" on the home page: each card shows the **project name** (not the `title` in `project.json` — its default value only confuses users), a sub-line `HTML✓ / Video✓ / Subtitles✓` (`—` when absent) and "updated at YYYY-MM-DD HH:mm". Clicking a card switches the project and opens the "HTML generation" page; when the list is empty the page tells you to create one from the top "Working project" bar.
- The **step-bar** at the top shows the completion state of the five stages in real time and is clickable; the second row is the **working-project switcher** shared by all stage pages (the dropdown lists "My projects" only, its value is the project name, and it reads "No projects yet — please create one" when empty) plus **New project** and **Open folder** (opens the current project's directory). **New project is a modal**: click the button → type a name → Enter (or "Create and switch") creates and switches immediately; Esc / clicking the overlay / Cancel closes it, and closing or double-submitting is blocked while creating. The home page only selects / opens projects — **it no longer offers a create entry**.

### 1.3 Content script

Edit per-scene shots (narration / visual direction / duration hint) with add, move up, move down and delete; saving writes `content.scenes` in `project.json`, after which it becomes the shared content source for voice-over ("Load script narration"), subtitles ("Generate from script narration") and HTML generation (attached automatically). **The global visual style is not here** (it only feeds the HTML prompt; voice-over and subtitles never read it) — it is set on the ④ HTML generation page.

### 1.4 Voice-over

**Tab A · Text to audio (TTS synthesis)**

- Enter text + pick a voice (grouped into system voices / my cloned voices) + an optional file name (left empty, it is named automatically as "time_first five characters_voice id").
- **Three save locations**: the project's `audio/` (written back to `project.json`) · a custom directory (remembered) · the audio output directory (`userData/tts-output`, not written into the project). An "Open folder" button sits alongside so the current directory can be opened without waiting for the synthesis to finish.
- "Load script narration" can fill the text in bulk; the result can be auditioned (changing the speed only affects playback rate, not the file on disk).
- "Generated audio" lists past outputs grouped by source; each can be auditioned or **set as the current project's background audio** in one click.

**Tab B · Subtitle voice-over (per-sentence alignment)**

Synthesizes each subtitle line separately, then aligns them into one track in one of two modes:

- **Re-time subtitles (audio-driven, default)**: rebuilds the subtitle timeline from each sentence's measured duration; inter-sentence pauses are inferred from the original gaps in the subtitles first, falling back to the "inter-sentence pause (seconds)" setting (0–10 s, default 0.5) only when needed; audio is never speed-changed.
- **Fix audio (timeline-driven)**: subtitle times stay as they are; each sentence's audio is placed at its subtitle time (gaps filled with silence). When a slot does not fit, `atempo` speeds the clip up slightly first (**capped at 1.15×**); if it still overflows, the following sentences are pushed back and **the subsequent subtitle times shift along with them**.
- The result list shows, per sentence, the subtitle start / audio start / measured duration and a status badge (normal / sped up / pushed back by N s), and any single sentence or the whole track can be auditioned. "Write into current project" writes both the **millisecond-precision** aligned subtitles and the track back into the project.
- Progress has two phases (per-sentence synthesis → alignment and assembly) and can be cancelled (checked between sentences; the sentence currently being synthesized finishes first).

### 1.5 Subtitles

- **Entry editor**: add / edit / delete, timelines continue automatically, character and total-duration statistics; `[mm:ss]` precise timing and plain text lines (duration estimated from speech rate) can be mixed.
- **Two input modes**: "Edit one by one" and "SRT" (a standard SRT text area) convert into each other; the copy / export / save exits all apply the current edits first.
- **Copy subtitles**: copies plain text (without the timeline); **Export SRT file**: saves a standard `.srt`.
- **Generate from script narration**: creates entries in bulk from the content script's scene narration and duration hints.
- **Generate subtitles from audio**: transcribes the project audio, or any local audio file, into time-stamped subtitles with the bundled whisper.cpp; language can be auto-detected, Chinese (Simplified), Chinese (Traditional) or English; when done you choose "Replace existing" or "Append to end", which writes the result back and saves automatically. Transcription runs on the local CPU and consumes no API quota.

### 1.6 Generating HTML

- A **requirement description (prompt)** drives a custom-model agent; the action row holds **two side-by-side buttons** — **"Generate HTML"** (the primary button: ignores the current page and builds a fresh one) and **"Modify as requested"** (modifies the current page as requested, outputs the whole page and overwrites it; disabled while there is no HTML yet). The difference is conveyed by the **inline help `?` inside each action button** (hovering shows only that action's own explanation), never by adaptive button wording. With HTML already present, "Generate HTML" **overwrites directly — one click executes, with no second confirmation** (the label is always "Generate HTML"; use "Download HTML" first if you want a copy). During generation the phase progress and the **AI's raw reasoning** are shown live.
- **Project materials** can optionally be injected into the prompt: subtitles (the current project / other projects that have subtitles) and video material (the agent embeds it as a muted, autoplaying `<video>` and choreographs playback with GSAP). Video material has **exactly one selection entry** (inside the "Project materials" block): the dropdown lists the project's existing materials and also offers "Choose a local video file…" to import one on the spot (copied into the project's `video/` directory, **selected immediately on import**, so there is no second step elsewhere); choose "Do not use video material" to skip it for a run.
- **Background audio is not part of the prompt**: it is chosen in the "Preview" card below (local audio / the "Generated audio" list / extract the original audio from the video) and written straight into the HTML's `<audio id="myv-bgm" autoplay loop>` by the app — select or change it and reload the preview to hear it. It never enters the prompt and is never handed to the agent.
- **Preview**: an embedded iframe scaled proportionally from 1920×1080, with pause / play / replay and a progress bar.
- **Download HTML** to any local location (a single file is exported; relative references to the project's `./gsap.min.js` are rewritten back to the pinned CDN URL so the export opens standalone elsewhere with a network connection). Once the HTML changes, the previous video output is invalidated automatically.
- **Render to video**: the "Render to video" button in the action row hands the project's `index.html` to HyperFrames, which renders an MP4 in the background (the page's `<audio id="myv-bgm">` track is extracted and mixed in by the CLI itself — the app does no ffmpeg mixing); when done, the output path is written back to the project and the user is pointed to the "Video preview" page. Render progress is pushed back live as Chinese phase messages.
- **Render presets**: **quality** (fast preview / standard / high quality) and **frame rate** (30 / 24) can be chosen below the action row; defaults are configured on the Settings page and can be overridden per project (the appearance of a "Restore default presets" button means this project has custom presets).
- Next to the "Video material" dropdown on that same row there are "Remove video" and **"Extract original audio as background audio"** (ffmpeg to AAC 192k, injected into the HTML audio track immediately after extraction) — importing, removing, extracting the original audio and previewing materials all live in this one place; there is no separate "Import as project material" card any more.

### 1.7 Roles (global role library)

A role is **one shared drawing function** (not an image): `window.__cast["id"](x, y, u, o)` draws a character, and chapters only decide when and where to call it. Roles **exist only globally** and have nothing to do with projects — you can create, edit and preview them with no current project at all.

- **"Roles" page** (its own sidebar entry, project-independent): every card shows a static preview produced by actually **running that role's drawing code**; "New role" (top right) asks the model once to draw one from your description; the card's "…" menu offers **Redraw…** (repaint on top of the existing code, replacing the library copy), **Edit info…** (name / description / style / height / watercolour — no model call), **Copy id** and **Delete**.
- **Action demo** ("Roles" page · **double-click** a card, or "…" → "Action demo…"): a role carries no animation of its own — it reads a set of parameters the caller feeds it over time (leg swing / arm angles / expression / blink / offset / rotation / squash). So **one "action" is a curve of "time → those parameters"**, and playing it never touches the role's code. The dialog shows a **live, animated figure** on the left and two action groups on the right: **shared actions** (14 built-ins: breathe / blink / wave / raise both arms / walk / run / jump / sway / crouch / happy / angry / surprised / talk / slump, plus your own; every role can play them) and **this role's own actions** (generated by AI after reading that role's source, so it can use parameters only this role has — a cat's tail, four legs). Click one to play it instantly; switching does not reload the page.
  - **New action…**: a keyframe table — one row per time point, one column per parameter (`dy/dx/aL/aR/rot/sq/walk/blink` are numbers, `eyes/mouth` are expressions; `mouth` set to "auto" means *don't send it*, letting the role decide the mouth from the expression). You can tick "this role only". Built-ins are read-only; editing one becomes "save as a copy".
  - **AI generate…**: one sentence (e.g. "trot on all four legs, tail swinging") plus duration and whether it loops; the model reads the role's code first and writes an action exclusive to that role.
  - **Redraw…** at the bottom opens the same redraw dialog for that role. **Actions are demo-only and do not go into the film**: in rendered videos the chapter still drives the role's animation from time.
  - Data lives in `<userData>/cast-library/actions.json` (same directory as the role library); deleting a role also removes its own actions. Watercolour (p5) roles still only show their Canvas-2D part on this page.
- **"HTML generation" page · Roles**: selection only — a tick means this project uses that role. When generating or modifying, the app copies that drawing code from the library into the project and injects it into the page (`<script src="./cast/<id>.js">`); the model may only call it, never redraw it. **Creating and redrawing roles happen only on the "Roles" page**; the HTML page cannot change how a role looks.
- **The library owns the metadata**: `project.json` only records "which roles this project uses and whether each is ticked", while name / description / style / height are always read back from the library — rename a role or change its height and every project referencing it follows immediately. A role carries its **own visual style** (it no longer borrows the project's global visual style).
- **No migration logic**: no released version ever shipped "per-project roles", so the code does not scan projects and migrate them; the dev machine's existing project roles were copied into the global library once by hand (`cast-library.bak-<timestamp>` is the backup taken before that).

### 1.8 Video preview

- Opening "Video preview" loads the current project's rendered MP4 automatically and plays it inline; "Reload" re-reads it from disk (so re-rendering to the same path also refreshes), and "Show in folder" locates the file in the system file manager.
- When no output exists yet, the page guides you by project state: HTML present → render to video from the "HTML generation" page; no HTML yet → generate the HTML first.

### 1.9 Settings

| Block | Options | Notes |
|---|---|---|
| Custom model (OpenAI-compatible) | Base URL / model ID / API key / enabled | The only model entry point for HTML generation and modification; "Test connection" only succeeds when it receives actual model text output |
| Qwen speech | API key / target model | Required by voice management, text-to-audio and per-sentence aligned voice-over; the candidate model table ships with 7 entries |
| Speech recognition models (whisper.cpp) | 4 built-in tiers + custom models | Download / delete / set current / local usage statistics; can open the model directory; model files are not distributed with the app |
| Default render presets | Quality / frame rate | Global defaults for "Render to video" (the `render` section of `settings.json`); a project can override them on the "HTML generation" page, and the override wins |

Built-in recognition tiers (**ids and file names map one-to-one**; `base` and `base-q5_1` are two distinct tiers):

| id | File | Size | Speed | Use |
|---|---|---|---|---|
| `tiny-q8_0` | `ggml-tiny-q8_0.bin` | 43.5 MB | fastest | quick drafts, rough cuts of long audio, low-end machines |
| `base` | `ggml-base.bin` | 148 MB | fast | everyday transcription |
| `base-q5_1` | `ggml-base-q5_1.bin` | 59.7 MB | fast | regular subtitle generation (~40% of base's size) |
| `small-q8_0` | `ggml-small-q8_0.bin` | 264 MB | slower | clearly better Chinese accuracy; recommended for long audio |

Downloads go through the domestic mirror `hf-mirror.com`, are written to a `.part` file as they stream in and atomically renamed on completion, with progress pushed back live; model files outside the enumeration are listed as "unknown models" and can be brought under management with "Add custom model" (name / file name / download URL / size / description).

---

## 2. Implementation

### 2.1 Stack and architecture

- **Electron 44.7.0 (Chromium 152 + Node 24.21.0) + Vue 3.5 + electron-vite 5 + Vite 7 + TypeScript 7**; TypeScript across the board, with `main` / `preload` emitted as **CJS** (a hard requirement for sandboxed preload; no `"type": "module"` anywhere in the project).
- **No vue-router / pinia**: navigation goes through `goPage()` from the page registry (`src/renderer/src/pages/index.ts`), and global state is module-level `reactive` / `ref` singletons (`composables/useAppStore.ts`).
- Source layering:

```
src/
├─ main/       main process, 12 modules (an index assembler + 11 business/tool domains, all using the register(ctx) pattern)
│              index · hfEnv · settings · systemVoices · htmlAgent · projects · voice · ttsAlign · video · whisper · vad · updater
├─ preload/    index.ts (9 contextBridge namespaces) + index.d.ts (window.* types)
├─ shared/     ipc.ts (8 groups, 75 channel constants) · types.ts (cross-process payloads and the window API contract)
├─ renderer/   Vue UI: index.html · src/{main.ts, App.vue, assets/main.css, components/, composables/, utils/, pages/}
│              pages/ has one directory per page, 9 pages: Home · Content · TextTts · Subtitle · HtmlGen · VideoPreview · SoundCopy · Settings · About
└─ agent/      standalone ESM experiment scripts (outside the build graph, not packaged)
```

Static assets distributed with the app sit at the repository root:

```
vendor/gsap/gsap.min.js   # bundled GSAP 3.14.2 (offline rendering / preview), packed into the asar via build.files
resources/                # bundled runtime (ffmpeg / hyperframes+chrome / whisper), about 632 MB;
                          #   at packaging time scripts/pack-runtime.mjs splits it into two packs, ffmpeg.7z and hyperframes.7z,
                          #   neither of which is **shipped inside the installer** — they are downloaded after the user confirms
                          #   inside the app when first needed (cancellable);
                          #   only whisper/ goes through extraResources into the installer (without it transcription cannot work at all)
```

- **Single source of truth for the IPC contract**: channel names live in `src/shared/ipc.ts`; all payload, result and progress types live in `src/shared/types.ts`; the `window.*` signatures are defined once in `types.ts` as `PreloadApi` — the preload implementation is annotated as `PreloadApi['<namespace>']`, and the renderer mounts the same contract through `preload/index.d.ts`, so the two sides cannot drift apart.
- **Security boundaries**: `contextIsolation: true` + `nodeIntegration: false`; API keys stay in the main process's `settings.json`; the CSP meta tag forbids `unsafe-eval` (all SFCs are precompiled); the renderer has no `clipboard` module (copying goes through the main process via `app:copy-text`); all text is written via `textContent` / `escTxt()` to prevent injection; external programs always come from the bundled `resources/`, and `spawn` uses argument arrays without a shell.

### 2.2 Runtime data directories

```
userData/
├─ settings.json                 # five sections: customModel / voiceTTS / voiceProfiles / whisper / render
├─ projects/<project name>/
│  ├─ project.json               # project metadata: title/subtitle/htmlPath/videoPath/audioFile/videoMaterial/content/render…
│  ├─ subtitle.txt               # subtitle text ([start-end] text, millisecond precision)
│  ├─ index.html                 # the HyperFrames composition generated by the agent (+ the <audio id="myv-bgm"> background track injected by the app)
│  ├─ index.preview.html         # preview copy (CSP stripped + playback control script injected, generated from index.html, hence carrying the audio track)
│  ├─ audio/                     # copies of background audio and TTS results
│  ├─ cast/<id>.js               # role copies (the roles this project ticked, synced from the global library; a build artifact, not user-edited)
│  └─ video/                     # copies of video material
├─ cast-library/                 # **global role library** (the single source of truth for roles; a user asset you can back up / migrate)
│  ├─ index.json                 # per-role metadata: id / name / description / style / height / which bundled libs it uses
│  ├─ <id>.js                    # the role's drawing code (window.__cast["id"] = function (x, y, u, o) {…})
│  └─ actions.json               # action library: shared (common actions) + byCast[roleId] (per-role actions)
├─ cast-preview/<id>.html        # role preview pages (a static frame produced by running the drawing code; safe to delete)
├─ cast-preview/<id>.demo.html   # action demo pages (redrawn every frame per action, with play/pause; safe to delete)
├─ whisper/models/               # recognition models (ggml-*.bin, downloaded on demand)
├─ html-agent/chat.jsonl         # full transcript of every HTML generation / modification (raw reasoning, usage, per-phase timings)
├─ voice/align-<timestamp>/      # scratch directory for per-sentence alignment tasks (raw/seg/sil + the whole WAV), only the latest is kept
├─ hf-projects/html-video-<timestamp>/  # HyperFrames render working directory (output.mp4)
├─ tts-output/                   # target of "audio output directory (not written into the project)"
└─ preview-protocol.log          # hgpreview:// protocol request log, for diagnosing preview problems
```

### 2.3 Key technical points

- **TTS save location**: passed explicitly by the renderer (project `audio/` / custom directory / audio output directory); the main process resolves it as `saveDir → defaultOut → project audio/ → fallback`, and only writes back to `project.json` when the audio really lands in the project's `audio/`.
- **Per-sentence aligned voice-over**: each sentence is synthesized and then converted uniformly to 24 kHz mono (avoiding the timing drift caused by mp3 header/footer padding) → ffprobe measures the real duration → re-time or place according to the mode → concatenate with silence and assemble the whole track with `-c copy` (**no re-encoding**) → final whole-track duration check (a deviation above 0.3 s from the last sentence's endpoint is a failure). Mode B caps acceleration at 1.15×, and the duration must be re-measured after accelerating (absorbing frame-granularity error).
- **Local whisper transcription**: `spawn whisper-cli.exe -m model -f audio -oj --no-prints -pp`, scraping progress lines from stderr; formats the CLI does not natively support are converted to 16 kHz WAV with the bundled ffmpeg first; Chinese is converted from Traditional to Simplified automatically (opencc-js, falling back to the original text on failure); `transcription.segments` is parsed into the project's `[start-end]` millisecond-precision subtitles, which mix seamlessly with hand-written ones.
- **VAD silence trimming**: after transcription each segment goes through an energy VAD that pulls its end time back to the **actual end of speech** (only trimmed when leading silence ≥ 0.4 s and trailing silence ≥ 0.15 s; it only tightens and never expands, and at least 0.05 s is left between adjacent segments); it is a pure-function module with no parameters and no switch, and failures are skipped silently so transcription is never blocked.
- **Model management**: ids and file names map strictly one-to-one with no prefix or fuzzy ownership inference; downloads go through the domestic mirror, are written to a `.part` file as they stream in and atomically renamed in the same directory, so a dropped connection or an interruption never leaves a broken file that looks downloaded.
- **Streaming feedback for HTML generation**: pushes phases `connecting → thinking → writing → retry → done` (throttled to 300 ms), scrolling the model's raw reasoning live (last 20k characters); when a reasoning model burns its budget on thinking and produces empty or truncated output, it automatically retries with a raised budget (**32768 → 65536**); the full transcript of every generation / modification is written to `html-agent/chat.jsonl` (including each attempt's raw reasoning, `finish_reason`, `usage` and per-phase timings) for later analysis.
- **HTML compliance check**: before rendering to video the source must hit all three markers `data-composition-id` / `__timelines` / `gsap` (heuristic text matching); on the generation side it only warns, on the render side it is a hard gate.
- **GSAP localization (works offline)**: generated HTML always loads GSAP via `<script src="./gsap.min.js"></script>`, and the file comes from the bundled `vendor/gsap/gsap.min.js` (3.14.2) — all four stages (generate / save / preview / render) rewrite leftover CDN references into project-relative ones and copy that file (render and preview only touch copies, never the original). Timelines follow the HyperFrames contract as `gsap.timeline({ paused: true })` and are registered as an **object keyed by composition id** (`window.__timelines["<id>"] = tl`); the preview control script also accepts the array form of older outputs.
- **Render to video**: Node prefers **reusing the Node embedded in Electron** (running `electron.exe` with `ELECTRON_RUN_AS_NODE=1`; Electron 44.7.0 embeds Node 24.21.0, satisfying HyperFrames' >= 22 requirement), and only falls back to a system Node on failure (also requiring >= 22, resolved to a real absolute path to dodge nvm shims / WindowsApps aliases); the `env` returned by `findNode()` must be merged into the child process environment, otherwise `electron.exe` starts itself as an app. Before rendering the runtime is validated (the ffmpeg + hyperframes packs); if a pack is missing a confirmation dialog lets the user decide whether to download it (cancellable). Once ready, the bundled FFmpeg's `bin` is injected into the render process's `PATH` (with `HYPERFRAMES_FFMPEG_PATH` / `HYPERFRAMES_FFPROBE_PATH` set) and the bundled chrome-headless-shell is selected so no browser is downloaded during rendering; the quality / frame-rate presets travel with the `video:render` payload, and the main process assembles `--quality` / `--fps` against a whitelist (falling back to the CLI defaults `standard` / `30`).
- **Preview protocol `hgpreview://`**: in dev the renderer is served over http, and Chromium blocks `file://` iframes, so previews all go through the custom protocol `hgpreview://p/<project name>/<relative path>`; the main process maps the URL back to a file inside the project directory and validates against directory traversal (after resolution it must stay inside that project's directory), explicitly provides the MIME type and `Cache-Control: no-store`, and logs failures to disk for diagnosis.
- **Why a project still keeps a `cast/` copy of roles**: `hgpreview://` and the static server used by render-to-video both only allow files inside the project directory, while the single source of truth for roles is `userData/cast-library/`. So before writing anything to disk, the main process copies the roles this project ticked from the library into `<project>/cast/` (and removes the copies of roles that are no longer ticked); pages keep calling `window.__cast["id"]` as before. Those copies are build artifacts — they never show up in the UI and cannot be edited. Role preview pages are written separately to `userData/cast-preview/` (allowed by the `hgpreview://…?user=1` whitelist), so they work even with no current project.

---

## 3. Pipeline walkthrough

1. **Content script**: write per-scene narration / visuals / duration (optional but recommended — it is the shared content source for the next three steps).
2. **Voice-over**: synthesize speech from text; or use "per-sentence alignment" to generate an aligned voice-over from the subtitles. (Optional stage.)
3. **Subtitles**: write entries by hand, use `[mm:ss]` timing, generate from the script's narration, or transcribe audio with whisper; export / copy SRT. Saving lights up the "Subtitles" stage.
4. **HTML generation**: first pick materials in "Project materials" (all optional), then describe the desired result in the "Requirement description (prompt)" box (background audio is not here — pick it in the "Preview" area below and the app injects it into the HTML directly, it never enters the prompt); then click an action button — **"Generate HTML"** ignores the current page and builds a fresh one (**one click overwrites directly, with no second confirmation**), while **"Modify as requested"** changes the current page as requested (disabled while there is no HTML yet); if unsure, click the **`?`** inside the button to read that action's own hover text. The agent writes `index.html` back and refreshes the preview; when satisfied you can download the HTML or click "Render to video" (quality / frame-rate presets available) to render the current HTML into an MP4.
5. **Video preview**: open "Video preview" to inspect the result — inline playback, reload, show in folder; the output path was written back to the project by the previous step, which lit up the "Video" stage.

The whole pipeline shares state around the same "project" entity, with no disjoint operations such as "choose an HTML file".

---

## 4. HTML is produced by a user-configured model agent (important)

- **Generation**: the app ships no HTML template. After the requirement description is filled in (subtitles / video material optional; background audio is injected by the app and need not be written into the prompt), the main process submits the requirement together with the page's **global visual style**, the current project's **content script** (narration / visuals / duration) and the materials to your custom model; the agent produces HTML that follows the industry conventions (including `data-composition-id` and GSAP `__timelines`), which is written back to `index.html`, after which the app refreshes the preview and lights up the stage. After writing, the main process injects the background track `<audio id="myv-bgm">` into the HTML according to `project.audioFile` (the same rules in all three places: generate / modify / manual save).
- **Modification**: when HTML exists, click "Modify as requested" and the agent reworks the current source accordingly, overwriting it, refreshing the preview and clearing the now-stale video output (the UI entry is that button, going through `project:modify-html`, with the full current `index.html` in the prompt); **when there is no HTML, or "Generate HTML" was clicked (one click executes, no second confirmation), it goes through `project:generate-html`** (the prompt contains no existing page). These two channels / handlers are independent in the main process and were not merged.
- **Transport**: the `openai` SDK is preferred, falling back to a direct request to `${baseUrl}/chat/completions`; **both paths receive the stream with `stream: true`** and call back per phase as chunks arrive.
- **Retry with a raised budget on empty output**: when `max_tokens` is entirely consumed by thinking and the output ends up empty or truncated, the budget is raised automatically (32768 → 65536); if that still fails, a diagnostic error carrying `usage` is thrown, making quota problems distinguishable from gateway errors.
- **Model configuration**: Base URL / model ID / API key / enabled are set on the Settings page, and "Test connection" only passes when actual model text output is received; the API key is stored only in the local `settings.json`, read by the main process and never sent out through the renderer.
- **The app's responsibilities**: UI (requirement input / material selection / background audio selection / preview / pipeline state), writing files, **injecting the background track into the HTML**, exporting and dispatching renders; the actual creation of generation and modification is left to the agent.

---

## 5. Running and dependencies

```bash
cd E:\my
npm install

npm run dev        # development: starts the Vite dev server (127.0.0.1:5173) + Electron, renderer HMR
npm run build      # builds all three targets into out/
npm start          # starts from the build output (= electron-vite preview, requires npm run build first)
npm run typecheck  # runs the three tsconfigs serially
npm run runtime:pack  # packs resources/ into runtime packs (build/runtime-pack/{ffmpeg,hyperframes}.7z + .json; skipped when the source is unchanged, --only <name> repacks just one)
npm run pack       # runtime:pack + build + electron-builder --dir (unpacked directory, no installer)
npm run dist       # runtime:pack + build + electron-builder --win (NSIS installer)
```

> **Installation and first-run note (Electron 44)**: the Electron 44 npm package has **no `postinstall`**; the binary is instead **downloaded lazily on the first `require('electron')`** — so after `npm install` the `node_modules/electron/dist` directory may not exist yet, and **the first `npm run dev` triggers a ~150 MB download** (to install explicitly use `npx install-electron`, whose bin is `install-electron` → `node_modules/electron/install.js`). The download mirror comes from the `.npmrc` added at the repository root: `electron_mirror=https://npmmirror.com/mirrors/electron/` (that address 302-redirects to `https://cdn.npmmirror.com/binaries/electron/` and the downloader follows it; the CDN has no `/mirrors/` prefix, only `binaries/`). It differs in purpose from `build.electronDownload.mirror` in `package.json` — the latter only downloads the Electron runtime while electron-builder packages, and does not affect `npm install`.

**External dependencies**

- **Node.js ≥ 22**: required by the HyperFrames CLI. Two routes are tried in order: ① **the Node embedded in Electron** (`ELECTRON_RUN_AS_NODE=1` + `process.execPath`; Electron 44.7.0 reports Node 24.21.0 in practice; the probe prints `process.versions.node` with `-e` and requires `status === 0` plus a major version >= 22, and this reuse depends on Electron's `RunAsNode` fuse staying at its default enabled state) → ② a system Node (`NVM_SYMLINK` → `LOCALAPPDATA\nvm\nodejs` → `C:\Program Files\nodejs` → `where.exe`, also requiring >= 22 and resolved to a real absolute path to dodge nvm shims / WindowsApps aliases). `findNode()` in `src/main/hfEnv.ts` returns `{ cmd, env }` for both. **The bundled `resources/node/node.exe` has been removed entirely** (its old "fallback" was unreachable in the packaged app anyway); the price is that if the `RunAsNode` fuse is ever turned off in `build.electronFuses`, either node.exe must come back or a system Node ≥ 22 must become a hard prerequisite.
- **HyperFrames CLI**: bundled in `resources/hyperframes/` (including chrome-headless-shell); it can also be pointed at another location with the `HYPERFRAMES_CLI` environment variable.
- **FFmpeg / FFprobe**: bundled in `resources/ffmpeg/bin/`; a WinGet-installed `Gyan.FFmpeg` is also detected and injected into `PATH`.
- **whisper-cli.exe**: bundled in `resources/whisper/` (including the dependency DLLs) and shipped **inside the installer** via `extraResources`; **recognition model files are not distributed with the app** and are downloaded on demand inside the app.
- **GSAP**: bundled at `vendor/gsap/gsap.min.js` (3.14.2), no network needed; the version and update steps are in `vendor/gsap/README.md`.
- **Runtime packs (ffmpeg / hyperframes)**: together these are about 620 MB across 4900+ files and are **not shipped inside the installer**.
  `scripts/pack-runtime.mjs` packs each into its own 7z (`build/runtime-pack/{ffmpeg,hyperframes}.7z` plus a same-named `.json` manifest);
  once uploaded to the update source (the `url` directory of `app-update.yml`), the app **downloads them on demand when first used**:
  rendering to video needs ffmpeg + hyperframes, and extracting audio / per-sentence alignment / transcribing anything other than wav·mp3·flac·ogg needs ffmpeg.
  Both downloading and unpacking happen inside the app (with progress, cancellable; cancelling means no download and the operation that needed it is abandoned),
  and unpack into `%APPDATA%\shadowmill\runtime\<pack name>\`, after which nothing is downloaded again unless that pack's content changes.
  The installer only carries the unpacker `7za.exe` (`build/tools/`, about 1 MB) and `whisper/`;
  **in development** the project-root `resources/` is used directly, with no download or unpacking.
  Machines that cannot reach the update source can import an `ffmpeg.7z` / `hyperframes.7z` directly on the Settings page with "Install from local file…".

**First-time setup** (Settings page)

1. **Custom model**: fill in Base URL / model ID / API key and enable it (the only entry point for HTML generation / modification).
2. **Qwen speech**: fill in the DashScope API key and pick a target model (voice management and voice-over depend on it).
3. **Speech recognition models**: confirm `whisper-cli.exe: ready`, download at least one tier and "set as current" (only needed for transcription).

---

## 6. Status

### Done

- **The full five-stage pipeline works end to end**: content script → voice-over → subtitles → HTML → video; the step-bar reflects completion in real time, is clickable, and comes with a built-in working-project switcher and project creation.
- **① Voice management**: cloned-voice creation (switching automatically between "paste URL / upload file" per model), the system voice table, the cloud clone list, and management of local display names bound to models.
- **② Voice-over**: TTS synthesis (three save locations, load script narration, auditioning and speed adjustment, reuse of past audio, set as background audio) + **per-sentence aligned subtitle voice-over** (two modes, speeding up / pushing back, progress and cancellation, per-sentence result details, writing back to the project).
- **③ Subtitles**: entry editor (auto-continuing timelines), one-by-one / SRT in both directions, copying subtitles, exporting SRT, generation from the script's narration, local whisper transcription (replace / append, two-phase progress).
- **Speech recognition model management**: download / delete / set current / usage statistics for the 4 built-in tiers plus custom models, with mirror downloads and atomic writes.
- **④ HTML generation**: the two side-by-side buttons "Generate HTML" / "Modify as requested" plus **an inline `?` inside each action button** with hover help (one per action, describing only that action; no separate `?` at the end of the action row; "Modify as requested" is disabled while there is no HTML; "Generate HTML" executes on one click with no second confirmation; the main-process channels `project:generate-html` / `project:modify-html` remain independent and were not merged), streaming agent generation / modification, live display of the reasoning, automatic retry with a raised budget on empty output, material injection (subtitles / video), **the background track injected into the HTML by the app**, a 1920×1080 proportional preview with playback controls, HTML download, **render to video (with quality / frame-rate presets)** and transcript logging to disk.
- **Generation contract aligned with HyperFrames + GSAP localization**: the prompt requires `gsap.timeline({ paused: true })` and a `__timelines` object keyed by composition id (matching the official documentation); GSAP is bundled at `vendor/gsap/gsap.min.js` with project-relative references, and the four stages (generate / save / preview / render) rewrite leftover CDN references automatically, while the preview control script also accepts the array form of older outputs.
- **⑤ Video preview and rendering**: compliance checks, background rendering through HyperFrames with Chinese phase messages, **render presets (global defaults on the Settings page + per-project overrides)**, inline playback of the result with "Reload" and "Show in folder", and writing the output path back to the project.
- **Projects**: create (a modal, name → created and switched immediately) / switch / delete, saving subtitles and content scripts, background audio and video material management (including extracting the original audio), and the `hgpreview://` preview protocol.
- **Engineering**: full TypeScript coverage (`npm run typecheck` green), IPC payload types centralized in `shared/types.ts` as the single source of truth for `window.*`, CSP / sandbox / contextIsolation security boundaries, a complete electron-builder setup (the ffmpeg / hyperframes runtime packs are **not shipped inside the installer** — they are downloaded in-app after the user confirms, see "External dependencies · runtime packs" above), **Electron upgraded to 44.7.0** (HyperFrames reuses Electron's embedded Node, and the 83 MB `resources/node/node.exe` was removed entirely), and an installer that keeps only the Chinese and English Chromium language packs (`build.win.electronLanguages`, cut from 55 `.pak` files / 48.3 MB to about 1.1 MB).
- **Docs and change log**: `wiki/` is the source-level knowledge base and [`CHANGELOG.md`](CHANGELOG.md) is the single changelog — **one block per version, one entry per change** (`[新增]` / `[修改]` / `[修复]` / `[重构]` / `[优化]` / `[文档]` / `[工程]` plus scope and verification); a feature changed twice within a version is marked `[完整版]`, so every release shows exactly what changed. The conventions are in section 3 and conventions 3 and 4 of [`AGENTS.md`](AGENTS.md).

### Known limitations

- **Recognition models are not distributed**: before the first transcription you must download a model on the Settings page, and a missing `whisper-cli.exe` blocks transcription outright.
- **VAD silence trimming has no switch**: the thresholds and windows are fixed constants, so heavy background noise may prevent it from taking effect at all (a conservative behavior).
- **Aligned voice-over**: a single sentence is sped up at most 1.15×, beyond which it is pushed back; the last sentence gets no slot extension and is neither sped up nor pushed back; only one alignment task may run at a time, and cancelling is a soft interruption between sentences (the synthesis request for the current sentence is not aborted).
- **Local audio formats**: whisper-cli natively supports only flac/mp3/ogg/wav (other formats are transcoded automatically first); audio uploaded for cloned voices must stay under 10 MB after Base64 encoding; the VAD only parses 16-bit PCM WAV.
- **API keys are stored in plain text** in the local `userData/settings.json` and read only by the main process — they are never sent out; stronger security could later be added via Electron `safeStorage`.
- **HyperFrames reusing Electron's embedded Node depends on the `RunAsNode` fuse**: while it stays enabled, `process.execPath` + `ELECTRON_RUN_AS_NODE=1` works as Node; **if that fuse is ever disabled in `build.electronFuses` in `package.json`**, `findNode()`'s probe fails and silently falls back to a system Node — no error, but a Node copy must then be supplied again (put `resources/node/node.exe` back and include it in a runtime pack, or make "system Node ≥ 22" a hard prerequisite).
- **The runtime must be downloaded on first use**: the installer **no longer contains** ffmpeg and hyperframes (**measured: 257.6 MB → 105.08 MB**, which is the reason). On startup the app only **detects** and displays "the runtime needs to be downloaded" — it never downloads quietly; the first time you click "Render to video / Extract original audio / Per-sentence alignment" (or transcription requiring transcoding), a confirmation dialog explains what will be downloaded and how large it is (**measured: ffmpeg 42.6 MB, hyperframes 103.1 MB — about 146 MB for both**, on par with the old single 147.4 MB pack), and the download only starts when you click "Download runtime" (cancellable; cancelling means no download and the operation that needed it is abandoned). Once installed, the button in that dialog becomes **"Continue"**, and clicking it resumes the thing you were doing (**it does not start automatically**). Transcription itself is unaffected: `whisper-cli.exe` ships in the installer and works offline right after installation.
- **Runtime downloads are resumable**: the pack is written to `%APPDATA%\shadowmill\runtime\downloads\<pack>-<id>.7z.part`, and after a network drop a retry continues from where it stopped (the server must support `Range`, which OSS does by default); only clicking "Cancel" clears the partial file. Users upgrading from older versions (the ones whose installer carried `runtime.7z`) **keep using** their already-unpacked `runtime/<old id>/` directory, and only download a pack when that pack actually changed; once both packs are in place the old directory (632 MB) is cleaned up automatically.
- **No runtime unpacking on first launch any more**: the installer carries no ffmpeg / hyperframes (only code + `whisper/`), so there is no "preparing runtime x%" wait on first launch and no 632 MB being unpacked into `%APPDATA%\shadowmill\runtime\`. **Downloading and unpacking only happen after the user confirms** (see the previous item), and the app is usable right after installation; only users upgrading from old versions (the ones whose installer carried `runtime.7z`) inherit an already-unpacked directory and the app does nothing new. The first launch may still be a few seconds slower, which comes from Windows Defender scanning newly written files and from a cold disk cache rather than from application logic. The app's own startup cost has also been reduced — `electron-updater` and `openai` are lazy-loaded, and project data is no longer re-read on startup.
- **The app disappears for about 1–2 minutes while the update installs**: an NSIS update silently uninstalls the old version and then unpacks and copies the new installer, during which the installation directory is emptied and rebuilt, so **desktop / Start-menu shortcuts temporarily point at files that do not exist** (clicking them says "file not found or moved", which is expected — do not click repeatedly); the app reopens automatically when it finishes. Therefore "restart to install" must be clicked explicitly by the user (the dialog explains this expectation first and then raises UAC), and the app **no longer installs automatically when the window closes**; after a successful install the next launch cleans up the duplicate installer (about 275 MB) left in `%LOCALAPPDATA%\shadowmill-updater\pending\`. Most of the old update time was the 632 MB of runtime resources being reinstalled over and over — after splitting, the installer no longer contains them (see "External dependencies · runtime packs" above), and **only a pack whose content changed is downloaded again**.
- **Diagnosing startup time**: `%APPDATA%\shadowmill\startup.log` gets a few appended lines on every launch, each shaped like `2026-10-12T01:02:19.780Z +4200ms window created` — the `+NNNms` is milliseconds since process start, so it is immediately visible whether time went into "main-process module loading / window creation / page loading". (The updater log is `updater.log` in the same directory, the runtime unpack log is `runtime.log`, and the preview protocol log is `preview-protocol.log`.) The old version's directory (`MarvisStudio` / npm package name `my-app`) under `%APPDATA%\my-app\` is **migrated automatically** on first launch (in development as well; start once with `MIGRATE_USER_DATA=0` to skip it when you want to keep the old directory for comparison).

*(Content generated by AI, for reference only.)*
