# Cursed_Ai - STATE

## Decisions made
- LoRA trainer lives in `train/lora` (kohya sd-scripts + own env); Flux weights read from ComfyUI's models folder. Pinokio/FluxGym no longer used.
- Face swap = FaceFusion inside `faceswap/` (own env, hyperswap_1a_256), page `FaceSwapView`, backend `trainTool/faceswap.ts`, job kind `faceswap`.
- Heavy unused models moved to `F:\ComfyUI\_unused_models` (docx explains each); every ComfyUI workflow has a "Models used, and alternatives" Note.
- Dia (English dialogue TTS, voice cloning) goes in as a tab of the Audio Studio, not a separate page. Model weights come from `C:\pinokio\api\dia.git\cache\HF_HOME` (Dia-1.6B-0626, 6.4 GB).
- UNO skipped (USO already in ComfyUI). Series voices: Dia for English, XTTS later for Hindi.
- code-review-graph MCP removed and graphify hooks switched off (token cost). Use `graphify query "<q>"` by hand when new to an area. CRG not available - skip CRG steps.

## DO NOT TOUCH
- `series/*/project.json` of other projects (before-the-dragons, ugc-influencer) - modified by other processes, never commit.
- ComfyUI workflows without a backup (`workflows_backup_20261104`), `config.json`, `memory.json`, `chats.json`, `prompts.db`.
- Never `git add -A`; commit only named files. Trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (check the reminder in the session).

## Conventions
- Gate: `npm run lint` (tsc) and `npx vitest run` before every commit; README paragraph for each feature, newest first (before the previous newest).
- Long jobs: `trainTool/jobs.ts` (`startProcess`, kind added to JobKind in jobs.ts AND src/components/train/trainApi.ts), pages use `useJob`, `Card`, `JobConsole` from `src/components/train/ui.tsx`.
- Sidebar tab list: `src/components/layout/Sidebar.tsx`; tab mount: `src/App.tsx`.
- Dev server restart on Windows: kill node processes whose CommandLine has tsx and server.ts, then `npm run dev` in background (EADDRINUSE otherwise).
- Chat replies terse (caveman); code, commits, README normal prose.

## Backlog
1. Dia voice tab in Audio Studio (in progress).
2. Series 7: references after the episode plan + a final button to Produce.
3. Series 8: several characters / several voices per project (existing projects must keep loading).
4. Series 9: multi-select tags in Look and Voice.
5. Series 10: renamable / addable placeholders in Produce.
6. XTTS-v2 download (1.8 GB) for Hindi voices - ask first.

## Done log
- 2026-11-04: Pinokio removed (trainer in-app), 64.7 GB models set aside, workflow notes added, Face Swap page (commit after 4a3ca82).
