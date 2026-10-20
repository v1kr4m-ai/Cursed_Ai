#!/usr/bin/env bash
# Episode 2 "The Long Night", all 8 clips at 576x1024 (see SERIES_BIBLE.md for why).
# Sequential: one H3 job in memory at a time.
set -u

cd "D:/Claude/In_Progress/02_Web_Apps/Cursed_Ai/modules/before-the-dragons" || exit 1

REFS="reels/pre-targaryen/refs"
STYLE="$REFS/ep02_style_plate_00001_.png"
OTHER="$REFS/ep02_other_00001_.png"
WIGHT="$REFS/ep02_wight_00001_.png"
HERO="$REFS/ep02_last_hero_00001_.png"
WALL="$REFS/ep02_wall_00001_.png"
CHILD="$REFS/ep01_child_forest_v3_00001_.png"   # reused from Ep1 for continuity

for f in "$STYLE" "$OTHER" "$WIGHT" "$HERO" "$WALL" "$CHILD"; do
  [ -f "$f" ] || { echo "MISSING REF: $f"; exit 1; }
done

run () {
  local name=$1 seed=$2; shift 2
  echo "=== $name start $(date +%H:%M:%S)"
  python tools/comfy_h3.py video "$name" "reels/pre-targaryen/prompts/$name.txt" \
    "$@" --seconds 8 --seed "$seed" --steps 12 --width 576 --height 1024
  echo "=== $name end   $(date +%H:%M:%S)"
}

run ep02_clip01 201 "$STYLE"
run ep02_clip02 202 "$STYLE"
run ep02_clip03 203 "$STYLE" "$OTHER"
run ep02_clip04 204 "$STYLE" "$WIGHT"
run ep02_clip05 205 "$STYLE" "$HERO"
run ep02_clip06 206 "$STYLE" "$HERO" "$CHILD"
run ep02_clip07 207 "$STYLE" "$WALL"
run ep02_clip08 208 "$STYLE" "$WALL"

echo "=== EP02 BATCH COMPLETE $(date +%H:%M:%S)"
ls -la reels/pre-targaryen/clips/ep02_*.mp4
