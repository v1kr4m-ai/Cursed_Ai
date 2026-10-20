/**
 * Render jobs live in memory, so when the app stops (or ComfyUI crashes) every reference and scene that was "queued" or
 * "running" is left that way on disk and the board shows work that is no longer happening. At start-up nothing can be
 * running, so those are put right: a clip that is actually on disk counts as done, everything else goes back to pending
 * so "Render what's missing" picks it up again.
 */
import fs from "fs";
import path from "path";

interface Item { status?: string; error?: string | null; clipPath?: string | null; file?: string | null }

export function resetInterruptedJobs(projectsRoot: string): { projects: number; reset: number } {
  let projects = 0, reset = 0;
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(projectsRoot, { withFileTypes: true }); } catch { return { projects, reset }; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(projectsRoot, e.name, "project.json");
    let project: any;
    try { project = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    let changed = 0;
    const fix = (item: Item, mediaKey: "clipPath" | "file") => {
      if (item.status !== "queued" && item.status !== "running") return;
      const media = item[mediaKey];
      item.status = media && fs.existsSync(media) ? "done" : "pending";
      item.error = null;
      changed++;
    };
    for (const ep of project.episodes || []) {
      for (const r of ep.refs || []) fix(r, "file");
      for (const s of ep.scenes || []) fix(s, "clipPath");
    }
    if (changed) {
      project.updatedAt = new Date().toISOString();
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(project, null, 2));
      fs.renameSync(tmp, file);
      reset += changed;
    }
    projects++;
  }
  return { projects, reset };
}
