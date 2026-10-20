/**
 * Projects on disk. Each project is a folder:
 *
 *   <root>/<slug>/project.json   everything the UI shows
 *   <root>/<slug>/refs/          reference stills
 *   <root>/<slug>/clips/         finished scene clips
 *   <root>/<slug>/exports/       stitched episodes
 *
 * project.json is the single source of truth, so the work survives this app being closed and can
 * be picked up by hand (or by another tool) without any database.
 */
import fs from "fs";
import path from "path";
import {
  DEFAULT_SETTINGS, DEFAULT_STYLE_LOCK, DEFAULT_VOICE_LOCK,
  newId, type Project,
} from "./model";

const slugify = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "project";

export function createSeriesStore(root: string) {
  fs.mkdirSync(root, { recursive: true });

  const fileOf = (dir: string) => path.join(dir, "project.json");

  const read = (dir: string): Project | null => {
    try {
      const p = JSON.parse(fs.readFileSync(fileOf(dir), "utf8")) as Project;
      p.dir = dir; // the folder may have been moved since it was written
      return p;
    } catch { return null; }
  };

  // Temp file + rename: generation runs write progress while the UI saves edits, and a plain
  // write can hand a reader a half-finished file.
  const write = (p: Project) => {
    p.updatedAt = new Date().toISOString();
    const tmp = `${fileOf(p.dir)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(p, null, 2));
    fs.renameSync(tmp, fileOf(p.dir));
    return p;
  };

  return {
    root,

    list(): Project[] {
      return fs.readdirSync(root, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => read(path.join(root, d.name)))
        .filter((p): p is Project => !!p)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    get(id: string): Project | null {
      return this.list().find(p => p.id === id) || null;
    },

    create(title: string): Project {
      let dir = path.join(root, slugify(title));
      for (let n = 2; fs.existsSync(dir); n++) dir = path.join(root, `${slugify(title)}-${n}`);
      for (const sub of ["refs", "clips", "exports"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });

      const now = new Date().toISOString();
      return write({
        id: newId(),
        title,
        dir,
        createdAt: now,
        updatedAt: now,
        idea: { logline: "", audience: "", tone: "", notes: "" },
        discussion: [],
        styleLock: DEFAULT_STYLE_LOCK,
        voiceLock: DEFAULT_VOICE_LOCK,
        settings: { ...DEFAULT_SETTINGS },
        episodes: [],
        sources: [],
      });
    },

    save: write,

    /** Shallow merge of top-level keys, used by every PATCH from the UI. */
    patch(id: string, changes: Partial<Project>): Project | null {
      const p = this.get(id);
      if (!p) return null;
      return write({ ...p, ...changes, id: p.id, dir: p.dir, createdAt: p.createdAt });
    },

    remove(id: string): boolean {
      const p = this.get(id);
      if (!p) return false;
      fs.rmSync(p.dir, { recursive: true, force: true });
      return true;
    },

    refsDir: (p: Project) => path.join(p.dir, "refs"),
    clipsDir: (p: Project) => path.join(p.dir, "clips"),
    exportsDir: (p: Project) => path.join(p.dir, "exports"),
  };
}

export type SeriesStore = ReturnType<typeof createSeriesStore>;
