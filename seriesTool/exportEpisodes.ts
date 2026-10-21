/**
 * Export finished episodes to a folder of your choice: tidy numbered file names, the subtitled copy when there is one,
 * an .srt next to each video (for uploading to YouTube and the like), and a series.json with titles and hooks.
 */
import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { createSeriesStore } from "./store";
import { buildSrt } from "./subtitlesCore";
import { pickFinal } from "./finishCore";

const safe = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "episode";

export function registerExport(app: express.Express, opts: { projectsRoot: string }) {
  const store = createSeriesStore(opts.projectsRoot);

  app.post("/api/series/projects/:id/export", (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return res.status(404).json({ error: "No such project." });
    const dir = String(req.body?.dir || "").trim();
    if (!dir) return res.status(400).json({ error: "Choose a folder to export to." });
    const preferSubtitled = req.body?.subtitled !== false;
    const ready = p.episodes.filter(e => e.exportPath && fs.existsSync(e.exportPath));
    if (!ready.length) return res.status(400).json({ error: "Join at least one episode first." });
    try {
      fs.mkdirSync(dir, { recursive: true });
      const files: string[] = [];
      const manifest: any[] = [];
      for (const e of ready) {
        const chosen = preferSubtitled ? pickFinal(e.exportPath!, e.outputs, e.finalKind) : null;
        const burned = chosen && chosen !== e.exportPath && fs.existsSync(chosen) ? chosen : null;
        const base = `${String(e.number).padStart(2, "0")} - ${safe(e.title)}`;
        const video = path.join(dir, base + ".mp4");
        fs.copyFileSync(burned || e.exportPath!, video);
        files.push(video);
        let srt: string | null = null;
        if (e.subtitles?.cues.length) {
          srt = path.join(dir, base + ".srt");
          fs.writeFileSync(srt, buildSrt(e.subtitles.cues));
          files.push(srt);
        }
        manifest.push({ number: e.number, title: e.title, era: e.era, hookOut: e.hookOut, file: path.basename(video), subtitles: srt ? path.basename(srt) : null, burnedSubtitles: !!burned });
      }
      for (const e of ready) e.exportedAt = new Date().toISOString();
      store.save(p);
      const sidecar = path.join(dir, "series.json");
      fs.writeFileSync(sidecar, JSON.stringify({ title: p.title, logline: p.idea.logline, exportedAt: new Date().toISOString(), episodes: manifest }, null, 2));
      files.push(sidecar);
      res.json({ dir: path.resolve(dir), files, episodes: ready.length });
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
