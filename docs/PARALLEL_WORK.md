# Working on Cursed_Ai in parallel

Several Claude Code chats can work at the same time if each has its own folder (git worktree), its own branch and its own server port. This page is the instruction set.

## The areas

| Area (branch) | Port | Owns | Typical work |
|---|---|---|---|
| `images` (`area/images`) | 3001 | `src/components/comfy/*`, `comfyTool/*`, Gemini / Google code in `server.ts` | Image and Video studio, workflow runner, prompt library, share, Drive |
| `chat` (`area/chat`) | 3002 | `src/components/chat/*`, `src/components/voice/*`, `src/services/*` (chat, voice, tts, intent), Vision, Memory | Chat, Cursed_Pirate assistant, voice, attachments, memory |
| `engine` (`area/engine`) | 3003 | `src/components/tools/EngineView.tsx`, `SettingsPage.tsx`, `src/components/models/*`, `hub.ts`, `localModels.ts`, engine code in `server.ts` | Engine and Settings pages, model hub and downloads, status bar |
| `android` (`area/android`) | 3004 | `android/*` | Native phone client that connects to the PC server by IP and port (only when you ask for it) |

`main` stays the integration branch. The folder you are in now (`Cursed_Ai`) is the main checkout: use it to merge and to run the "real" app with your real data.

## Start an area

1. From the main folder: `tools\new-area.bat images 3001` (name, then port). Repeat for each area you want.
2. Open Claude Code in `D:\Claude\In_Progress\02_Web_Apps\Cursed_Ai_wt\images` (a new chat). It reads `CLAUDE.md` by itself.
3. First message in that chat, for example: *"You are working on the images area (branch area/images, port 3001). Read docs/PARALLEL_WORK.md. Task: ..."*
4. Start the app there with `Cursed_Ai.bat`: it uses `.port`, so the main app and each area run side by side.

Each worktree has its own empty run-time data (`prompts.db`, `chats.json`, `memory.json`, `outputs/`...). `config.json` is copied once so ComfyUI and model folders are set. Google sign-in (`google.json`) and the Gemini key are not copied: reconnect in that copy if you need them. Test data therefore never touches your real library.

## Rules for every area chat

- Stay inside your area's files. If a change needs a shared file (`server.ts`, `src/App.tsx`, `src/types.ts`, `package.json`, `README.md`), keep it small and local (add a block, do not reorganise).
- Commit small and often on your branch; rebase on `main` before you start a bigger piece: `git fetch && git rebase origin/main` (or `git merge origin/main`).
- Update the README section for what you changed (only that section).
- Never commit run-time data or secrets (`config.json`, `google.json`, `*.db`, `chats.json`, `outputs/`).
- Run `npm run lint` and `npx vitest run` before every commit.

## Merge an area back

In the main folder (or from the area chat when it is done):

```
git fetch
git checkout main
git pull
git merge --no-ff area/images        # resolve README / server.ts conflicts by keeping both sides
npm run lint && npx vitest run
git push origin main
```

Then in the other areas: `git merge main` to pick up the merged work. Merge one area at a time. If a conflict is in `README.md`, keep both texts. If it is in `server.ts`, keep both blocks (they are separate route groups).

## Remove an area when it is finished

```
git worktree remove ..\Cursed_Ai_wt\images
git branch -d area/images
```
(`node_modules` there is only a link to the main folder's; removing the worktree does not delete the real one.)

## Ports

`.port` in a folder (one number, git-ignored) is read by `Cursed_Ai.bat`; the server reads the `PORT` environment variable. Main uses 3000, areas 3001-3004. Check the free ports with `netstat -ano | findstr LISTENING`.
