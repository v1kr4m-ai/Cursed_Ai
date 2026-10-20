#!/usr/bin/env bash
# Full unattended pipeline: finish Ep1, stitch it, then Ep2 and Ep3 end to end.
#
# Idempotent by design - every stage skips work whose output already exists, so
# this can be relaunched after any interruption without redoing finished clips.
# Launch it DETACHED (see relaunch note at the bottom) so it outlives the
# Claude Code session that started it.
set -u

cd "D:\Claude\In_Progress\02_Web_Apps\Cursed_Ai\modules\before-the-dragons" || exit 1

# A detached shell does not inherit the interactive PATH, so binaries are
# resolved explicitly here. Without this the server wait loop spins forever on a
# curl it cannot find, silently and with no output.
export PATH="/usr/bin:/mingw64/bin:/c/Windows/System32:/c/Python314:/c/Python314/Scripts:$PATH"
CURL=$(command -v curl || echo /usr/bin/curl)
PY=$(command -v python || command -v py || echo python)

CLIPS="reels/pre-targaryen/clips"
REFS="reels/pre-targaryen/refs"
PROMPTS="reels/pre-targaryen/prompts"

say () { echo "[pipeline $(date +%H:%M:%S)] $*"; }

say "starting - curl=$CURL python=$PY cwd=$(pwd)"
"$PY" --version 2>&1 | while read -r l; do say "python: $l"; done

# --- wait for the ComfyUI server to answer before queueing anything ----------
wait_server () {
  local waited=0
  until "$CURL" -s -m 5 -o /dev/null http://127.0.0.1:8188/system_stats; do
    sleep 15
    waited=$((waited + 15))
    say "waiting for ComfyUI (${waited}s)"
    if [ "$waited" -gt 900 ]; then
      say "ABORT: ComfyUI never came up"
      return 1
    fi
  done
  say "ComfyUI is up"
}

# --- one clip, skipped if it already exists ---------------------------------
clip () {
  local name=$1 seed=$2 w=$3 h=$4; shift 4
  if ls "$CLIPS"/${name}_*.mp4 >/dev/null 2>&1; then
    say "skip $name (already rendered)"
    return 0
  fi
  say "$name start (${w}x${h})"
  "$PY" tools/comfy_h3.py video "$name" "$PROMPTS/$name.txt" "$@" \
    --seconds 8 --seed "$seed" --steps 12 --width "$w" --height "$h"
  say "$name end"
}

wait_server || exit 1

# --- Episode 1: clips 7 and 8 at 768x1344 to match clips 2-6 ----------------
STYLE1="$REFS/ep01_style_plate_00001_.png"
CHILD1="$REFS/ep01_child_forest_v3_00001_.png"
MEN1="$REFS/ep01_first_men_00001_.png"

clip ep01_clip07 107 768 1344 "$STYLE1"
clip ep01_clip08 108 768 1344 "$STYLE1" "$CHILD1" "$MEN1"

# --- stitch Episode 1 -------------------------------------------------------
if [ ! -f "$CLIPS/EP01_the_world_before_men.mp4" ]; then
  say "stitching episode 1"
  bash tools/stitch_ep01_now.sh
else
  say "skip ep01 stitch (already built)"
fi

# --- Episode 2 --------------------------------------------------------------
if [ ! -f "$REFS/ep02_wall_00001_.png" ]; then
  say "generating ep02 stills"
  bash tools/refs_ep02.sh
else
  say "skip ep02 stills (already rendered)"
fi

STYLE2="$REFS/ep02_style_plate_00001_.png"
OTHER="$REFS/ep02_other_00001_.png"
WIGHT="$REFS/ep02_wight_00001_.png"
HERO="$REFS/ep02_last_hero_00001_.png"
WALL="$REFS/ep02_wall_00001_.png"

clip ep02_clip01 201 576 1024 "$STYLE2"
clip ep02_clip02 202 576 1024 "$STYLE2"
clip ep02_clip03 203 576 1024 "$STYLE2" "$OTHER"
clip ep02_clip04 204 576 1024 "$STYLE2" "$WIGHT"
clip ep02_clip05 205 576 1024 "$STYLE2" "$HERO"
clip ep02_clip06 206 576 1024 "$STYLE2" "$HERO" "$CHILD1"
clip ep02_clip07 207 576 1024 "$STYLE2" "$WALL"
clip ep02_clip08 208 576 1024 "$STYLE2" "$WALL"

# --- Episode 3 --------------------------------------------------------------
if [ ! -f "$REFS/ep03_dragon_00001_.png" ]; then
  say "generating ep03 stills"
  bash tools/refs_ep03.sh
else
  say "skip ep03 stills (already rendered)"
fi

STYLE3="$REFS/ep03_style_plate_00001_.png"
CITY="$REFS/ep03_ghis_city_00001_.png"
LEGION="$REFS/ep03_legionary_00001_.png"
SLAVE="$REFS/ep03_slave_00001_.png"
VOLCANO="$REFS/ep03_volcano_00001_.png"
DRAGON="$REFS/ep03_dragon_00001_.png"

clip ep03_clip01 301 576 1024 "$STYLE3" "$CITY"
clip ep03_clip02 302 576 1024 "$STYLE3" "$SLAVE"
clip ep03_clip03 303 576 1024 "$STYLE3" "$SLAVE"
clip ep03_clip04 304 576 1024 "$STYLE3" "$LEGION"
clip ep03_clip05 305 576 1024 "$STYLE3" "$LEGION"
clip ep03_clip06 306 576 1024 "$STYLE3" "$VOLCANO"
clip ep03_clip07 307 576 1024 "$STYLE3" "$VOLCANO" "$DRAGON"
clip ep03_clip08 308 576 1024 "$STYLE3" "$DRAGON"

say "PIPELINE COMPLETE"
ls -la "$CLIPS"/*.mp4
