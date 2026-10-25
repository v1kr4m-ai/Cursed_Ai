/**
 * Join two series: every episode of one is added to the end of another, with its pictures and clips copied across.
 * The series that was joined in is left exactly as it was.
 */
import type express from "express";
import fs from "fs";
import path from "path";
import { createSeriesStore } from "./store";
import { newId, type Episode, type Project } from "./model";

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
const tagOf = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "series";

/** A path inside the joined-in series' folder, moved to where its copy lives in this series: refs/x.png -> refs/from-<tag>/x.png. Other paths stay as they are. */
export function movePath(value: string, srcDir: string, dstDir: string, tag: string): string {
  const from = norm(srcDir), n = value.replace(/\\/g, "/");
  if (!(n.toLowerCase().startsWith(from.toLowerCase() + "/"))) return value;
  const rest = n.slice(from.length + 1);
  const [top, ...more] = rest.split("/");
  if (!more.length) return value;
  const out = [norm(dstDir), top, "from-" + tag, ...more].join("/");
  return dstDir.includes("\\") ? out.replace(/\//g, "\\") : out;
}

const walk = (v: any, f: (s: string) => string): any =>
  typeof v === "string" ? f(v) : Array.isArray(v) ? v.map(x => walk(x, f)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, f)])) : v;

/** The source's episodes as they will be in the target: new ids, numbered after the target's last episode, paths pointing at the copied files. */
export function joinedEpisodes(target: Project, source: Project, tag: string): Episode[] {
  const base = target.episodes.reduce((n, e) => Math.max(n, e.number), 0);
  return source.episodes.map((e, i) => {
    const moved: Episode = walk(e, s => movePath(s, source.dir, target.dir, tag));
    const refIds = new Map(moved.refs.map(r => [r.id, newId()] as const));
    const refs = moved.refs.map(r => ({ ...r, id: refIds.get(r.id)!, fromRefIds: r.fromRefIds?.map(x => refIds.get(x) || x) }));
    const scenes = moved.scenes.map(s => ({ ...s, id: newId(), refIds: s.refIds.map(x => refIds.get(x) || x) }));
    return { ...moved, id: newId(), number: base + i + 1, refs, scenes };
  });
}

export function registerMerge(app: express.Express, opts: { projectsRoot: string }) {
  const store = createSeriesStore(opts.projectsRoot);

  app.post("/api/series/projects/:id/merge", (req, res) => {
    const target = store.get(req.params.id);
    const source = store.get(String(req.body?.from || ""));
    if (!target) return res.status(404).json({ error: "No such series." });
    if (!source) return res.status(404).json({ error: "The series to join was not found." });
    if (source.id === target.id) return res.status(400).json({ error: "A series cannot be joined to itself." });
    if (!source.episodes.length) return res.status(400).json({ error: `"${source.title}" has no episodes yet.` });
    try {
      const tag = tagOf(source.title);
      // Everything the source keeps in folders (pictures, clips, exports, audio...) is copied beside this series' own, under from-<name>.
      for (const entry of fs.readdirSync(source.dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        fs.cpSync(path.join(source.dir, entry.name), path.join(target.dir, entry.name, "from-" + tag), { recursive: true });
      }
      const added = joinedEpisodes(target, source, tag);
      store.patch(target.id, { episodes: [...target.episodes, ...added] });
      res.json({ ok: true, episodes: added.length });
    } catch (e: any) {
      res.status(500).json({ error: "Could not join the series: " + (e?.message || String(e)) });
    }
  });
}
