#!/usr/bin/env bash
# Transcribe an audio file when native captions are missing.
# Providers: ElevenLabs Scribe (preferred if ELEVENLABS_API_KEY set) or Groq Whisper.
# Override selection with WATCH_TRANSCRIBER=elevenlabs|groq.
# usage: whisper-fallback.sh <audio.m4a> <out-transcript.txt>

set -euo pipefail
AUDIO="$1"
OUT="$2"

# Load .env from repo root (two levels up from this script)
ENV_FILE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." &>/dev/null && pwd)/.env"
[[ -f "$ENV_FILE" ]] && set -a && . "$ENV_FILE" && set +a

# Accept common naming variants for the ElevenLabs key.
EL_KEY="${ELEVENLABS_API_KEY:-${ELEVEN_LABS_KEY:-${ELEVEN_API_KEY:-${XI_API_KEY:-}}}}"

PROVIDER="${WATCH_TRANSCRIBER:-}"
if [[ -z "$PROVIDER" ]]; then
  if [[ -n "$EL_KEY" ]]; then PROVIDER="elevenlabs"
  elif [[ -n "${GROQ_API_KEY:-}" ]]; then PROVIDER="groq"
  else
    echo "No transcription key set (ELEVENLABS_API_KEY or GROQ_API_KEY) — skipping transcription." >&2
    : > "$OUT"
    echo "none" > "${OUT}.provider"
    exit 0
  fi
fi

case "$PROVIDER" in
  elevenlabs)
    [[ -n "$EL_KEY" ]] || { echo "ELEVENLABS_API_KEY not set." >&2; : > "$OUT"; echo "none" > "${OUT}.provider"; exit 0; }
    RESP="$(curl -sS https://api.elevenlabs.io/v1/speech-to-text \
      -H "xi-api-key: $EL_KEY" \
      -F "model_id=scribe_v1" \
      -F "timestamps_granularity=word" \
      -F "file=@${AUDIO}")"

    # Group words into ~30s segments and emit "[HH:MM:SS] text" lines.
    echo "$RESP" | python3 -c '
import json, sys
data = json.load(sys.stdin)
words = data.get("words") or []
if not words:
    text = (data.get("text") or "").strip()
    if text:
        print(f"[00:00:00] {text}")
    sys.exit(0)
seg_start = None
seg_text = []
SEG_LEN = 30.0
for w in words:
    if w.get("type") and w["type"] != "word":
        if seg_text:
            seg_text.append(w.get("text", ""))
        continue
    start = float(w.get("start", 0))
    if seg_start is None:
        seg_start = start
    if start - seg_start >= SEG_LEN and seg_text:
        t = int(seg_start); ts = f"{t//3600:02d}:{(t%3600)//60:02d}:{t%60:02d}"
        print(f"[{ts}] {''.join(seg_text).strip()}")
        seg_start = start; seg_text = []
    seg_text.append(w.get("text", ""))
if seg_text:
    t = int(seg_start or 0); ts = f"{t//3600:02d}:{(t%3600)//60:02d}:{t%60:02d}"
    print(f"[{ts}] {''.join(seg_text).strip()}")
' > "$OUT"
    echo "elevenlabs-scribe" > "${OUT}.provider"
    ;;

  groq)
    [[ -n "${GROQ_API_KEY:-}" ]] || { echo "GROQ_API_KEY not set." >&2; : > "$OUT"; echo "none" > "${OUT}.provider"; exit 0; }
    RESP="$(curl -sS https://api.groq.com/openai/v1/audio/transcriptions \
      -H "Authorization: Bearer $GROQ_API_KEY" \
      -F "file=@${AUDIO}" \
      -F "model=whisper-large-v3-turbo" \
      -F "response_format=verbose_json" \
      -F "timestamp_granularities[]=segment")"

    echo "$RESP" | python3 -c '
import json, sys
data = json.load(sys.stdin)
for seg in data.get("segments", []):
    t = int(seg["start"])
    ts = f"{t//3600:02d}:{(t%3600)//60:02d}:{t%60:02d}"
    text = seg["text"].strip()
    if text: print(f"[{ts}] {text}")
' > "$OUT"
    echo "groq-whisper" > "${OUT}.provider"
    ;;

  *)
    echo "unknown WATCH_TRANSCRIBER: $PROVIDER (use elevenlabs or groq)" >&2
    : > "$OUT"; echo "none" > "${OUT}.provider"; exit 1 ;;
esac
