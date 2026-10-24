/**
 * HTTP surface for the Train Speech page: clip folders with transcripts, draft transcripts from Whisper, Whisper fine-tuning
 * (speech to text), XTTS-v2 fine-tuning (text to speech), and trying the results. Long work goes through jobs.ts like the other train pages.
 */
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { execFile, spawn } from "child_process";
import { buildSttArgs, buildTtsArgs, cleanStt, cleanTts, langOf, LANGS, matchClip, parseMeta, safeName, AUDIO_RE, WHISPER_MODELS, XTTS_REPO } from "./speechData";
import { isRunning, jobState, startProcess, startTask, stopJob, type JobKind } from "./jobs";
import { exists, listDirs, resolvePaths, type TrainConfig } from "./paths";

export interface SpeechOptions { appRoot: string; getConfig: () => TrainConfig }

const bad = (res: express.Response, code: number, message: string) => res.status(code).json({ error: message });
const KINDS: JobKind[] = ["stt", "tts", "speechprep", "speechenv"];
const clipsIn = (dir: string) => { try { return fs.readdirSync(dir).filter(n => AUDIO_RE.test(n)).sort(); } catch { return []; } };
const stemOf = (n: string) => n.replace(/\.[^.]+$/, "");
const readText = (f: string) => { try { return fs.readFileSync(f, "utf8").trim(); } catch { return ""; } };
const readJson = (f: string) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

/** Runs one program for a task job, streaming its output into the job log; resolves with the exit code. */
function runStep(log: (t: string) => void, signal: AbortSignal, exe: string, args: string[], opts: { cwd?: string } = {}): Promise<number> {
  return new Promise(resolve => {
    log(`> ${path.basename(exe)} ${args.join(" ").slice(0, 160)}`);
    const p = spawn(exe, args, { cwd: opts.cwd, windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" } });
    const feed = (c: Buffer) => c.toString().split(/[\r\n]+/).map(l => l.trim()).filter(Boolean).forEach(log);
    p.stdout.on("data", feed); p.stderr.on("data", feed);
    p.on("error", e => { log(`[could not start] ${e.message}`); resolve(-1); });
    p.on("close", code => resolve(code ?? -1));
    signal.addEventListener("abort", () => { if (p.pid) execFile("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true }, () => {}); });
  });
}

/** Where Cursed_Vishleshan looks for your own Whisper models. */
const vishleshanDir = () => path.join(os.homedir(), "Documents", "Cursed_Vishleshan", "models", "whisper");

const probe = (cmd: string, args: string[]) => new Promise<boolean>(resolve => execFile(cmd, args, { windowsHide: true, timeout: 8000 }, err => resolve(!err)));

export function registerSpeechTool(app: express.Express, opts: SpeechOptions) {
  const P = () => resolvePaths(opts.getConfig(), opts.appRoot);
  let cache: { at: number; stt: boolean; ffmpeg: boolean } | null = null;
  /** Whether the Whisper tools import (checked once a minute at most: starting Python is slow). */
  const toolsOk = async () => {
    if (cache && Date.now() - cache.at < 60_000) return cache;
    const p = P();
    const stt = exists(p.llmPython) && await probe(p.llmPython, ["-c", "import importlib.util as u, sys; sys.exit(0 if all(u.find_spec(m) for m in (\"torch\", \"transformers\", \"peft\", \"tqdm\")) else 1)"]);
    const ffmpeg = await probe("ffmpeg", ["-version"]);
    cache = { at: Date.now(), stt, ffmpeg };
    return cache;
  };

  const datasets = () => {
    const p = P();
    return listDirs(p.speechDatasetsDir).map(name => {
      const dir = path.join(p.speechDatasetsDir, name);
      const clips = clipsIn(dir);
      return { name, path: dir, clips: clips.length, transcribed: clips.filter(c => exists(path.join(dir, stemOf(c) + ".txt"))).length, voiceReady: exists(path.join(dir, "_tts", "metadata.csv")) };
    });
  };

  app.get("/api/speech/status", async (_req, res) => {
    const p = P();
    const t = await toolsOk();
    const modelDirs = listDirs(p.speechModelsDir).map(n => ({ name: n, path: path.join(p.speechModelsDir, n) }));
    const sttModels = modelDirs.filter(m => exists(path.join(m.path, "config.json")) && /whisper/i.test(m.name) && (exists(path.join(m.path, "model.safetensors")) || exists(path.join(m.path, "model.safetensors.index.json")) || exists(path.join(m.path, "pytorch_model.bin"))));
    const xtts = modelDirs.find(m => /xtts/i.test(m.name) && exists(path.join(m.path, "model.pth")) && exists(path.join(m.path, "dvae.pth")) && exists(path.join(m.path, "mel_stats.pth")));
    const outDirs = listDirs(p.speechOutputDir);
    const jobs: Record<string, unknown> = {};
    for (const k of KINDS) jobs[k] = jobState(k);
    res.json({
      paths: { root: p.speechRoot, datasets: p.speechDatasetsDir, models: p.speechModelsDir, outputs: p.speechOutputDir, ttsPython: p.ttsPython },
      ready: { stt: t.stt, ffmpeg: t.ffmpeg, ttsEnv: exists(p.ttsPython), xttsModel: !!xtts },
      vishleshan: { dir: vishleshanDir(), models: (() => { try { return fs.readdirSync(vishleshanDir(), { withFileTypes: true }).filter(d => d.isDirectory() && exists(path.join(vishleshanDir(), d.name, "model.bin"))).map(d => d.name); } catch { return []; } })() },
      langs: LANGS, whisperModels: WHISPER_MODELS, xttsRepo: XTTS_REPO,
      sttModels, xttsModel: xtts || null,
      datasets: datasets(),
      sttOutputs: outDirs.filter(n => exists(path.join(p.speechOutputDir, n, "model", "config.json"))).map(n => ({ name: n, path: path.join(p.speechOutputDir, n, "model"), run: readJson(path.join(p.speechOutputDir, n, "run.json")) })),
      ttsOutputs: outDirs.filter(n => exists(path.join(p.speechOutputDir, n, "final", "model.pth"))).map(n => ({ name: n, path: path.join(p.speechOutputDir, n, "final"), reference: path.join(p.speechOutputDir, n, "final", "reference.wav") })),
      jobs,
    });
  });

  for (const k of KINDS) app.post(`/api/speech/${k}/stop`, (_req, res) => res.json({ ok: stopJob(k) }));

  // ------------------------------------------------------------ clips and transcripts

  app.post("/api/speech/dataset/create", (req, res) => {
    const name = safeName(req.body?.name);
    if (!name) return bad(res, 400, "Give the dataset a name (letters, numbers, spaces, - and _).");
    const dir = path.join(P().speechDatasetsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    res.json({ path: dir });
  });

  app.get("/api/speech/clips", (req, res) => {
    const dir = String(req.query.dir || "");
    if (!dir || !exists(dir)) return res.json({ clips: [] });
    res.json({ clips: clipsIn(dir).slice(0, 600).map(name => ({ name, path: path.join(dir, name), text: readText(path.join(dir, stemOf(name) + ".txt")) })) });
  });

  app.post("/api/speech/clips/upload", express.raw({ type: "*/*", limit: "200mb" }), (req, res) => {
    const dir = String(req.query.dir || "");
    const name = String(req.query.name || "clip").replace(/[\\/:*?"<>|]/g, "_");
    if (!dir || !exists(dir)) return bad(res, 400, "Choose or create a dataset folder first.");
    if (!AUDIO_RE.test(name)) return bad(res, 400, "Use an audio file: wav, mp3, flac, m4a, ogg, opus, webm or aac.");
    if (!Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 400, "No file received.");
    fs.writeFileSync(path.join(dir, name), req.body);
    res.json({ ok: true, name });
  });

  app.put("/api/speech/transcript", (req, res) => {
    const f = String(req.body?.path || "");
    if (!AUDIO_RE.test(f) || !exists(f)) return bad(res, 404, "No such clip.");
    fs.writeFileSync(path.join(path.dirname(f), stemOf(path.basename(f)) + ".txt"), String(req.body?.text ?? ""), "utf8");
    res.json({ ok: true });
  });

  app.delete("/api/speech/clip", (req, res) => {
    const f = String(req.query.path || "");
    if (!AUDIO_RE.test(f) || !exists(f)) return bad(res, 404, "No such clip.");
    fs.unlinkSync(f);
    try { fs.unlinkSync(path.join(path.dirname(f), stemOf(path.basename(f)) + ".txt")); } catch { /* had no transcript */ }
    res.json({ ok: true });
  });

  app.get("/api/speech/audio", (req, res) => {
    const f = path.resolve(String(req.query.path || ""));
    if (!AUDIO_RE.test(f) || !exists(f)) return bad(res, 404, "No such audio.");
    res.sendFile(f);
  });

  /** Fill transcripts from a sheet the user already has (a Common Voice .tsv, or "file|text" lines). */
  app.post("/api/speech/dataset/import-sheet", (req, res) => {
    const dir = String(req.body?.dir || "");
    if (!dir || !exists(dir)) return bad(res, 400, "Choose a dataset folder first.");
    const rows = parseMeta(String(req.body?.text || ""));
    if (!rows.length) return bad(res, 400, "No rows found. Use lines like  clip01.wav|the words spoken  or a Common Voice .tsv (columns path and sentence).");
    const clips = clipsIn(dir);
    let written = 0; const missing: string[] = [];
    for (const r of rows) {
      const c = matchClip(r.file, clips);
      if (!c) { if (missing.length < 8) missing.push(r.file); continue; }
      fs.writeFileSync(path.join(dir, stemOf(c) + ".txt"), r.text, "utf8"); written++;
    }
    res.json({ written, notFound: rows.length - written, examples: missing });
  });

  /** Counts and total length of a folder, and what would be skipped. */
  app.post("/api/speech/dataset/check", async (req, res) => {
    const dir = String(req.body?.dir || "");
    if (!dir || !exists(dir)) return bad(res, 400, "Choose a dataset folder first.");
    const clips = clipsIn(dir);
    const withText = clips.filter(c => readText(path.join(dir, stemOf(c) + ".txt"))).length;
    const hasProbe = await probe("ffprobe", ["-version"]);
    let seconds = 0, tooShort = 0, tooLong = 0, unreadable = 0;
    if (hasProbe) {
      const dur = (f: string) => new Promise<number>(r => execFile("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { windowsHide: true, timeout: 15000 }, (e, out) => r(e ? NaN : parseFloat(String(out)))));
      for (let i = 0; i < clips.length; i += 8) {
        const got = await Promise.all(clips.slice(i, i + 8).map(c => dur(path.join(dir, c))));
        for (const d of got) { if (!Number.isFinite(d)) unreadable++; else { seconds += d; if (d < 1) tooShort++; if (d > 30) tooLong++; } }
      }
    }
    res.json({ clips: clips.length, withText, minutes: hasProbe ? +(seconds / 60).toFixed(1) : null, tooShort, tooLong, unreadable });
  });

  // ------------------------------------------------------------ jobs

  app.post("/api/speech/draft/start", (req, res) => {
    if (isRunning("speechprep")) return bad(res, 409, "Another preparation task is running.");
    const p = P();
    const dir = String(req.body?.datasetDir || ""), model = String(req.body?.model || "");
    if (!dir || !exists(dir)) return bad(res, 400, "Choose a dataset folder first.");
    if (!model || !exists(model)) return bad(res, 400, "Choose a downloaded Whisper model to write the drafts.");
    if (!exists(p.llmPython)) return bad(res, 400, `The Python environment was not found at ${p.llmPython}.`);
    const args = [path.join(p.scriptsDir, "transcribe_clips.py"), "--model", model, "--dataset", dir, "--language", langOf(req.body?.language).whisper];
    if (req.body?.redo) args.push("--redo");
    res.json(startProcess("speechprep", `Writing draft transcripts for ${path.basename(dir)}`, p.llmPython, args));
  });

  app.post("/api/speech/tts/prepare", (req, res) => {
    if (isRunning("speechprep")) return bad(res, 409, "Another preparation task is running.");
    const p = P();
    const dir = String(req.body?.datasetDir || "");
    if (!dir || !exists(dir)) return bad(res, 400, "Choose a dataset folder first.");
    if (!exists(p.llmPython)) return bad(res, 400, `The Python environment was not found at ${p.llmPython}.`);
    const out = path.join(dir, "_tts");
    res.json(startProcess("speechprep", `Preparing ${path.basename(dir)} for voice training`, p.llmPython, [path.join(p.scriptsDir, "prepare_tts.py"), "--dataset", dir, "--out", out]));
  });

  /** A Whisper or XTTS download from Hugging Face (needs internet once). */
  app.post("/api/speech/download", (req, res) => {
    if (isRunning("speechenv")) return bad(res, 409, "Another setup or download is running.");
    const p = P();
    const repo = String(req.body?.repo || "").trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return bad(res, 400, "Use a Hugging Face name like openai/whisper-small.");
    if (!exists(p.llmPython)) return bad(res, 400, "The Python environment was not found.");
    fs.mkdirSync(p.speechModelsDir, { recursive: true });
    const to = path.join(p.speechModelsDir, repo.split("/")[1]);
    // The Xet transfer backend can stall on some connections; plain HTTPS is slower on paper but does not hang.
    res.json(startProcess("speechenv", `Downloading ${repo}`, p.llmPython, ["-c", "import sys; from huggingface_hub import snapshot_download as d; d(sys.argv[1], local_dir=sys.argv[2], ignore_patterns=['*.msgpack','*.h5','flax_model*','tf_model*','*.onnx'])", repo, to], { env: { HF_HUB_DISABLE_XET: "1" } }));
  });

  /** Makes the separate Python environment text-to-speech training needs (coqui-tts), so it cannot disturb the other tools. */
  app.post("/api/speech/env/setup", (_req, res) => {
    if (isRunning("speechenv")) return bad(res, 409, "Another setup or download is running.");
    const p = P();
    const envDir = path.join(p.speechRoot, "tts");
    res.json(startTask("speechenv", "Setting up the text-to-speech environment (a few GB of downloads)", async ctx => {
      const { log, signal } = ctx;
      const home = os.homedir();
      const candidates: [string, string[]][] = [["py", ["-3.12"]], ["py", ["-3.11"]], ["py", ["-3.10"]],
        [path.join(home, "AppData", "Local", "Programs", "Python", "Python312", "python.exe"), []], [path.join(home, "AppData", "Local", "Programs", "Python", "Python311", "python.exe"), []], [path.join(home, "AppData", "Local", "Programs", "Python", "Python310", "python.exe"), []]];
      let base: [string, string[]] | null = null;
      for (const [exe, pre] of candidates) { if (await probe(exe, [...pre, "--version"])) { base = [exe, pre]; break; } }
      if (!base) throw new Error("Python 3.10, 3.11 or 3.12 is needed for text-to-speech training (coqui-tts does not support newer versions) and none was found.");
      log(`Using ${base[0]} ${base[1].join(" ")}`);
      fs.mkdirSync(p.speechRoot, { recursive: true });
      const steps: [string, string[], string][] = [];
      if (!exists(p.ttsPython)) steps.push([base[0], [...base[1], "-m", "venv", envDir], "Creating the environment"]);
      steps.push([p.ttsPython, ["-m", "pip", "install", "--upgrade", "pip"], "Updating pip"]);
      steps.push([p.ttsPython, ["-m", "pip", "install", "torch", "torchaudio", "--index-url", "https://download.pytorch.org/whl/cu128"], "Installing PyTorch with CUDA 12.8 (about 3 GB)"]);
      steps.push([p.ttsPython, ["-m", "pip", "install", "coqui-tts"], "Installing coqui-tts"]);
      steps.push([p.ttsPython, ["-c", "import torch; from TTS.tts.layers.xtts.trainer.gpt_trainer import GPTTrainer; print('GPU found:', torch.cuda.is_available(), torch.__version__)"], "Checking the install"]);
      let i = 0;
      for (const [exe, args, label] of steps) {
        ctx.progress(Math.round((i++ / steps.length) * 100), label);
        log(`== ${label}`);
        const code = await runStep(log, signal, exe, args);
        if (signal.aborted) return null;
        if (code !== 0) throw new Error(`${label} failed (exit code ${code}). See the lines above.`);
      }
      ctx.progress(100, "ready");
      return { ok: true };
    }));
  });

  app.post("/api/speech/stt/start", (req, res) => {
    if (isRunning("stt")) return bad(res, 409, "A speech-to-text training run is already active.");
    const p = P();
    const cfg = cleanStt(req.body);
    if (!exists(p.llmPython)) return bad(res, 400, `The Python environment was not found at ${p.llmPython}.`);
    if (!cfg.baseModel || !exists(path.join(cfg.baseModel, "config.json"))) return bad(res, 400, "Choose a downloaded Whisper model.");
    if (!cfg.datasetDir || !exists(cfg.datasetDir)) return bad(res, 400, "Choose a dataset folder with clips and transcripts.");
    if (!clipsIn(cfg.datasetDir).some(c => exists(path.join(cfg.datasetDir, stemOf(c) + ".txt")))) return bad(res, 400, "No clip in that folder has a transcript yet.");
    const name = safeName(req.body?.name) || `${path.basename(cfg.datasetDir)}-${langOf(req.body?.language).code}-${new Date().toISOString().slice(0, 10)}`;
    cfg.outputDir = path.join(p.speechOutputDir, name);
    fs.mkdirSync(cfg.outputDir, { recursive: true });
    res.json(startProcess("stt", `Training ${path.basename(cfg.baseModel)} for ${langOf(req.body?.language).name} (${cfg.method})`, p.llmPython, buildSttArgs(cfg, path.join(p.scriptsDir, "train_whisper.py")), { cwd: p.scriptsDir }));
  });

  /** Convert a trained Whisper to the faster-whisper format and put it where Cursed_Vishleshan finds it. */
  app.post("/api/speech/stt/export-ct2", (req, res) => {
    if (isRunning("speechenv")) return bad(res, 409, "Another setup, download or conversion is running.");
    const p = P();
    const modelDir = String(req.body?.modelDir || "");
    if (!modelDir || !exists(path.join(modelDir, "config.json"))) return bad(res, 400, "Choose a trained model to convert.");
    if (!exists(p.llmPython)) return bad(res, 400, `The Python environment was not found at ${p.llmPython}.`);
    const name = safeName(req.body?.name || path.basename(path.dirname(modelDir))).replace(/\s+/g, "-");
    if (!name) return bad(res, 400, "Give the converted model a name.");
    const quant = ["float16", "int8", "int8_float16", "float32"].includes(req.body?.quantization) ? String(req.body.quantization) : "float16";
    const outRoot = String(req.body?.outDir || vishleshanDir());
    const out = path.join(outRoot, name);
    if (exists(path.join(out, "model.bin")) && !req.body?.overwrite) return bad(res, 409, `There is already a converted model called ${name} in ${outRoot}. Choose another name.`);
    res.json(startTask("speechenv", `Converting ${name} for faster-whisper (Cursed_Vishleshan)`, async ctx => {
      const { log, signal } = ctx;
      if (!(await probe(p.llmPython, ["-c", "import importlib.util as u, sys; sys.exit(0 if u.find_spec('ctranslate2') else 1)"]))) {
        log("== Installing the converter (ctranslate2, needs internet once)");
        if ((await runStep(log, signal, p.llmPython, ["-m", "pip", "install", "ctranslate2", "--no-deps"])) !== 0) throw new Error("Could not install ctranslate2. Connect to the internet and try again.");
      }
      ctx.progress(20, "converting");
      fs.mkdirSync(outRoot, { recursive: true });
      const code = await runStep(log, signal, p.llmPython, [path.join(p.scriptsDir, "convert_ct2.py"), "--model", modelDir, "--out", out, "--quantization", quant]);
      if (signal.aborted) return null;
      if (code !== 0) throw new Error("The conversion failed. See the lines above.");
      ctx.progress(100, "done");
      log(`Done. In Cursed_Vishleshan choose the model custom:${name} (restart it first if it is open).`);
      return { out, name };
    }));
  });

  app.post("/api/speech/tts/start", (req, res) => {
    if (isRunning("tts")) return bad(res, 409, "A voice training run is already active.");
    const p = P();
    const cfg = cleanTts(req.body);
    if (!exists(p.ttsPython)) return bad(res, 400, "The text-to-speech environment is not set up yet. Use 'Set up' on the page first.");
    if (!cfg.modelDir || !exists(path.join(cfg.modelDir, "model.pth"))) return bad(res, 400, "Download the XTTS-v2 base model first.");
    if (!cfg.datasetDir || !exists(path.join(cfg.datasetDir, "_tts", "metadata.csv"))) return bad(res, 400, "Prepare the dataset for voice training first (it makes the _tts folder).");
    const name = safeName(req.body?.name) || `${path.basename(cfg.datasetDir)}-voice-${new Date().toISOString().slice(0, 10)}`;
    cfg.outputDir = path.join(p.speechOutputDir, name);
    cfg.datasetDir = path.join(cfg.datasetDir, "_tts");
    fs.mkdirSync(cfg.outputDir, { recursive: true });
    res.json(startProcess("tts", `Training the voice "${name}" (${cfg.language})`, p.ttsPython, buildTtsArgs(cfg, path.join(p.scriptsDir, "train_xtts.py")), { cwd: p.scriptsDir }));
  });

  // ------------------------------------------------------------ trying the results

  /** Transcribe one recording with a chosen Whisper model (the body is the audio file). */
  app.post("/api/speech/stt/transcribe", express.raw({ type: "*/*", limit: "100mb" }), (req, res) => {
    const p = P();
    const model = String(req.query.model || "");
    if (!model || !exists(path.join(model, "config.json"))) return bad(res, 400, "Choose a model to try.");
    if (!Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 400, "No audio received.");
    const tmp = path.join(os.tmpdir(), `speech_try_${Date.now()}${path.extname(String(req.query.name || ".webm")) || ".webm"}`);
    fs.writeFileSync(tmp, req.body);
    execFile(p.llmPython, [path.join(p.scriptsDir, "transcribe_file.py"), "--model", model, "--audio", tmp, "--language", langOf(req.query.language).whisper], { windowsHide: true, timeout: 300000, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8" } }, (err, out, errOut) => {
      try { fs.unlinkSync(tmp); } catch { /* already gone */ }
      if (err) return bad(res, 500, String(errOut || err.message).trim().split(/\r?\n/).slice(-2).join(" "));
      try { res.json(JSON.parse(String(out).trim().split(/\r?\n/).pop() || "{}")); } catch { bad(res, 500, "The model gave no text."); }
    });
  });

  /** Say a sentence with a voice model (a trained one, or the base XTTS model with a reference clip). */
  app.post("/api/speech/tts/speak", (req, res) => {
    const p = P();
    const modelDir = String(req.body?.modelDir || ""), ref = String(req.body?.reference || ""), text = String(req.body?.text || "").trim();
    if (!exists(p.ttsPython)) return bad(res, 400, "The text-to-speech environment is not set up yet.");
    if (!modelDir || !exists(path.join(modelDir, "model.pth"))) return bad(res, 400, "Choose a voice model.");
    if (!ref || !exists(ref)) return bad(res, 400, "Choose a reference voice clip (a few seconds of the speaker).");
    if (!text) return bad(res, 400, "Type the sentence to say.");
    const out = path.join(os.tmpdir(), `speech_say_${Date.now()}.wav`);
    execFile(p.ttsPython, [path.join(p.scriptsDir, "tts_speak.py"), "--model_dir", modelDir, "--reference", ref, "--text", text, "--language", langOf(req.body?.language).xtts, "--out", out], { windowsHide: true, timeout: 600000, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8" } }, err => {
      if (err || !exists(out)) return bad(res, 500, `Could not make the speech: ${String(err?.message || "").split(/\r?\n/).slice(-2).join(" ")}`);
      res.type("audio/wav").sendFile(out, () => { try { fs.unlinkSync(out); } catch { /* already gone */ } });
    });
  });
}
