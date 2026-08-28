#!/usr/bin/env bash
# /watch entrypoint. Downloads (or copies) the video, slices frames + audio,
# pulls captions or runs transcription, writes a cost summary, and prints
# the work directory so Claude can pick it up.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
LIB="$SCRIPT_DIR/lib"

MODE="hook"
EFFORT="medium"
START=""
END=""
BATCH=""
INPUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --effort) EFFORT="$2"; shift 2 ;;
    --start) START="$2"; shift 2 ;;
    --end) END="$2"; shift 2 ;;
    --batch) BATCH="$2"; shift 2 ;;
    --help|-h)
      sed -n '1,/^$/p' "$SCRIPT_DIR/SKILL.md"; exit 0 ;;
    *) INPUT="$1"; shift ;;
  esac
done

case "$EFFORT" in low|medium|high) ;; *) echo "--effort must be low|medium|high (got: $EFFORT)" >&2; exit 1 ;; esac

if [[ -n "$BATCH" ]]; then
  while IFS=, read -r url _; do
    [[ -z "$url" || "$url" == "url" ]] && continue
    "$0" "$url" --mode "$MODE" --effort "$EFFORT"
  done < "$BATCH"
  exit 0
fi

if [[ -z "$INPUT" ]]; then
  echo "usage: watch.sh <url-or-file> [--mode hook|retention|library] [--start MM:SS] [--end MM:SS] [--batch <csv>]" >&2
  exit 1
fi

# Load .env so price overrides are available
ENV_FILE="$(cd -- "$SCRIPT_DIR/.." &>/dev/null && pwd)/.env"
[[ -f "$ENV_FILE" ]] && set -a && . "$ENV_FILE" && set +a

SLUG="$(echo "$INPUT" | shasum | cut -c1-10)"
WORK="/tmp/watch/$SLUG"
mkdir -p "$WORK/frames"

# 1. Fetch
bash "$LIB/ytdlp-fetch.sh" "$INPUT" "$WORK"

VIDEO="$WORK/video.mp4"
[[ -f "$VIDEO" ]] || { echo "fetch failed: no video.mp4 in $WORK" >&2; exit 1; }

# 2. Frames + audio
bash "$LIB/ffmpeg-frames.sh" "$VIDEO" "$WORK" "$MODE" "$START" "$END" "$EFFORT"

# 3. Transcript: prefer captions, fall back to ElevenLabs/Groq
PROVIDER="youtube-captions"
if [[ -f "$WORK/captions.txt" && -s "$WORK/captions.txt" ]]; then
  cp "$WORK/captions.txt" "$WORK/transcript.txt"
else
  bash "$LIB/whisper-fallback.sh" "$WORK/audio.m4a" "$WORK/transcript.txt"
  PROVIDER="$(cat "$WORK/transcript.txt.provider" 2>/dev/null || echo none)"
fi

# 4. Cost estimate
DUR_S="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO" 2>/dev/null | awk '{printf "%d", $1}')"
[[ -z "$DUR_S" ]] && DUR_S=0
DUR_M=$(awk -v s="$DUR_S" 'BEGIN{printf "%.2f", s/60}')

# Per-minute rates (USD), overridable via env.
RATE_GROQ="${WATCH_RATE_GROQ_PER_MIN:-0.0007}"           # whisper-large-v3-turbo ≈ $0.04/hr
RATE_ELEVEN="${WATCH_RATE_ELEVEN_PER_MIN:-0.0067}"       # Scribe v1 ≈ $0.40/hr
# Claude pricing per million tokens, overridable via env.
RATE_IN="${WATCH_RATE_CLAUDE_INPUT_PER_MTOK:-15}"        # Opus 4.7 input
RATE_OUT="${WATCH_RATE_CLAUDE_OUTPUT_PER_MTOK:-75}"      # Opus 4.7 output
TOK_PER_FRAME="${WATCH_TOKENS_PER_FRAME:-1300}"          # ~1280x720 image
EST_OUT_TOKENS="${WATCH_ESTIMATED_OUTPUT_TOKENS:-1200}"  # typical analysis report

case "$PROVIDER" in
  elevenlabs-scribe) TRANS_COST=$(awk -v m="$DUR_M" -v r="$RATE_ELEVEN" 'BEGIN{printf "%.4f", m*r}') ;;
  groq-whisper)      TRANS_COST=$(awk -v m="$DUR_M" -v r="$RATE_GROQ"   'BEGIN{printf "%.4f", m*r}') ;;
  *)                 TRANS_COST="0.0000" ;;
esac

FRAMES_N="$(ls "$WORK/frames" 2>/dev/null | wc -l | tr -d ' ')"
TRANSCRIPT_WORDS="$(wc -w < "$WORK/transcript.txt" 2>/dev/null | tr -d ' ' || echo 0)"
# ~1.3 tokens/word for English captions/transcripts
TRANSCRIPT_TOKENS=$(awk -v w="$TRANSCRIPT_WORDS" 'BEGIN{printf "%d", w*1.3}')
IMAGE_TOKENS=$((FRAMES_N * TOK_PER_FRAME))
PROMPT_TOKENS=2000
INPUT_TOKENS=$((IMAGE_TOKENS + TRANSCRIPT_TOKENS + PROMPT_TOKENS))
CLAUDE_COST=$(awk -v i="$INPUT_TOKENS" -v o="$EST_OUT_TOKENS" -v ri="$RATE_IN" -v ro="$RATE_OUT" \
  'BEGIN{printf "%.4f", (i*ri + o*ro)/1000000}')
TOTAL_COST=$(awk -v t="$TRANS_COST" -v c="$CLAUDE_COST" 'BEGIN{printf "%.4f", t+c}')

cat > "$WORK/cost.json" <<JSON
{
  "mode": "$MODE",
  "effort": "$EFFORT",
  "audio_duration_seconds": $DUR_S,
  "audio_duration_minutes": $DUR_M,
  "transcription_provider": "$PROVIDER",
  "transcription_cost_usd": $TRANS_COST,
  "frames_count": $FRAMES_N,
  "transcript_words": $TRANSCRIPT_WORDS,
  "estimated_image_tokens": $IMAGE_TOKENS,
  "estimated_transcript_tokens": $TRANSCRIPT_TOKENS,
  "estimated_prompt_tokens": $PROMPT_TOKENS,
  "estimated_input_tokens": $INPUT_TOKENS,
  "estimated_output_tokens": $EST_OUT_TOKENS,
  "rate_claude_input_per_mtok_usd": $RATE_IN,
  "rate_claude_output_per_mtok_usd": $RATE_OUT,
  "estimated_claude_cost_usd": $CLAUDE_COST,
  "estimated_total_cost_usd": $TOTAL_COST
}
JSON

cat <<EOF
WORK_DIR: $WORK
MODE: $MODE
EFFORT: $EFFORT
FRAMES: $FRAMES_N
TRANSCRIPT: $WORK/transcript.txt
PROMPT: $SCRIPT_DIR/prompts/${MODE}-analysis.md
COST: $WORK/cost.json
COSTS_SUMMARY: duration=${DUR_M}min effort=${EFFORT} frames=${FRAMES_N} provider=${PROVIDER} transcription=\$${TRANS_COST} claude≈\$${CLAUDE_COST} total≈\$${TOTAL_COST}
EOF
