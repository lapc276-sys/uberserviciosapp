#!/usr/bin/env bash
# Pull a video + native captions (if available) into the work dir.
# usage: ytdlp-fetch.sh <url-or-file> <work-dir>

set -euo pipefail
INPUT="$1"
WORK="$2"

if [[ -f "$INPUT" ]]; then
  cp "$INPUT" "$WORK/video.mp4"
  exit 0
fi

yt-dlp \
  --no-playlist \
  --write-auto-subs --write-subs \
  --sub-langs "en.*" \
  --convert-subs vtt \
  --merge-output-format mp4 \
  -f "bv*[height<=720]+ba/b[height<=720]" \
  -o "$WORK/video.%(ext)s" \
  "$INPUT"

# Normalize whichever caption file landed here into a flat captions.txt.
VTT="$(ls "$WORK"/video*.vtt 2>/dev/null | head -n1 || true)"
if [[ -n "${VTT:-}" ]]; then
  awk '
    /^WEBVTT/ {next}
    /-->/ {ts=$1; sub(/\..*/, "", ts); next}
    /^[[:space:]]*$/ {next}
    {gsub(/<[^>]*>/, ""); printf "[%s] %s\n", ts, $0}
  ' "$VTT" > "$WORK/captions.txt"
fi

# Make sure the final video file is at video.mp4
if [[ ! -f "$WORK/video.mp4" ]]; then
  CAND="$(ls "$WORK"/video.* 2>/dev/null | grep -v '\.vtt$' | head -n1 || true)"
  [[ -n "${CAND:-}" ]] && mv "$CAND" "$WORK/video.mp4"
fi
