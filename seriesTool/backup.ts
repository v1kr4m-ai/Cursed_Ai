/**
 * Back up a series as one zip (story, plan, pictures, clips, exports) and bring it back, on this PC or another.
 *
 * A project stores absolute paths to its pictures and clips, so importing rewrites every path that pointed into the old
 * project folder to the new one. A zip is checked before it is opened: entries that try to leave the folder are refused.
 */
import type express from "express";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { createSeriesStore } from "./store";
import { newId, type Project } from "./model";

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "series";

export const backupName = (title: string, when = new Date(), withoutClips = false) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${slug(title)}-${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}-${p(when.getHours())}${p(when.getMinutes())}${withoutClips ? "-no-clips" : ""}.zip`;
};

/** Zip entry names that would write outside the folder they are extracted into. */
export function unsafeEntries(names: string[]): string[] {
  return names.filter(n => {
    const x = n.replace(/\\/g, "/");
    return x.startsWith("/") || /^[a-zA-Z]:/.test(x) || x.split("/").some(part => part === "..");
  });
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** Every string in `value` that starts with the old project folder now starts with the new one. */
export function rebasePaths<T>(value: T, oldDir: string, newDir: string): T {
  const from = norm(oldDir);
  const go = (v: any): any => {
    if (typeof v === "string") {
      const n = v.replace(/\\/g, "/");
      if (n.toLowerCase() === from || n.toLowerCase().startsWith(from + "/")) {
        const rest = n.slice(from.length);
        return newDir + (newDir.includes("\\") ? rest.replace(/\//g, "\\") : rest);
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(go);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, go(x)]));
    return v;
  };
  return go(value);
}

const POWERSHELL = "powershell.exe";
function ps(script: string, env: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise(resolve => {
    const child = spawn(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, ...env }, windowsHide: true });
    let out = "", err = "";
    child.stdout.on("data", d => { out += d.toString("utf8"); });
    child.stderr.on("data", d => { err += d.toString("utf8"); });
    child.on("error", e => resolve({ code: -1, out, err: e.message }));
    child.on("close", code => resolve({ code, out, err }));
  });
}

const ZIP_PREAMBLE = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem;";

export function registerBackup(app: express.Express, opts: { projectsRoot: string }) {
  const store = createSeriesStore(opts.projectsRoot);
  const noWindows = (res: express.Response) => res.status(501).json({ error: "Backups use Windows PowerShell; this PC is not Windows." });

  /** Writes <folder>/<title>-<date>.zip. Clips and exports can be left out to keep it small (they can be rendered again). */
  app.post("/api/series/projects/:id/backup", async (req, res) => {
    if (process.platform !== "win32") return noWindows(res);
    const p = store.get(req.params.id);
    if (!p) return res.status(404).json({ error: "No such series." });
    const dest = String(req.body?.dest || "");
    if (!dest || !fs.existsSync(dest) || !fs.statSync(dest).isDirectory()) return res.status(400).json({ error: "Choose a folder to save the backup in." });
    const skip = req.body?.includeClips === false ? "clips|exports" : "";
    const zip = path.join(dest, backupName(p.title, new Date(), !!skip));
    const script = ZIP_PREAMBLE + `
      $src=$env:SRC; $zip=$env:ZIP; $skip=@($env:SKIP -split '\\|' | Where-Object { $_ });
      if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip }
      $za=[IO.Compression.ZipFile]::Open($zip,'Create');
      try {
        Get-ChildItem -LiteralPath $src -Recurse -File -Force | ForEach-Object {
          $rel=$_.FullName.Substring($src.Length).TrimStart([char]92,[char]47);
          $top=($rel -split '[\\\\/]')[0];
          if ($skip -contains $top) { return }
          [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($za,$_.FullName,($rel -replace '\\\\','/'),'Optimal')
        }
      } finally { $za.Dispose() }`;
    const r = await ps(script, { SRC: p.dir, ZIP: zip, SKIP: skip });
    if (r.code !== 0 || !fs.existsSync(zip)) return res.status(500).json({ error: "Could not write the backup: " + (r.err.trim().split("\n")[0] || "unknown error") });
    res.json({ ok: true, file: zip, bytes: fs.statSync(zip).size, withClips: !skip });
  });

  /** Windows' own "open file" dialog, for choosing a backup. */
  app.post("/api/series/pick-backup", async (_req, res) => {
    if (process.platform !== "win32") return noWindows(res);
    const script = "Add-Type -AssemblyName System.Windows.Forms; $o=New-Object System.Windows.Forms.Form; $o.TopMost=$true; $o.ShowInTaskbar=$false; $o.StartPosition='CenterScreen'; $o.Size=New-Object System.Drawing.Size(1,1); $o.Show(); $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Filter='Series backup (*.zip)|*.zip'; if ($d.ShowDialog($o) -eq 'OK') { [Console]::Out.Write($d.FileName) }; $o.Close()";
    const child = spawn(POWERSHELL, ["-NoProfile", "-STA", "-Command", script], { windowsHide: false });
    let out = "";
    child.stdout.on("data", d => { out += d.toString("utf8"); });
    child.on("error", e => res.status(500).json({ error: e.message }));
    child.on("close", () => res.json({ path: out.trim() || null }));
  });

  /** Unpacks a backup into a new project folder and points every path in it at the new place. */
  app.post("/api/series/projects/import", async (req, res) => {
    if (process.platform !== "win32") return noWindows(res);
    const zip = String(req.body?.zip || "");
    if (!zip || !/\.zip$/i.test(zip) || !fs.existsSync(zip)) return res.status(400).json({ error: "Choose a backup (.zip) file." });

    const list = await ps(ZIP_PREAMBLE + "$za=[IO.Compression.ZipFile]::OpenRead($env:ZIP); try { $za.Entries | ForEach-Object { $_.FullName } } finally { $za.Dispose() }", { ZIP: zip });
    if (list.code !== 0) return res.status(400).json({ error: "That file could not be read as a zip." });
    const names = list.out.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const bad = unsafeEntries(names);
    if (bad.length) return res.status(400).json({ error: "That zip has entries that would write outside the series folder, so it was not opened." });
    if (!names.some(n => n.replace(/\\/g, "/") === "project.json")) return res.status(400).json({ error: "That zip is not a series backup (it has no project.json)." });

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "series-import-"));
    try {
      const x = await ps(ZIP_PREAMBLE + "[IO.Compression.ZipFile]::ExtractToDirectory($env:ZIP,$env:TMP_DIR)", { ZIP: zip, TMP_DIR: tmp });
      if (x.code !== 0) return res.status(500).json({ error: "Could not unpack the backup: " + (x.err.trim().split("\n")[0] || "unknown error") });
      let project: Project;
      try { project = JSON.parse(fs.readFileSync(path.join(tmp, "project.json"), "utf8")); } catch { return res.status(400).json({ error: "The backup's project.json is damaged." }); }
      if (!project || !Array.isArray(project.episodes)) return res.status(400).json({ error: "That is not a series project." });

      let dir = path.join(opts.projectsRoot, slug(project.title || "series"));
      for (let n = 2; fs.existsSync(dir); n++) dir = path.join(opts.projectsRoot, `${slug(project.title || "series")}-${n}`);
      fs.mkdirSync(opts.projectsRoot, { recursive: true });
      fs.cpSync(tmp, dir, { recursive: true });

      const taken = store.list().some(q => q.id === project.id);
      const moved: Project = { ...rebasePaths(project, project.dir || "", dir), dir, id: taken || !project.id ? newId() : project.id, updatedAt: new Date().toISOString() };
      for (const sub of ["refs", "clips", "exports"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
      fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(moved, null, 2));
      res.json({ ok: true, id: moved.id, title: moved.title, episodes: moved.episodes.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

