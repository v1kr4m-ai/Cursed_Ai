#!/usr/bin/env bash
# Wait for the Episode 2 batch, then generate Episode 3 reference stills and
# run the Episode 3 clip batch. Aborts rather than waiting forever if Ep2 died.
set -u

cd "D:/Claude/In_Progress/02_Web_Apps/Cursed_Ai/modules/before-the-dragons" || exit 1

EP02_LOG="reels/pre-targaryen/clips/_chain_ep02.log"

waited=0
while ! grep -q "EP02 BATCH COMPLETE" "$EP02_LOG" 2>/dev/null; do
  if grep -qE "ABORT|Traceback|RuntimeError|HTTPError|TimeoutError|MISSING REF" "$EP02_LOG" 2>/dev/null; then
    echo "[chain3] ABORT: ep02 failed - see $EP02_LOG"
    exit 1
  fi
  sleep 60
  waited=$((waited + 60))
  if [ "$waited" -gt 72000 ]; then
    echo "[chain3] ABORT: ep02 still not done after 20h"
    exit 1
  fi
done
echo "[chain3] ep02 complete at $(date +%H:%M:%S)"

echo "[chain3] generating ep03 reference stills"
bash tools/refs_ep03.sh || { echo "[chain3] ABORT: ep03 stills failed"; exit 1; }

echo "[chain3] starting ep03 batch at $(date +%H:%M:%S)"
bash tools/batch_ep03.sh
