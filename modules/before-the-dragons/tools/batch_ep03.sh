#!/usr/bin/env bash
# Episode 3 "The Empire of Chains", all 8 clips at 576x1024.
set -u

cd "D:/Claude/In_Progress/02_Web_Apps/Cursed_Ai/modules/before-the-dragons" || exit 1

REFS="reels/pre-targaryen/refs"
STYLE="$REFS/ep03_style_plate_00001_.png"
CITY="$REFS/ep03_ghis_city_00001_.png"
LEGION="$REFS/ep03_legionary_00001_.png"
SLAVE="$REFS/ep03_slave_00001_.png"
VOLCANO="$REFS/ep03_volcano_00001_.png"
DRAGON="$REFS/ep03_dragon_00001_.png"

for f in "$STYLE" "$CITY" "$LEGION" "$SLAVE" "$VOLCANO" "$DRAGON"; do
  [ -f "$f" ] || { echo "MISSING REF: $f"; exit 1; }
done

run () {
  local name=$1 seed=$2; shift 2
  echo "=== $name start $(date +%H:%M:%S)"
  python tools/comfy_h3.py video "$name" "reels/pre-targaryen/prompts/$name.txt" \
    "$@" --seconds 8 --seed "$seed" --steps 12 --width 576 --height 1024
  echo "=== $name end   $(date +%H:%M:%S)"
}

run ep03_clip01 301 "$STYLE" "$CITY"
run ep03_clip02 302 "$STYLE" "$SLAVE"
run ep03_clip03 303 "$STYLE" "$SLAVE"
run ep03_clip04 304 "$STYLE" "$LEGION"
run ep03_clip05 305 "$STYLE" "$LEGION"
run ep03_clip06 306 "$STYLE" "$VOLCANO"
run ep03_clip07 307 "$STYLE" "$VOLCANO" "$DRAGON"
run ep03_clip08 308 "$STYLE" "$DRAGON"

echo "=== EP03 BATCH COMPLETE $(date +%H:%M:%S)"
ls -la reels/pre-targaryen/clips/ep03_*.mp4
