#!/usr/bin/env bash
# Queue Episode 1 clips 2-8 back to back at 768x1344.
# Each clip runs to completion before the next is queued, so ComfyUI never
# holds two H3 jobs in memory at once.
set -u

cd "D:/Claude/In_Progress/02_Web_Apps/Cursed_Ai/modules/before-the-dragons" || exit 1

REFS="reels/pre-targaryen/refs"
STYLE="$REFS/ep01_style_plate_00001_.png"
CHILD="$REFS/ep01_child_forest_v3_00001_.png"
GIANT="$REFS/ep01_giant_v2_00001_.png"
TREE="$REFS/ep01_weirwood_v2_00001_.png"
MEN="$REFS/ep01_first_men_00001_.png"

run () {
  local name=$1 seed=$2; shift 2
  echo "=== $name start $(date +%H:%M:%S)"
  python tools/comfy_h3.py video "$name" "reels/pre-targaryen/prompts/$name.txt" \
    "$@" --seconds 8 --seed "$seed" --steps 12 --width 768 --height 1344
  echo "=== $name end   $(date +%H:%M:%S)"
}

run ep01_clip02 102 "$STYLE" "$CHILD"
run ep01_clip03 103 "$STYLE" "$GIANT"
run ep01_clip04 104 "$STYLE" "$TREE"
run ep01_clip05 105 "$STYLE" "$MEN"
run ep01_clip06 106 "$STYLE" "$TREE" "$MEN"
run ep01_clip07 107 "$STYLE"
run ep01_clip08 108 "$STYLE" "$CHILD" "$MEN"

echo "=== BATCH COMPLETE $(date +%H:%M:%S)"
ls -la reels/pre-targaryen/clips/*.mp4
