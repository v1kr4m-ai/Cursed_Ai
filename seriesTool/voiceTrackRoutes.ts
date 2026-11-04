/**
 * Makes a series' spoken voice with the local Dia (voiceEngine "dia"): one background job, scene after scene, each scene one
 * run of trainTool/scripts/dia_run.py (which loads the model every time - slower, but a crash costs one scene, not all).
 * Files go to <project>/voice/ep<N>_s<M>.wav and are recorded on the scene (voiceFile, voiceText). The scripts come from voiceTrack.ts.
 */
import express from "express";
import fs from "fs";
import path from "path";
import { spawn, execFile } from "child_process";
import { createSeriesStore } from "./store";
import { planEpisode, stampOf, tokenCapWithSample } from "./voiceTrack";
import { probeDuration } from "./ffmpeg";
import { diaSetup, buildDiaJob } from "../trainTool/voice";
import { freeVram, isRunning, startTask, stopJob } from "../trainTool/jobs";

export interface VoiceTrackOptions { projectsRoot: string; appRoot: string; comfyUrl: string; ollamaUrl: string }

export function registerVoiceTrack(app: express.Express, opts: VoiceTrackOptions) {
  const store = createSeriesStore(opts.projectsRoot);
  const dia = diaSetup(opts.appRoot);

  /** One dia_run.py call; resolves with an error text or "" on success. Ends the process when the job is stopped. */
  const runDia = (jobFile: string, log: (t: string) => void, signal: AbortSignal) => new Promise<string>(done => {
    const proc = spawn(dia.python, [dia.script, jobFile], { cwd: opts.appRoot, windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" } });
    let tail = "";
    const feed = (c: Buffer) => c.toString().split(/[\r\n]+/).map(l => l.trim()).filter(Boolean).forEach(l => { tail = (tail + "\n" + l).slice(-1500); if (l.startsWith("[dia]")) log(l); });
    proc.stdout.on("data", feed); proc.stderr.on("data", feed);
    proc.on("error", e => done(e.message));
    proc.on("close", code => done(code === 0 ? "" : tail.split("\n").filter(Boolean).slice(-2).join(" ") || `exit code ${code}`));
    signal.addEventListener("abort", () => { if (proc.pid) execFile("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true }, () => proc.kill()); }, { once: true });
  });

  app.post("/api/series/projects/:id/episodes/:episodeId/voice", async (req, res) => {
    const p = store.get(req.params.id);
    const ep = p?.episodes.find(e => e.id === req.params.episodeId);
    if (!p || !ep) return res.status(404).json({ error: "No such episode." });
    if (p.voiceEngine !== "dia") return res.status(400).json({ error: 'This series uses the video model\'s own voice. Choose "Dia" in Develop, Look and voice.' });
    if (isRunning("dia")) return res.status(409).json({ error: "The Voice tab's Dia job is running. Wait for it to finish, then try again." });
    if (isRunning("seriesvoice")) return res.status(409).json({ error: "Series voices are already being made." });
    const m = dia.missing();
    if (m.length) return res.status(400).json({ error: `Dia is not set up: missing ${m.join(", ")}.` });
    const sceneId = req.body?.sceneId ? String(req.body.sceneId) : undefined;
    if (sceneId && !ep.scenes.some(s => s.id === sceneId)) return res.status(404).json({ error: "No such scene." });
    const plans = planEpisode(p, ep, sceneId);
    const todo = plans.filter(x => !x.skipped);
    if (!todo.length) return res.status(400).json({ error: `Nothing to voice: ${plans.map(x => `scene ${x.number}: ${x.skipped}`).join("; ") || "no scenes"}` });
    const dir = path.join(p.dir, "voice");
    fs.mkdirSync(dir, { recursive: true });
    const state = startTask("seriesvoice", `Voices: ${p.title}, episode ${ep.number}${sceneId ? ` scene ${plans[0].number}` : ""}`, async ({ log, progress, signal }) => {
      for (const x of plans.filter(x => x.skipped)) log(`[voice] scene ${x.number} skipped: ${x.skipped}`);
      await freeVram(opts, log);
      const made: number[] = [], failed: { scene: number; error: string }[] = [];
      for (const [i, x] of todo.entries()) {
        if (signal.aborted) break;
        progress((i / todo.length) * 100, `scene ${x.number} (${i + 1} of ${todo.length})`);
        x.notes.forEach(n => log(`[voice] scene ${x.number}: ${n}`));
        const target = path.join(p.dir, x.file), tmp = target.replace(/\.wav$/, ".new.wav"), jobFile = path.join(dir, ".job.json");
        const ref = x.referenceAudio && fs.existsSync(x.referenceAudio) ? x.referenceAudio : undefined;
        if (x.referenceAudio && !ref) log(`[voice] scene ${x.number}: the voice sample file was not found, using an ordinary voice.`);
        const maxTokens = ref ? tokenCapWithSample(x.seconds, await probeDuration(ref)) : x.maxTokens;
        fs.writeFileSync(jobFile, JSON.stringify(buildDiaJob({ text: x.script, output: tmp, referenceAudio: ref, referenceText: x.referenceText, maxTokens })));
        log(`[voice] scene ${x.number}: ${x.script.slice(0, 90)}${x.script.length > 90 ? "..." : ""}`);
        const err = await runDia(jobFile, log, signal);
        if (signal.aborted) { try { fs.rmSync(tmp, { force: true }); } catch { /* none */ } break; }
        if (err || !fs.existsSync(tmp)) { failed.push({ scene: x.number, error: err || "no audio was written" }); log(`[voice] scene ${x.number} failed: ${err}`); continue; }
        try {
          fs.renameSync(tmp, target); // can fail on Windows while the old file is open elsewhere
          const fresh = store.get(p.id), sc = fresh?.episodes.find(e => e.id === ep.id)?.scenes.find(s => s.id === x.sceneId);
          if (fresh && sc) { sc.voiceFile = target; sc.voiceText = stampOf(x); store.save(fresh); }
          made.push(x.number);
        } catch (e: any) {
          try { fs.rmSync(tmp, { force: true }); } catch { /* none */ }
          failed.push({ scene: x.number, error: e?.message || String(e) }); log(`[voice] scene ${x.number} failed: ${e?.message || e}`);
        }
      }
      // a scene that cannot be voiced any more must not keep an old voice that no longer matches its words
      const fresh = store.get(p.id), fep = fresh?.episodes.find(e => e.id === ep.id);
      for (const x of plans.filter(x => x.skipped)) { const sc = fep?.scenes.find(s => s.id === x.sceneId); if (fresh && sc?.voiceFile) { delete sc.voiceFile; delete sc.voiceText; store.save(fresh); } }
      progress(100, "done");
      if (failed.length && !made.length && !signal.aborted) throw new Error(`No scene was voiced: ${failed.map(f => `scene ${f.scene}: ${f.error}`).join("; ")}`);
      return { made, failed, skipped: plans.filter(x => x.skipped).map(x => ({ scene: x.number, reason: x.skipped })) };
    });
    res.json({ ok: true, state, skipped: plans.filter(x => x.skipped).map(x => ({ scene: x.number, reason: x.skipped })) });
  });

  app.post("/api/train/seriesvoice/stop", (_req, res) => res.json({ ok: stopJob("seriesvoice") }));
}
