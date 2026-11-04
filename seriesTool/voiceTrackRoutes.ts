/**
 * Makes a series' spoken voice with a local voice model: one background job ("seriesvoice").
 * - voiceEngine "dia": scene after scene, each scene one run of trainTool/scripts/dia_run.py (which loads the model every time -
 *   slower, but a crash costs one scene, not all).
 * - voiceEngine "xtts": trainTool/scripts/xtts_run.py runs ONCE for the whole episode (one model load): every speaker's turn of
 *   every scene is one item, then each scene's turns are joined with a short gap into one file.
 * Files go to <project>/voice/<sceneId>.wav and are recorded on the scene (voiceFile, voiceText). The scripts come from voiceTrack.ts.
 */
import express from "express";
import fs from "fs";
import path from "path";
import { spawn, execFile } from "child_process";
import { createSeriesStore } from "./store";
import { planEpisode, stampOf, tokenCapWithSample } from "./voiceTrack";
import { probeDuration, buildJoinArgs } from "./ffmpeg";
import { BUILTIN_SPEAKERS } from "./xttsPlan";
import { diaSetup, buildDiaJob, xttsSetup, buildXttsJob, voiceStarting, type XttsItem } from "../trainTool/voice";
import { freeVram, isRunning, startTask, stopJob } from "../trainTool/jobs";

export interface VoiceTrackOptions { projectsRoot: string; appRoot: string; comfyUrl: string; ollamaUrl: string }

type Ctx = { log: (t: string) => void; progress: (pct: number, text: string) => void; signal: AbortSignal };
const TQDM = /(\d+)%\|[^|]*\|\s*(\d+)\/(\d+)\s*\[/;

export function registerVoiceTrack(app: express.Express, opts: VoiceTrackOptions) {
  const store = createSeriesStore(opts.projectsRoot);
  const dia = diaSetup(opts.appRoot);
  const xtts = xttsSetup(opts.appRoot);

  /** One dia_run.py / xtts_run.py call; resolves with an error text or "" on success. Ends the process when the job is stopped. */
  const runPy = (who: { python: string; script: string; tag: string }, jobFile: string, log: (t: string) => void, signal: AbortSignal, onBar?: (pct: number, text: string) => void) => new Promise<string>(done => {
    if (signal.aborted) return done("stopped");
    const proc = spawn(who.python, [who.script, jobFile], { cwd: opts.appRoot, windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" } });
    let tail = "";
    const feed = (c: Buffer) => c.toString().split(/[\r\n]+/).map(l => l.trim()).filter(Boolean).forEach(l => {
      tail = (tail + "\n" + l).slice(-1500);
      if (l.startsWith(who.tag)) log(l);
      const b = onBar && TQDM.exec(l);
      if (b) onBar!(Number(b[1]), `${b[2]}/${b[3]} turns`);
    });
    proc.stdout.on("data", feed); proc.stderr.on("data", feed);
    proc.on("error", e => done(e.message));
    proc.on("close", code => done(code === 0 ? "" : tail.split("\n").filter(Boolean).slice(-2).join(" ") || `exit code ${code}`));
    signal.addEventListener("abort", () => { if (proc.pid) execFile("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true }, () => proc.kill()); }, { once: true });
  });
  const diaWho = { python: dia.python, script: dia.script, tag: "[dia]" };
  const xttsWho = { python: xtts.python, script: xtts.script, tag: "[xtts]" };

  app.post("/api/series/projects/:id/episodes/:episodeId/voice", async (req, res) => {
    const p = store.get(req.params.id);
    const ep = p?.episodes.find(e => e.id === req.params.episodeId);
    if (!p || !ep) return res.status(404).json({ error: "No such episode." });
    const isX = p.voiceEngine === "xtts";
    if (p.voiceEngine !== "dia" && !isX) return res.status(400).json({ error: 'This series uses the video model\'s own voice. Choose "Dia" or "XTTS" in Develop, Look and voice.' });
    if (voiceStarting() || isRunning("dia") || isRunning("xtts")) return res.status(409).json({ error: "The Voice tab is running a voice job. Wait for it to finish, then try again." });
    if (isRunning("seriesvoice")) return res.status(409).json({ error: "Series voices are already being made." });
    const m = isX ? xtts.missing() : dia.missing();
    if (m.length) return res.status(400).json({ error: `${isX ? "XTTS" : "Dia"} is not set up: missing ${m.join(", ")}.` });
    const sceneId = req.body?.sceneId ? String(req.body.sceneId) : undefined;
    if (sceneId && !ep.scenes.some(s => s.id === sceneId)) return res.status(404).json({ error: "No such scene." });
    const plans = planEpisode(p, ep, sceneId);
    const todo = plans.filter(x => !x.skipped);
    if (!todo.length) return res.status(400).json({ error: `Nothing to voice: ${plans.map(x => `scene ${x.number}: ${x.skipped}`).join("; ") || "no scenes"}` });
    // A scene being rendered (a talking video reads its voice file) must not get its voice overwritten.
    const busy = todo.filter(x => { const st = ep.scenes.find(s => s.id === x.sceneId)?.status; return st === "queued" || st === "running"; });
    if (busy.length) return res.status(409).json({ error: `Scene ${busy.map(x => x.number).join(", ")} is being rendered right now. Wait for it or cancel it, then make the voice.` });
    const dir = path.join(p.dir, "voice");
    fs.mkdirSync(dir, { recursive: true });

    /** Records a finished voice file on its scene. */
    const record = (x: (typeof plans)[number], target: string) => {
      const fresh = store.get(p.id), sc = fresh?.episodes.find(e => e.id === ep.id)?.scenes.find(s => s.id === x.sceneId);
      if (fresh && sc) { sc.voiceFile = target; sc.voiceText = stampOf(x); store.save(fresh); }
    };
    const finish = (made: number[], failed: { scene: number; error: string }[], { progress, signal }: Ctx) => {
      // a scene that cannot be voiced any more must not keep an old voice that no longer matches its words
      const fresh = store.get(p.id), fep = fresh?.episodes.find(e => e.id === ep.id);
      for (const x of plans.filter(x => x.skipped)) { const sc = fep?.scenes.find(s => s.id === x.sceneId); if (fresh && sc?.voiceFile) { delete sc.voiceFile; delete sc.voiceText; store.save(fresh); } }
      progress(100, "done");
      if (failed.length && !made.length && !signal.aborted) throw new Error(`No scene was voiced: ${failed.map(f => `scene ${f.scene}: ${f.error}`).join("; ")}`);
      return { made, failed, skipped: plans.filter(x => x.skipped).map(x => ({ scene: x.number, reason: x.skipped })) };
    };

    const xttsBody = async (ctx: Ctx) => {
      const { log, progress, signal } = ctx;
      for (const x of plans.filter(x => x.skipped)) log(`[voice] scene ${x.number} skipped: ${x.skipped}`);
      await freeVram(opts, log);
      const tmpDir = path.join(dir, ".xtts");
      fs.rmSync(tmpDir, { recursive: true, force: true }); // leftovers of a stopped run must not pass for new turns
      fs.mkdirSync(tmpDir, { recursive: true });
      const made: number[] = [], failed: { scene: number; error: string }[] = [];
      const items: (XttsItem & { sceneId: string })[] = [];
      const runnable: typeof todo = [];
      for (const x of todo) {
        x.notes.forEach(n => log(`[voice] scene ${x.number}: ${n}`));
        // the stamp names the sample, so a missing sample must fail the scene rather than quietly use another voice
        const gone = x.turns!.find(t => t.referenceAudio && !fs.existsSync(t.referenceAudio));
        if (gone) { const why = `voice sample not found: ${gone.referenceAudio}`; failed.push({ scene: x.number, error: why }); log(`[voice] scene ${x.number} failed: ${why}`); continue; }
        runnable.push(x);
        x.turns!.forEach((t, k) => items.push({ sceneId: x.sceneId, text: t.text, language: t.language, output: path.join(tmpDir, `${x.sceneId}_${k}.wav`), referenceAudio: t.referenceAudio, speaker: t.referenceAudio ? undefined : t.speaker || BUILTIN_SPEAKERS[0] }));
      }
      if (!items.length) { fs.rmSync(tmpDir, { recursive: true, force: true }); return finish(made, failed, ctx); }
      const jobFile = path.join(dir, ".xtts_job.json");
      fs.writeFileSync(jobFile, JSON.stringify(buildXttsJob(xtts.modelDir, items)));
      log(`[voice] XTTS: ${items.length} turn(s) of ${runnable.length} scene(s), one model load`);
      const err = signal.aborted ? "stopped" : await runPy(xttsWho, jobFile, log, signal, (pct, text) => progress(pct * 0.95, text));
      for (const x of runnable) {
        if (signal.aborted) break;
        const parts = items.filter(i => i.sceneId === x.sceneId).map(i => i.output);
        const lost = parts.filter(f => !fs.existsSync(f));
        if (lost.length) { const why = err || `${lost.length} of ${parts.length} turn(s) were not spoken (see the XTTS lines)`; failed.push({ scene: x.number, error: why }); log(`[voice] scene ${x.number} failed: ${why}`); continue; }
        const target = path.join(p.dir, x.file), tmp = target.replace(/\.wav$/, ".new.wav");
        const joined = await new Promise<string>(done => execFile("ffmpeg", buildJoinArgs(parts, tmp), { windowsHide: true }, e => done(e ? e.message : "")));
        try {
          if (joined || !fs.existsSync(tmp)) throw new Error(joined || "ffmpeg wrote no file");
          fs.renameSync(tmp, target);
          record(x, target);
          made.push(x.number);
        } catch (e: any) {
          try { fs.rmSync(tmp, { force: true }); } catch { /* none */ }
          failed.push({ scene: x.number, error: e?.message || String(e) }); log(`[voice] scene ${x.number} failed: ${e?.message || e}`);
        }
      }
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* none */ }
      return finish(made, failed, ctx);
    };

    const diaBody = async (ctx: Ctx) => {
      const { log, progress, signal } = ctx;
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
        const err = await runPy(diaWho, jobFile, log, signal);
        if (signal.aborted) { try { fs.rmSync(tmp, { force: true }); } catch { /* none */ } break; }
        if (err || !fs.existsSync(tmp)) { failed.push({ scene: x.number, error: err || "no audio was written" }); log(`[voice] scene ${x.number} failed: ${err}`); continue; }
        try {
          fs.renameSync(tmp, target); // can fail on Windows while the old file is open elsewhere
          record(x, target);
          made.push(x.number);
        } catch (e: any) {
          try { fs.rmSync(tmp, { force: true }); } catch { /* none */ }
          failed.push({ scene: x.number, error: e?.message || String(e) }); log(`[voice] scene ${x.number} failed: ${e?.message || e}`);
        }
      }
      return finish(made, failed, ctx);
    };

    const state = startTask("seriesvoice", `Voices: ${p.title}, episode ${ep.number}${sceneId ? ` scene ${plans[0].number}` : ""}`, isX ? xttsBody : diaBody);
    res.json({ ok: true, state, skipped: plans.filter(x => x.skipped).map(x => ({ scene: x.number, reason: x.skipped })) });
  });

  app.post("/api/train/seriesvoice/stop", (_req, res) => res.json({ ok: stopJob("seriesvoice") }));
}
