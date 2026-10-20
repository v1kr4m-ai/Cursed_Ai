#!/usr/bin/env bash
# Copy finished renders out of ComfyUI's output folder into the project.
#
# Jobs queued straight into ComfyUI (rather than through comfy_h3.py's blocking
# wait) save only to ComfyUI's own output dir. This pulls them into the project
# so clips, refs and scripts all live together. Safe to run repeatedly - it
# never overwrites a file that is already present.
set -u

SRC="F:/ComfyUI/ComfyUI_windows_portable/ComfyUI/output/reels"
DEST_CLIPS="D:/Claude/In_Progress/02_Web_Apps/Cursed_Ai/modules/before-the-dragons/reels/pre-targaryen/clips"
DEST_REFS="D:/Claude/In_Progress/02_Web_Apps/Cursed_Ai/modules/before-the-dragons/reels/pre-targaryen/refs"

[ -d "$SRC" ] || { echo "no ComfyUI output dir at $SRC"; exit 1; }
mkdir -p "$DEST_CLIPS" "$DEST_REFS"

copied=0
for f in "$SRC"/*.mp4; do
  [ -e "$f" ] || continue
  base=$(basename "$f")
  if [ ! -f "$DEST_CLIPS/$base" ]; then
    cp "$f" "$DEST_CLIPS/$base" && echo "clip  <- $base" && copied=$((copied + 1))
  fi
done

for f in "$SRC"/*.png; do
  [ -e "$f" ] || continue
  base=$(basename "$f")
  if [ ! -f "$DEST_REFS/$base" ]; then
    cp "$f" "$DEST_REFS/$base" && echo "still <- $base" && copied=$((copied + 1))
  fi
done

echo "copied $copied new file(s)"
