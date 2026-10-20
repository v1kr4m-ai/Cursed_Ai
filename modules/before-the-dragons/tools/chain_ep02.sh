#!/usr/bin/env bash
# Wait for the Episode 1 clip batch and the Episode 2 reference stills to finish,
# then start the Episode 2 batch. Aborts rather than waiting forever if either
# upstream job died.
set -u

cd "D:/Claude/In_Progress/02_Web_Apps/Cursed_Ai/modules/before-the-dragons" || exit 1

EP01_LOG="reels/pre-targaryen/clips/_batch_ep01.log"
REFS_LOG="reels/pre-targaryen/refs/_ep02_refs.log"

wait_for () {
  local log=$1 marker=$2 label=$3
  local waited=0
  while true; do
    if grep -q "$marker" "$log" 2>/dev/null; then
      echo "[chain] $label complete at $(date +%H:%M:%S)"
      return 0
    fi
    if grep -qE "Traceback|RuntimeError|HTTPError|TimeoutError" "$log" 2>/dev/null; then
      echo "[chain] ABORT: $label failed - see $log"
      return 1
    fi
    sleep 60
    waited=$((waited + 60))
    if [ "$waited" -gt 36000 ]; then
      echo "[chain] ABORT: $label still not done after 10h"
      return 1
    fi
  done
}

wait_for "$EP01_LOG" "BATCH COMPLETE" "ep01 clips" || exit 1
wait_for "$REFS_LOG" "EP02 REFS COMPLETE" "ep02 stills" || exit 1

echo "[chain] starting ep02 batch at $(date +%H:%M:%S)"
bash tools/batch_ep02.sh
