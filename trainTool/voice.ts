/**
 * Text-to-speech with Dia (voice/dia: its own Python environment, code and weights, all offline).
 * English dialogue with [S1]/[S2] speaker tags and (laughs) style tags; can clone a voice from a reference clip.
 * Runs in the background as the "dia" job.
 */
import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { freeVram, isRunning, startProcess, stopJob } from "./jobs";
import { exists } from "./paths";

export interface VoiceOptions { appRoot: string; comfyUrl: string; ollamaUrl: string }

const AUDIO_RE = /\.(wav|mp3|flac|ogg|m4a)$/i;
const MIME: Record<string, string> = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".flac": "audio/flac", ".ogg": "audio/ogg", ".m4a": "audio/mp4" };

export interface DiaJob {
  text: string; output: string; referenceAudio?: string; referenceText?: string;
  seed?: number; cfgScale?: number; temperature?: number;
}

/** The job file handed to dia_run.py: blank or invalid numbers are left out so the script's defaults apply. */
export function buildDiaJob(r: DiaJob): Record<string, unknown> {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const ref = r.referenceAudio?.trim();
  return {
    text: r.text.trim(), output: r.output,
    ...(ref ? { referenceAudio: ref, referenceText: (r.referenceText || "").trim() } : {}),
    ...(num(r.seed) !== undefined ? { seed: Math.trunc(r.seed!) } : {}),
    ...(num(r.cfgScale) ? { cfgScale: r.cfgScale } : {}),
    ...(num(r.temperature) ? { temperature: r.temperature } : {}),
  };
}

export function registerVoice(app: express.Express, opts: VoiceOptions) {
  const root = path.join(opts.appRoot, "voice", "dia");
  const python = path.join(root, "env", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
  const script = path.join(opts.appRoot, "trainTool", "scripts", "dia_run.py");
  const outDir = path.join(opts.appRoot, "outputs", "voice");
  const results = () => { try { return fs.readdirSync(outDir).filter(n => AUDIO_RE.test(n) && n.startsWith("dia_")).map(n => path.join(outDir, n)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs).slice(0, 60); } catch { return []; } };
  const missing = () => [
    !exists(python) && "its Python environment (voice/dia/env)",
    !exists(path.join(root, "code", "dia", "model.py")) && "the Dia code (voice/dia/code)",
    !exists(path.join(root, "hf", "hub", "models--nari-labs--Dia-1.6B-0626")) && "the Dia weights (voice/dia/hf)",
    !exists(path.join(root, "dac")) && "the audio codec weights (voice/dia/dac)",
  ].filter(Boolean) as string[];

  app.get("/api/voice/status", (_req, res) => {
    const m = missing();
    res.json({ dia: { ready: !m.length, missing: m }, outputDir: outDir, results: results(), running: isRunning("dia") });
  });

  app.post("/api/voice/dia/start", async (req, res) => {
    if (isRunning("dia")) return res.status(409).json({ error: "Dia is already speaking." });
    const b = req.body || {};
    const text = String(b.text || "").trim();
    if (!text) return res.status(400).json({ error: "Type the text to speak first." });
    const referenceAudio = b.referenceAudio ? String(b.referenceAudio) : "";
    if (referenceAudio && !exists(referenceAudio)) return res.status(400).json({ error: "The reference audio file was not found." });
    const m = missing();
    if (m.length) return res.status(400).json({ error: `Dia is not set up: missing ${m.join(", ")}.` });
    fs.mkdirSync(outDir, { recursive: true });
    const output = path.join(outDir, `dia_${Date.now()}.wav`);
    const jobFile = path.join(outDir, ".dia_job.json");
    fs.writeFileSync(jobFile, JSON.stringify(buildDiaJob({ text, output, referenceAudio, referenceText: b.referenceText ? String(b.referenceText) : "", seed: b.seed, cfgScale: b.cfgScale, temperature: b.temperature })));
    const lines: string[] = [];
    await freeVram(opts, t => lines.push(t));
    const state = startProcess("dia", `Dia: ${text.replace(/\s+/g, " ").slice(0, 40)}`, python, [script, jobFile], {
      cwd: opts.appRoot,
      env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
      onExit: (code, job) => { if (code === 0 && exists(output)) job.result = { output }; },
    });
    res.json({ ok: true, state, output, notes: lines });
  });

  app.post("/api/train/dia/stop", (_req, res) => res.json({ ok: stopJob("dia") }));

  /** Opens outputs/voice in the file manager. */
  app.post("/api/voice/open-folder", (_req, res) => {
    fs.mkdirSync(outDir, { recursive: true });
    const cmd = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
    spawn(cmd, [outDir], { detached: true, stdio: "ignore" }).unref();
    res.json({ ok: true });
  });

  /** Plays a clip picked as reference or made by Dia. */
  app.get("/api/voice/media", (req, res) => {
    const file = path.resolve(String(req.query.path || ""));
    if (!AUDIO_RE.test(file) || !exists(file)) return res.status(404).json({ error: "No such file." });
    res.type(MIME[path.extname(file).toLowerCase()]);
    res.sendFile(file);
  });
}
