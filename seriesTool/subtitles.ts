/**
 * Episode subtitles. Words come from the script, from the clips' own audio transcribed on this PC (Whisper), or from Gemini online;
 * timing comes from where speech actually sits in each clip. The cues are saved with the episode so they can be edited, then burned in
 * with ffmpeg using the chosen look. Separate from routes.ts so the two can change independently.
 */
import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { probeDuration } from "./ffmpeg";
import { upsertOutput } from "./finishCore";
import { createSeriesStore } from "./store";
import { buildAss, cleanCues, DEFAULT_SUB_STYLE, makeCues, speechSpan, type Cue, type SubStyle, type Subtitles } from "./subtitlesCore";

export interface SubtitleOptions {
  projectsRoot: string;
  /** Local speech-to-text on 16 kHz mono samples. */
  transcribe: (samples: Float32Array) => Promise<string>;
  geminiKey: () => string | undefined;
}

/** All of a clip's audio as 16 kHz mono floats (what Whisper wants). */
function audioSamples(file: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"], { windowsHide: true });
    const parts: Buffer[] = [];
    let err = "";
    proc.stdout.on("data", (c: Buffer) => parts.push(c));
    proc.stderr.on("data", (c: Buffer) => { err += c.toString(); });
    proc.on("error", e => reject(new Error(`Could not run ffmpeg - is it on PATH? (${e.message})`)));
    proc.on("close", () => {
      const buf = Buffer.concat(parts);
      const aligned = new Float32Array(Math.floor(buf.length / 4));
      for (let i = 0; i < aligned.length; i++) aligned[i] = buf.readFloatLE(i * 4);
      if (!aligned.length && err) return reject(new Error(err.trim().split("\n").slice(-1)[0]));
      resolve(aligned);
    });
  });
}

function wavBase64(samples: Float32Array): string {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(16000, 24); buf.writeUInt32LE(32000, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf.toString("base64");
}

async function geminiTranscribe(key: string, samples: Float32Array): Promise<string> {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts: [{ text: "Transcribe the speech in this audio exactly as spoken, word for word. Reply with only the spoken words - no timestamps, no labels, no commentary. If nothing is said, reply with nothing." }, { inline_data: { mime_type: "audio/wav", data: wavBase64(samples) } }] }] }),
  });
  if (!r.ok) throw new Error(`Gemini said no (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const d: any = await r.json();
  return (d?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join(" ").trim();
}

export function registerSubtitles(app: express.Express, opts: SubtitleOptions) {
  const store = createSeriesStore(opts.projectsRoot);
  const bad = (res: express.Response, code: number, message: string) => res.status(code).json({ error: message });
  const find = (pid: string, eid: string) => {
    const p = store.get(pid);
    const ep = p?.episodes.find(e => e.id === eid);
    return p && ep ? { p, ep } : null;
  };
  const base = "/api/series/projects/:id/episodes/:episodeId/subtitles";

  /** Cues for one scene's clip, placed at its offset in the joined episode. */
  async function cuesForScene(s: { clipPath: string | null; vo: string }, offset: number, dur: number, source: string, style: SubStyle, key?: string): Promise<Cue[]> {
    let samples: Float32Array | null = null;
    let text = "";
    // Timing always comes from the audio when there is some: speech does not fill the whole clip.
    try { samples = await audioSamples(s.clipPath!); } catch { samples = null; }
    if (source === "offline" && samples && samples.length) text = (await opts.transcribe(samples)).trim();
    else if (source === "online" && samples && samples.length) text = await geminiTranscribe(key!, samples);
    if (!text) text = s.vo || "";
    const span = samples && samples.length ? speechSpan(samples) : { start: 0, end: dur };
    return makeCues(text, offset + span.start, offset + Math.min(span.end, dur), style.maxWords);
  }

  /** Redo the subtitles of one scene only (the rest, and any edits to them, stay as they are). */
  app.post(`${base}/scene`, async (req, res) => {
    const found = find(req.params.id, req.params.episodeId);
    if (!found) return bad(res, 404, "No such episode.");
    const { p, ep } = found;
    const source = req.body?.source === "offline" || req.body?.source === "online" ? req.body.source : "script";
    const key = opts.geminiKey();
    if (source === "online" && !key) return bad(res, 400, "Online subtitles need a Gemini key - add one in Settings > Integrations.");
    const scenes = [...ep.scenes].sort((a, b) => a.number - b.number);
    if (scenes.some(s => !s.clipPath || !fs.existsSync(s.clipPath))) return bad(res, 400, "Every scene needs a finished clip first.");
    const target = scenes.findIndex(s => s.id === req.body?.sceneId);
    if (target < 0) return bad(res, 404, "No such scene.");
    try {
      let offset = 0, from = 0, to = 0;
      for (let i = 0; i <= target; i++) {
        const dur = (await probeDuration(scenes[i].clipPath!)) || scenes[i].durationS || 7;
        if (i === target) { from = offset; to = offset + dur; } else offset += dur;
      }
      const prev: Subtitles = ep.subtitles || { cues: [], style: { ...DEFAULT_SUB_STYLE }, source, updatedAt: "" };
      const fresh = await cuesForScene(scenes[target], from, to - from, source, { ...DEFAULT_SUB_STYLE, ...prev.style }, key);
      const mid = (c: Cue) => (c.start + c.end) / 2;
      const kept = prev.cues.filter(c => !(mid(c) >= from && mid(c) < to));
      ep.subtitles = { ...prev, cues: [...kept, ...fresh].sort((a, b) => a.start - b.start), updatedAt: new Date().toISOString() };
      store.save(p);
      res.json(p);
    } catch (e: any) {
      bad(res, 500, e?.message || String(e));
    }
  });

  /** Make cues from the episode's finished clips. */
  app.post(`${base}/generate`, async (req, res) => {
    const found = find(req.params.id, req.params.episodeId);
    if (!found) return bad(res, 404, "No such episode.");
    const { p, ep } = found;
    const source = req.body?.source === "offline" || req.body?.source === "online" ? req.body.source : "script";
    const key = opts.geminiKey();
    if (source === "online" && !key) return bad(res, 400, "Online subtitles need a Gemini key - add one in Settings > Integrations.");

    const scenes = [...ep.scenes].sort((a, b) => a.number - b.number);
    if (!scenes.length || scenes.some(s => !s.clipPath || !fs.existsSync(s.clipPath))) return bad(res, 400, "Every scene needs a finished clip first.");
    const style: SubStyle = { ...DEFAULT_SUB_STYLE, ...(ep.subtitles?.style || {}) };

    try {
      const cues: Cue[] = [];
      let offset = 0;
      for (const s of scenes) {
        const dur = (await probeDuration(s.clipPath!)) || s.durationS || 7;
        cues.push(...(await cuesForScene(s, offset, dur, source, style, key)));
        offset += dur;
      }
      ep.subtitles = { cues, style, source, updatedAt: new Date().toISOString() };
      store.save(p);
      res.json(p);
    } catch (e: any) {
      bad(res, 500, e?.message || String(e));
    }
  });

  /** Save edits to the cues and/or the look. */
  app.put(base, (req, res) => {
    const found = find(req.params.id, req.params.episodeId);
    if (!found) return bad(res, 404, "No such episode.");
    const { p, ep } = found;
    const prev: Subtitles = ep.subtitles || { cues: [], style: { ...DEFAULT_SUB_STYLE }, source: "manual", updatedAt: "" };
    const style = req.body?.style && typeof req.body.style === "object" ? { ...prev.style, ...req.body.style } : prev.style;
    ep.subtitles = { ...prev, cues: Array.isArray(req.body?.cues) ? cleanCues(req.body.cues) : prev.cues, style, updatedAt: new Date().toISOString() };
    store.save(p);
    res.json(p);
  });

  /** Burn the cues into a copy of the joined episode. */
  app.post(`${base}/burn`, async (req, res) => {
    const found = find(req.params.id, req.params.episodeId);
    if (!found) return bad(res, 404, "No such episode.");
    const { p, ep } = found;
    if (!ep.exportPath || !fs.existsSync(ep.exportPath)) return bad(res, 400, "Join the episode into one file first.");
    if (!ep.subtitles?.cues.length) return bad(res, 400, "There are no subtitles to burn in yet.");

    const dir = path.dirname(ep.exportPath);
    const stem = path.basename(ep.exportPath, path.extname(ep.exportPath));
    const assName = `${stem}.ass`;
    const out = path.join(dir, `${stem}_subtitled.mp4`);
    fs.writeFileSync(path.join(dir, assName), buildAss(ep.subtitles.cues, ep.subtitles.style, p.settings.width, p.settings.height));
    // Run from the folder so the filter only ever sees a plain file name (Windows paths and ':' break filter syntax).
    const fonts = process.platform === "win32" && fs.existsSync("C:\\Windows\\Fonts") ? ":fontsdir='C\\:/Windows/Fonts'" : "";
    const args = ["-y", "-i", path.basename(ep.exportPath), "-vf", `ass=${assName}${fonts}`, "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", path.basename(out)];
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("ffmpeg", args, { cwd: dir, windowsHide: true });
        let tail = "";
        proc.stderr.on("data", (c: Buffer) => { tail = (tail + c.toString()).slice(-3000); });
        proc.on("error", e => reject(new Error(`Could not run ffmpeg - is it on PATH? (${e.message})`)));
        proc.on("close", code => (code === 0 ? resolve() : reject(new Error(tail.split(/\r?\n/).filter(Boolean).slice(-3).join(" ")))));
      });
      ep.subtitles.outPath = out;
      ep.outputs = upsertOutput(ep.outputs, "subtitled", out);
      store.save(p);
      res.json(p);
    } catch (e: any) {
      bad(res, 500, e?.message || String(e));
    }
  });
}
