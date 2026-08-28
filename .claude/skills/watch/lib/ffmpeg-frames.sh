#!/usr/bin/env bash
# Slice the video into frames + a clean audio track.
# usage: ffmpeg-frames.sh <video> <work-dir> <mode> [start] [end] [effort]
# effort: low | medium (default) | high — controls how densely frames are sampled.

set -euo pipefail
VIDEO="$1"
WORK="$2"
MODE="${3:-hook}"
START="${4:-}"
END="${5:-}"
EFFORT="${6:-medium}"

mkdir -p "$WORK/frames"

DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO" | awk '{printf "%d", $1}')"
[[ -z "$DUR" || "$DUR" -lt 1 ]] && DUR=60

TRIM=()
[[ -n "$START" ]] && TRIM+=( -ss "$START" )
[[ -n "$END" ]]   && TRIM+=( -to "$END" )

# Audio: clean mono 16kHz m4a
ffmpeg -y -hide_banner -loglevel error ${TRIM[@]+"${TRIM[@]}"} -i "$VIDEO" \
  -vn -ac 1 -ar 16000 -c:a aac -b:a 64k "$WORK/audio.m4a"

# Effort knobs
case "$EFFORT" in
  low)    HOOK_DUR=15; HOOK_FPS=1; BODY_MIN_STEP=15; BODY_CAP=8;   UNIFORM_TARGET=40  ;;
  medium) HOOK_DUR=15; HOOK_FPS=2; BODY_MIN_STEP=5;  BODY_CAP=30;  UNIFORM_TARGET=100 ;;
  high)   HOOK_DUR=30; HOOK_FPS=2; BODY_MIN_STEP=2;  BODY_CAP=120; UNIFORM_TARGET=200 ;;
  *) echo "unknown effort: $EFFORT (use low|medium|high)" >&2; exit 1 ;;
esac

case "$MODE" in
  hook)
    ffmpeg -y -hide_banner -loglevel error -i "$VIDEO" -t "$HOOK_DUR" -vf "fps=${HOOK_FPS}" \
      "$WORK/frames/hook-%03d.jpg"
    if (( DUR > HOOK_DUR )); then
      REST=$((DUR - HOOK_DUR))
      STEP=$(( REST / BODY_CAP )); (( STEP < BODY_MIN_STEP )) && STEP=$BODY_MIN_STEP
      ffmpeg -y -hide_banner -loglevel error -ss "$HOOK_DUR" -i "$VIDEO" \
        -vf "fps=1/${STEP}" "$WORK/frames/body-%03d.jpg"
    fi
    ;;
  retention|library)
    STEP=$(( DUR / UNIFORM_TARGET )); (( STEP < 1 )) && STEP=1
    ffmpeg -y -hide_banner -loglevel error ${TRIM[@]+"${TRIM[@]}"} -i "$VIDEO" \
      -vf "fps=1/${STEP}" "$WORK/frames/f-%04d.jpg"
    ;;
  *)
    echo "unknown mode: $MODE" >&2; exit 1 ;;
esac

# Rename frames to embed their wallclock timestamp.
for f in $(ls "$WORK/frames" | sort); do
  case "$MODE" in
    hook)
      if [[ "$f" == hook-* ]]; then
        IDX="${f#hook-}"; IDX="${IDX%.jpg}"; IDX=$((10#$IDX))
        T=$(awk -v i="$IDX" -v fps="$HOOK_FPS" 'BEGIN{printf "%d", (i-1)/fps}')
      else
        IDX="${f#body-}"; IDX="${IDX%.jpg}"; IDX=$((10#$IDX))
        REST=$((DUR - HOOK_DUR))
        STEP=$(( REST / BODY_CAP )); (( STEP < BODY_MIN_STEP )) && STEP=$BODY_MIN_STEP
        T=$(( HOOK_DUR + (IDX-1) * STEP ))
      fi
      ;;
    *)
      IDX="${f#f-}"; IDX="${IDX%.jpg}"; IDX=$((10#$IDX))
      STEP=$(( DUR / UNIFORM_TARGET )); (( STEP < 1 )) && STEP=1
      T=$(( (IDX-1) * STEP ))
      ;;
  esac
  HMS=$(printf "%02d-%02d-%02d" $((T/3600)) $(((T%3600)/60)) $((T%60)))
  mv "$WORK/frames/$f" "$WORK/frames/${HMS}.jpg" 2>/dev/null || true
done
