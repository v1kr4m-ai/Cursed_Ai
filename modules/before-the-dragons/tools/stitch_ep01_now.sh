#!/usr/bin/env bash
# Concatenate Episode 1's 8 clips into one reel. No waiting - the caller is
# responsible for making sure the clips exist.
#
# Clip 1 is 576x1024 and clips 2-8 are 768x1344, so every input is normalised to
# 768x1344 / 24 fps / 48 kHz stereo before the concat filter runs.
set -u

cd "D:/Claude/In_Progress/02_Web_Apps/Cursed_Ai/modules/before-the-dragons" || exit 1

CLIPS="reels/pre-targaryen/clips"
OUT="$CLIPS/EP01_the_world_before_men.mp4"
W=768
H=1344

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
  -c:a aac -b:a 192k -movflags +faststart "$OUT" 2>&1 | tail -3

echo "[stitch] wrote $OUT"
ffprobe -v error -show_entries format=duration -show_entries stream=width,height \
  -of default=noprint_wrappers=1 "$OUT"
