---
name: watch
description: Watch any video URL or local file by handing Claude timestamped frames + transcript. Tuned for creators deconstructing hooks and retention.
---

# /watch

`/watch <url-or-file> [--mode hook|retention|library] [--effort low|medium|high] [--start MM:SS] [--end MM:SS] [--batch <csv>]`

## What this skill does

Most "video tools" only feed Claude the transcript. Half the interesting stuff in a video is on screen — pacing cuts, text overlays, B-roll, demo artifacts — none of which lives in the transcript. This skill hands Claude both at once:

1. `yt-dlp` pulls the file (works on YouTube, Loom, Instagram, Twitter, TikTok, and 1000+ sites — or a local file path).
2. `ffmpeg` slices the video into frames and a clean audio track.
3. YouTube/native captions get pulled when present; otherwise audio is transcribed by **ElevenLabs Scribe** (preferred) or **Groq Whisper**.
4. Claude reads the frames + timestamped transcript together and runs the prompt for the chosen mode.

## Modes

- `hook` *(default)* — dense sampling around the opening, sparser body. Output: structured hook breakdown using `prompts/hook-analysis.md`.
- `retention` — uniform sampling, calls out moments where pacing, visual, or audio likely caused drop-off. Uses `prompts/retention-review.md`.
- `library` — terse summary tuned for batch ingestion into an Obsidian/Notion library. Uses `prompts/library-ingest.md`.

## Effort levels (frame sampling density)

`--effort` controls how many frames are sampled. Trades cost for resolution.

| effort   | hook mode                                     | retention/library |
|----------|-----------------------------------------------|-------------------|
| `low`    | first 15s @ 1 fps + body every ~15s (cap 8)   | 40 frames total   |
| `medium` *(default)* | first 15s @ 2 fps + body every ~5s+ (cap 30) | 100 frames total |
| `high`   | first 30s @ 2 fps + body every ~2s+ (cap 120) | 200 frames total  |

Higher effort = more image tokens = higher Claude cost. The actual frame count and estimated cost is written to `cost.json` for every run.

## Transcription providers

When native captions aren't available, transcription falls back to:
1. **ElevenLabs Scribe** — used if `ELEVENLABS_API_KEY` is set. Higher quality, paid.
2. **Groq Whisper Large v3 Turbo** — used if `GROQ_API_KEY` is set. Free tier is generous.

Force a specific provider with `WATCH_TRANSCRIBER=elevenlabs|groq` in `.env` or the environment.

## How Claude should run this

When the user invokes `/watch`:

1. Parse the args. The first positional arg is the URL or local file path. Default mode is `hook`, default effort is `medium`.
2. Run `bash skill/watch.sh <args>` from the skill directory. It will:
   - Create a per-run work directory under `/tmp/watch/<slug>/`.
   - Download (or copy) the video.
   - Extract frames into `frames/` and `audio.m4a`.
   - Pull captions if available; otherwise transcribe via ElevenLabs/Groq and write `transcript.txt`.
   - Write `cost.json` with the duration, frame count, transcription provider, and estimated total cost.
   - Print the work directory path on stdout.
3. Read every file in `frames/` (numbered with timestamps in the filename, e.g. `00-00-03.jpg`) plus `transcript.txt` and `cost.json`.
4. Apply the prompt at `prompts/<mode>-analysis.md` and produce the report.
5. **Always include the cost figures from `cost.json` in the final report** — duration, frames sampled, effort level, transcription provider + cost, estimated Claude tokens + cost, and total. Users have explicitly asked for this on every run.
6. **Always render an HTML report and open it in the browser. This is mandatory on every `/watch` run, not a follow-up step.**
   - Start from `templates/report.html` (a self-contained single-file template with inline CSS — no external assets needed).
   - Fill in `{{TITLE}}`, `{{EYEBROW}}` (e.g. "Hook breakdown" / "Retention review" / "Library entry"), `{{HEADLINE}}` (creator + video title, with `<span class="sub">` for the subtitle), `{{META}}` (source URL + duration + caption source), `{{BODY}}` (the analysis content as HTML — use the section classes already styled: `.tldr`, `.timeline`/`.row`, `blockquote`, `.grid-2`/`.card`, `.interrupt`, `.promise`, `.template`), `{{COST_TABLE}}` (a `<table class="cost">` with the `cost.json` figures, last row `class="total"`), `{{MODE}}`, `{{EFFORT}}`.
   - Reference frames as relative paths (e.g. `frames/00-00-03.jpg`) — they're already in the work directory next to the HTML.
   - Write the result to `<workdir>/report.html` using the `Write` tool.
   - Then run `open <workdir>/report.html` via Bash to launch it in the user's default browser.
   - The chat reply still includes the same markdown report — the HTML is an additional, automatic deliverable.
7. If `--batch` was passed, repeat for each URL in the CSV and append each result to the user's hook library.

## Cost

- Local extraction (yt-dlp + ffmpeg): free.
- Native captions: free.
- ElevenLabs Scribe: ~$0.40/hour of audio.
- Groq Whisper: ~$0.04/hour of audio (often free under the free tier).
- Claude usage: scales with effort. Typical 30-min video at medium effort is roughly $1/run on Opus 4.7. Override the rate constants via `WATCH_RATE_*` env vars.
