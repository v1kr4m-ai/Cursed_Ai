/**
 * Finishing an episode: audio tracks (uploaded, or pulled out of a video), their timing, and one render that burns in the subtitles
 * and/or mixes the audio. Every render is recorded as an output version so the UI can show which is the latest and which is the final.
 */
import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { probeDuration } from "./ffmpeg";
import { createSeriesStore } from "./store";
import { newId } from "./model";
import { buildAss } from "./subtitlesCore";
import { buildAudioFilter, cleanTracks, upsertOutput, type AudioMix, type AudioTrack, type OutputKind } from "./finishCore";

function ffmpeg(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { cwd, windowsHide: true });
    let tail = "";
    proc.stderr.on("data", (c: Buffer) => { tail = (tail + c.toString()).slice(-3000); });
    proc.on("error", e => reject(new Error(`Could not run ffmpeg - is it on PATH? (${e.message})`)));
    proc.on("close", code => (code === 0 ? resolve() : reject(new Error(tail.split(/\r?\n/).filter(Boolean).slice(-3).join(" ")))));
  });
}

export function registerFinish(app: express.Express, opts: { projectsRoot: string }) {
  const store = createSeriesStore(opts.projectsRoot);
  const bad = (res: express.Response, code: number, message: string) => res.status(code).json({ error: message });
  const find = (pid: string, eid: string) => {
    const p = store.get(pid);
    const ep = p?.episodes.find(e => e.id === eid);
    return p && ep ? { p, ep } : null;
  };
  const base = "/api/series/projects/:id/episodes/:episodeId";
  const emptyMix = (): AudioMix => ({ tracks: [], keepOriginal: true, originalGain: 1, updatedAt: "" });

  /** Add a sound file - or a video, whose sound is pulled out - as a track. */
  app.post(`${base}/audio/upload`, express.raw({ type: "*/*", limit: "600mb" }), async (req, res) => {
    const found = find(req.params.id, req.params.episodeId);
    if (!found) return bad(res, 404, "No such episode.");
    const { p, ep } = found;
    if (!Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 400, "No file received.");
    const name = String(req.query.name || "audio").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
    const dir = path.join(p.dir, "audio");
    fs.mkdirSync(dir, { recursive: true });
    const id = newId();
    const raw = path.join(dir, `${id}_src${path.extname(name) || ".bin"}`);
    const out = path.join(dir, `${id}.m4a`);
    try {
      fs.writeFileSync(raw, req.body);
      await ffmpeg(["-y", "-i", raw, "-vn", "-ac", "2", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", out]);
      const duration = (await probeDuration(out)) || 0;
      if (!duration) throw new Error("There is no sound in that file.");
      const track: AudioTrack = { id, name: name.replace(/\.[^.]+$/, ""), file: out, duration, offset: Math.max(0, Number(req.query.offset) || 0), gain: 1, fadeIn: 0, fadeOut: 0 };
      const mix = ep.audio || emptyMix();
      ep.audio = { ...mix, tracks: [...mix.tracks, track], updatedAt: new Date().toISOString() };
      store.save(p);
      res.json(p);
    } catch (e: any) {
      bad(res, 500, e?.message?.includes("Invalid data") ? "That file has no sound ffmpeg can read." : e?.message || String(e));
    } finally {
      try { fs.unlinkSync(raw); } catch { /* never written or already gone */ }
    }
  });

  /** Timing, gain, fades, names, and whether the original sound stays. */
  app.put(`${base}/audio`, (req, res) => {
    const found = find(req.params.id, req.params.episodeId);
    if (!found) return bad(res, 404, "No such episode.");
    const { p, ep } = found;
    const prev = ep.audio || emptyMix();
    ep.audio = {
      tracks: cleanTracks(req.body?.tracks, prev.tracks),
      keepOriginal: typeof req.body?.keepOriginal === "boolean" ? req.body.keepOriginal : prev.keepOriginal,
      originalGain: Number.isFinite(Number(req.body?.originalGain)) ? Math.min(4, Math.max(0, Number(req.body.originalGain))) : prev.originalGain,
      updatedAt: new Date().toISOString(),
    };
    store.save(p);
    res.json(p);
  });

  app.delete(`${base}/audio/:trackId`, (req, res) => {
    const found = find(req.params.id, req.params.episodeId);
    if (!found || !found.ep.audio) return bad(res, 404, "No such track.");
    const { p, ep } = found;
    const gone = ep.audio!.tracks.find(t => t.id === req.params.trackId);
    if (!gone) return bad(res, 404, "No such track.");
    ep.audio = { ...ep.audio!, tracks: ep.audio!.tracks.filter(t => t.id !== gone.id), updatedAt: new Date().toISOString() };
    try { fs.unlinkSync(gone.file); } catch { /* already gone */ }
    store.save(p);
    res.json(p);
  });

  /** One pass from the joined video: burn the subtitles and/or mix the audio. */
  app.post(`${base}/render`, async (req, res) => {
    const found = find(req.params.id, req.params.episodeId);
    if (!found) return bad(res, 404, "No such episode.");
    const { p, ep } = found;
    const subs = !!req.body?.subtitles, audio = !!req.body?.audio;
    if (!subs && !audio) return bad(res, 400, "Choose subtitles, audio, or both.");
    if (!ep.exportPath || !fs.existsSync(ep.exportPath)) return bad(res, 400, "Join the episode into one file first.");
    if (subs && !ep.subtitles?.cues.length) return bad(res, 400, "There are no subtitles to burn in yet.");
    const tracks = (ep.audio?.tracks || []).filter(t => fs.existsSync(t.file));
    if (audio && !tracks.length && !(ep.audio && !ep.audio.keepOriginal)) return bad(res, 400, "Add an audio track first.");

    const dir = path.dirname(ep.exportPath);
    const stem = path.basename(ep.exportPath, path.extname(ep.exportPath));
    const kind: OutputKind = subs && audio ? "final" : subs ? "subtitled" : "audio";
    const out = path.join(dir, `${stem}_${kind}.mp4`);
    try {
      const videoDur = (await probeDuration(ep.exportPath)) || 0;
      const args = ["-y", "-i", path.basename(ep.exportPath)];
      let filters = "";
      if (audio) for (const t of tracks) args.push("-i", t.file);
      if (audio) {
        const mix = { tracks, keepOriginal: ep.audio?.keepOriginal ?? true, originalGain: ep.audio?.originalGain ?? 1 };
        const g = buildAudioFilter(mix, videoDur || 3600);
        if (!g) return bad(res, 400, "Nothing to mix.");
        filters = g.filter;
        args.push("-filter_complex", g.filter, "-map", "0:v", "-map", g.label);
      } else args.push("-map", "0:v", "-map", "0:a?");
      if (subs) {
        const assName = `${stem}.ass`;
        fs.writeFileSync(path.join(dir, assName), buildAss(ep.subtitles!.cues, ep.subtitles!.style, p.settings.width, p.settings.height));
        const fonts = process.platform === "win32" && fs.existsSync("C:\\Windows\\Fonts") ? ":fontsdir='C\\:/Windows/Fonts'" : "";
        args.push("-vf", `ass=${assName}${fonts}`, "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p");
      } else args.push("-c:v", "copy");
      if (audio) args.push("-c:a", "aac", "-b:a", "192k"); else args.push("-c:a", "copy");
      args.push("-movflags", "+faststart", path.basename(out));
      try {
        await ffmpeg(args, dir);
      } catch (e: any) {
        // Older ffmpeg builds do not know amix's normalize option: redo the mix without it.
        if (audio && /normalize/i.test(String(e?.message))) {
          const mix = { tracks, keepOriginal: ep.audio?.keepOriginal ?? true, originalGain: ep.audio?.originalGain ?? 1 };
          const g = buildAudioFilter(mix, videoDur || 3600, true)!;
          args[args.indexOf(filters)] = g.filter;
          await ffmpeg(args, dir);
        } else throw e;
      }
      ep.outputs = upsertOutput(ep.outputs, kind, out);
      if (kind === "subtitled") ep.subtitles = { ...ep.subtitles!, outPath: out };
      store.save(p);
      res.json(p);
    } catch (e: any) {
      bad(res, 500, e?.message || String(e));
    }
  });

  /** Pin which version is the final one (null goes back to "the newest"). */
  app.put(`${base}/final`, (req, res) => {
    const found = find(req.params.id, req.params.episodeId);
    if (!found) return bad(res, 404, "No such episode.");
    const { p, ep } = found;
    const kind = req.body?.kind;
    ep.finalKind = kind === "joined" || kind === "subtitled" || kind === "audio" || kind === "final" ? kind : undefined;
    store.save(p);
    res.json(p);
  });
}
