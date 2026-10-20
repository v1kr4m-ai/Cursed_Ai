#!/usr/bin/env bash
# Wait for the Episode 1 batch, then concatenate all 8 clips into one reel.
#
# Clip 1 was generated at 576x1024 and clips 2-8 at 768x1344, so every input is
# normalised to 768x1344 / 24 fps / 48 kHz stereo before the concat filter runs.
# Letterbox padding keeps 9:16 intact if any clip ever differs in aspect.
set -u

cd "D:/Claude/In_Progress/02_Web_Apps/Cursed_Ai/modules/before-the-dragons" || exit 1

CLIPS="reels/pre-targaryen/clips"
LOG="$CLIPS/_batch_ep01.log"
OUT="$CLIPS/EP01_the_world_before_men.mp4"
W=768
H=1344

waited=0
while ! grep -q "BATCH COMPLETE" "$LOG" 2>/dev/null; do
  if grep -qE "Traceback|RuntimeError|HTTPError|TimeoutError" "$LOG" 2>/dev/null; then
    echo "[stitch] ABORT: ep01 batch failed - see $LOG"
    exit 1
  fi
  sleep 60
  waited=$((waited + 60))
  [ "$waited" -gt 36000 ] && { echo "[stitch] ABORT: batch not done after 10h"; exit 1; }
done
echo "[stitch] batch complete, building reel at $(date +%H:%M:%S)"

files=()
for n in 01 02 03 04 05 06 07 08; do
  f=$(ls "$CLIPS"/ep01_clip${n}_*.mp4 2>/dev/null | head -1)
  [ -n "$f" ] || { echo "[stitch] ABORT: missing clip $n"; exit 1; }
  files+=("$f")
done
echo "[stitch] inputs: ${files[*]}"

args=()
for f in "${files[@]}"; do args+=(-i "$f"); done

filter=""
for i in "${!files[@]}"; do
  filter+="[$i:v]scale=$W:$H:force_original_aspect_ratio=decrease,"
  filter+="pad=$W:$H:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24[v$i];"
  filter+="[$i:a]aresample=48000,aformat=channel_layouts=stereo[a$i];"
done
for i in "${!files[@]}"; do filter+="[v$i][a$i]"; done
filter+="concat=n=${#files[@]}:v=1:a=1[v][a]"

ffmpeg -y "${args[@]}" -filter_complex "$filter" -map "[v]" -map "[a]" \
  -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart "$OUT" 2>&1 | tail -5

echo "[stitch] wrote $OUT"
ffprobe -v error -show_entries format=duration,size \
  -show_entries stream=codec_type,codec_name,width,height \
  -of default=noprint_wrappers=1 "$OUT"
