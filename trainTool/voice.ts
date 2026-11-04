/**
 * Text-to-speech with Dia (voice/dia: its own Python environment, code and weights, all offline).
 * English dialogue with [S1]/[S2] speaker tags and (laughs) style tags; can clone a voice from a reference clip.
 * Runs in the background as the "dia" job. Also XTTS-v2 (Hindi and 16 more languages, voice copy from a 6-30 s clip), the "xtts" job.
 */
import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { freeVram, isRunning, startProcess, stopJob } from "./jobs";
import { exists, resolvePaths } from "./paths";
import { XTTS_LANGUAGES, isXttsLanguage, splitForXtts } from "../seriesTool/xttsPlan";

export interface VoiceOptions { appRoot: string; comfyUrl: string; ollamaUrl: string }

const AUDIO_RE = /\.(wav|mp3|flac|ogg|m4a)$/i;
const MIME: Record<string, string> = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".flac": "audio/flac", ".ogg": "audio/ogg", ".m4a": "audio/mp4" };

export interface DiaJob {
  text: string; output: string; referenceAudio?: string; referenceText?: string;
  seed?: number; cfgScale?: number; temperature?: number; maxTokens?: number;
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
    ...(num(r.maxTokens) && r.maxTokens! > 0 ? { maxTokens: Math.trunc(r.maxTokens!) } : {}),
  };
}

/** Where Dia lives and what is missing from it; also used by the Series voice. */
export function diaSetup(appRoot: string) {
  const root = path.join(appRoot, "voice", "dia");
  const python = path.join(root, "env", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
  const script = path.join(appRoot, "trainTool", "scripts", "dia_run.py");
  const missing = () => [
    !exists(python) && "its Python environment (voice/dia/env)",
    !exists(path.join(root, "code", "dia", "model.py")) && "the Dia code (voice/dia/code)",
    !exists(path.join(root, "hf", "hub", "models--nari-labs--Dia-1.6B-0626")) && "the Dia weights (voice/dia/hf)",
    !exists(path.join(root, "dac")) && "the audio codec weights (voice/dia/dac)",
  ].filter(Boolean) as string[];
  return { root, python, script, missing };
}

export interface XttsItem { text: string; language: string; output: string; referenceAudio?: string; speaker?: string }

/** The job file handed to xtts_run.py: every text already split into pieces the model reads well; blank options left out. */
export function buildXttsJob(modelDir: string, items: XttsItem[]) {
  return {
    modelDir,
    items: items.map(i => {
      const language = isXttsLanguage(i.language) ? i.language : "hi";
      const ref = i.referenceAudio?.trim(), speaker = i.speaker?.trim();
      return { text: i.text.trim(), parts: splitForXtts(i.text, language), language, output: i.output, ...(ref ? { referenceAudio: ref } : speaker ? { speaker } : {}) };
    }),
  };
}

/** Where XTTS-v2 lives and what is missing from it; also used by the Series voice. ponytail: the default train/ folder, not a custom trainRoot from the settings. */
export function xttsSetup(appRoot: string) {
  const p = resolvePaths({}, appRoot);
  const modelDir = path.join(p.speechModelsDir, "XTTS-v2");
  const script = path.join(p.scriptsDir, "xtts_run.py");
  const missing = () => [
    !exists(p.ttsPython) && "its Python environment (train/speech/tts/env)",
    ...["model.pth", "config.json", "vocab.json", "speakers_xtts.pth"].filter(f => !exists(path.join(modelDir, f))).map(f => `the XTTS-v2 file ${f} (train/speech/models/XTTS-v2)`),
  ].filter(Boolean) as string[];
  return { python: p.ttsPython, modelDir, script, missing };
}

/** A Dia/XTTS start is between its checks and its job (freeing GPU memory): no other GPU voice job may begin meanwhile. */
let starting = false;
export const voiceStarting = () => starting;

export function registerVoice(app: express.Express, opts: VoiceOptions) {
  const { python, script, missing } = diaSetup(opts.appRoot);
  const xtts = xttsSetup(opts.appRoot);
  const outDir = path.join(opts.appRoot, "outputs", "voice");
  const results = () => { try { return fs.readdirSync(outDir).filter(n => AUDIO_RE.test(n) && /^(dia|xtts)_/.test(n)).map(n => path.join(outDir, n)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs).slice(0, 60); } catch { return []; } };

  app.get("/api/voice/status", (_req, res) => {
    const m = missing();
    const xm = xtts.missing();
    res.json({ dia: { ready: !m.length, missing: m }, xtts: { ready: !xm.length, missing: xm, languages: XTTS_LANGUAGES }, outputDir: outDir, results: results(), running: isRunning("dia") || isRunning("xtts") });
  });

  app.post("/api/voice/dia/start", async (req, res) => {
    if (starting) return res.status(409).json({ error: "A voice job is starting." });
    if (isRunning("dia")) return res.status(409).json({ error: "Dia is already speaking." });
    if (isRunning("xtts")) return res.status(409).json({ error: "XTTS is speaking: one graphics card, one voice job at a time." });
    if (isRunning("seriesvoice")) return res.status(409).json({ error: "Dia is busy making a series' voices." });
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
    starting = true;
    try { await freeVram(opts, t => lines.push(t)); } finally { starting = false; }
    const state = startProcess("dia", `Dia: ${text.replace(/\s+/g, " ").slice(0, 40)}`, python, [script, jobFile], {
      cwd: opts.appRoot,
      env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
      onExit: (code, job) => { if (code === 0 && exists(output)) job.result = { output }; },
    });
    res.json({ ok: true, state, output, notes: lines });
  });

  app.post("/api/voice/xtts/start", async (req, res) => {
    if (starting) return res.status(409).json({ error: "A voice job is starting." });
    if (isRunning("xtts")) return res.status(409).json({ error: "XTTS is already speaking." });
    if (isRunning("dia")) return res.status(409).json({ error: "Dia is speaking: one graphics card, one voice job at a time." });
    if (isRunning("seriesvoice")) return res.status(409).json({ error: "A series' voices are being made: one graphics card, one voice job at a time." });
    const b = req.body || {};
    const text = String(b.text || "").trim();
    if (!text) return res.status(400).json({ error: "Type the text to speak first." });
    const language = b.language ? String(b.language) : "hi";
    if (!isXttsLanguage(language)) return res.status(400).json({ error: `XTTS does not speak "${language}".` });
    const referenceAudio = b.referenceAudio ? String(b.referenceAudio) : "";
    if (referenceAudio && !exists(referenceAudio)) return res.status(400).json({ error: "The reference audio file was not found." });
    const m = xtts.missing();
    if (m.length) return res.status(400).json({ error: `XTTS is not set up: missing ${m.join(", ")}.` });
    fs.mkdirSync(outDir, { recursive: true });
    const output = path.join(outDir, `xtts_${Date.now()}.wav`);
    const jobFile = path.join(outDir, ".xtts_job.json");
    fs.writeFileSync(jobFile, JSON.stringify(buildXttsJob(xtts.modelDir, [{ text, language, output, referenceAudio, speaker: b.speaker ? String(b.speaker) : undefined }])));
    const lines: string[] = [];
    starting = true;
    try { await freeVram(opts, t => lines.push(t)); } finally { starting = false; }
    const state = startProcess("xtts", `XTTS: ${text.replace(/\s+/g, " ").slice(0, 40)}`, xtts.python, [xtts.script, jobFile], {
      cwd: opts.appRoot,
      env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
      onExit: (code, job) => { if (code === 0 && exists(output)) job.result = { output }; },
    });
    res.json({ ok: true, state, output, notes: lines });
  });

  app.post("/api/train/xtts/stop", (_req, res) => res.json({ ok: stopJob("xtts") }));
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
