/**
 * Export finished episodes to a folder of your choice: tidy numbered file names, the version you pick (raw join, subtitled, music added,
 * subtitles + music, or the best one), an .srt next to each video (for uploading to YouTube and the like), and a series.json with titles and
 * hooks. Also builds a master video: every chosen episode cut together into one file.
 */
import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { createSeriesStore } from "./store";
import { stitch } from "./ffmpeg";
import { buildSrt } from "./subtitlesCore";
import { pickFinal } from "./finishCore";
import type { Episode } from "./model";

const safe = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "episode";

export type ExportKind = "joined" | "subtitled" | "audio" | "final" | "best";
const KINDS: ExportKind[] = ["joined", "subtitled", "audio", "final", "best"];
const LABEL: Record<ExportKind, string> = { joined: "raw", subtitled: "subtitled", audio: "music added", final: "subtitles and music", best: "best versions" };

/** The file of an episode in the chosen version, or null when that version was never made. */
export function versionPath(e: Episode, kind: ExportKind): string | null {
  let p: string | null | undefined;
  if (kind === "best") p = pickFinal(e.exportPath, e.outputs, e.finalKind);
  else if (kind === "joined") p = e.exportPath;
  else p = (e.outputs || []).find(o => o.kind === kind)?.path || (kind === "subtitled" ? e.subtitles?.outPath : null);
  return p && fs.existsSync(p) ? p : null;
}

export function registerExport(app: express.Express, opts: { projectsRoot: string }) {
  const store = createSeriesStore(opts.projectsRoot);
  const pickKind = (body: any): ExportKind => (KINDS.includes(body?.kind) ? body.kind : body?.subtitled === false ? "joined" : "best");

  app.post("/api/series/projects/:id/export", (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return res.status(404).json({ error: "No such project." });
    const dir = String(req.body?.dir || "").trim();
    if (!dir) return res.status(400).json({ error: "Choose a folder to export to." });
    const kind = pickKind(req.body);
    const only: string[] | null = Array.isArray(req.body?.episodeIds) ? req.body.episodeIds.map(String) : null;
    const candidates = p.episodes.filter(e => e.exportPath && (!only || only.includes(e.id))).sort((a, b) => a.number - b.number);
    if (!candidates.length) return res.status(400).json({ error: "Join at least one episode first." });
    const ready = candidates.filter(e => versionPath(e, kind));
    const skipped = candidates.filter(e => !versionPath(e, kind)).map(e => ({ number: e.number, title: e.title }));
    if (!ready.length) return res.status(400).json({ error: `No episode has a ${LABEL[kind]} version yet.` });
    try {
      fs.mkdirSync(dir, { recursive: true });
      const files: string[] = [];
      const manifest: any[] = [];
      for (const e of ready) {
        const source = versionPath(e, kind)!;
        const base = `${String(e.number).padStart(2, "0")} - ${safe(e.title)}`;
        const video = path.join(dir, base + ".mp4");
        fs.copyFileSync(source, video);
        files.push(video);
        let srt: string | null = null;
        if (e.subtitles?.cues.length) {
          srt = path.join(dir, base + ".srt");
          fs.writeFileSync(srt, buildSrt(e.subtitles.cues));
          files.push(srt);
        }
        manifest.push({ number: e.number, title: e.title, era: e.era, hookOut: e.hookOut, file: path.basename(video), version: kind === "best" ? (e.finalKind || "newest") : kind, subtitles: srt ? path.basename(srt) : null });
      }
      for (const e of ready) e.exportedAt = new Date().toISOString();
      store.save(p);
      if (!only) {
        const sidecar = path.join(dir, "series.json");
        fs.writeFileSync(sidecar, JSON.stringify({ title: p.title, logline: p.idea.logline, exportedAt: new Date().toISOString(), episodes: manifest }, null, 2));
        files.push(sidecar);
      }
      res.json({ dir: path.resolve(dir), files, episodes: ready.length, skipped });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  /** One video with every chosen episode cut together, in order. */
  app.post("/api/series/projects/:id/master", async (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return res.status(404).json({ error: "No such project." });
    const dir = String(req.body?.dir || "").trim();
    if (!dir) return res.status(400).json({ error: "Choose a folder for the master video." });
    const kind = pickKind(req.body);
    const eps = p.episodes.filter(e => e.exportPath).sort((a, b) => a.number - b.number);
    const clips = eps.map(e => versionPath(e, kind)).filter((x): x is string => !!x);
    const skipped = eps.filter(e => !versionPath(e, kind)).map(e => ({ number: e.number, title: e.title }));
    if (!clips.length) return res.status(400).json({ error: `No episode has a ${LABEL[kind]} version yet.` });
    try {
      fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, `${safe(p.title)} - master (${LABEL[kind]}).mp4`);
      await stitch({ clips, outFile: out, width: p.settings.width, height: p.settings.height, fps: p.settings.fps });
      res.json({ file: out, dir: path.resolve(dir), episodes: clips.length, skipped });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  /** Open a folder in the file manager. */
  app.post("/api/series/reveal-folder", (req, res) => {
    const dir = String(req.body?.path || "");
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return res.status(404).json({ error: "Folder not found." });
    try {
      const cmd = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
      spawn(cmd, [path.resolve(dir)], { detached: true, stdio: "ignore" }).unref();
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
