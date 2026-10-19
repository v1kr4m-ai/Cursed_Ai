/**
 * The prompt library: every prompt that produced an image or video, with the settings used and the file it made.
 * One SQLite file (prompts.db next to the app) so it can be searched, sorted, edited and reused later.
 */
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

export type Kind = "image" | "video";
export interface PromptEntry {
  id: number; kind: Kind; mode: string; workflow: string; prompt: string; negative: string;
  params: Record<string, any>; file: string; favorite: boolean; notes: string; tags: string; createdAt: number; updatedAt: number;
}
export interface PromptInput { kind: Kind; mode: string; workflow?: string; prompt: string; negative?: string; params?: Record<string, any>; file?: string; createdAt?: number }
export interface PromptQuery { kind?: Kind; q?: string; favorite?: boolean; mode?: string; sort?: "new" | "old" | "az" | "fav"; limit?: number; offset?: number }

export function createPromptDb(dir: string) {
  const db = new DatabaseSync(path.join(dir, "prompts.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL, mode TEXT NOT NULL DEFAULT '', workflow TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL, negative TEXT NOT NULL DEFAULT '', params TEXT NOT NULL DEFAULT '{}',
      file TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS prompts_kind_created ON prompts(kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS prompts_file ON prompts(file);
  `);

  const row = (r: any): PromptEntry => ({
    id: Number(r.id), kind: r.kind, mode: r.mode, workflow: r.workflow, prompt: r.prompt, negative: r.negative,
    params: (() => { try { return JSON.parse(r.params); } catch { return {}; } })(), file: r.file,
    favorite: !!r.favorite, notes: r.notes, tags: r.tags, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  });

  const insert = db.prepare("INSERT INTO prompts (kind, mode, workflow, prompt, negative, params, file, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const byFile = db.prepare("SELECT id FROM prompts WHERE file = ? AND file <> ''");

  return {
    add(e: PromptInput): number {
      const now = e.createdAt || Date.now();
      const file = e.file ? path.resolve(e.file) : "";
      if (file && byFile.get(file)) return 0; // same result file already recorded
      const r = insert.run(e.kind, e.mode || "", e.workflow || "", e.prompt, e.negative || "", JSON.stringify(e.params || {}), file, now, now);
      return Number(r.lastInsertRowid);
    },
    list(q: PromptQuery): { items: PromptEntry[]; total: number } {
      const where: string[] = [], args: any[] = [];
      if (q.kind) { where.push("kind = ?"); args.push(q.kind); }
      if (q.mode) { where.push("mode = ?"); args.push(q.mode); }
      if (q.favorite) where.push("favorite = 1");
      for (const term of (q.q || "").split(/\s+/).filter(Boolean).slice(0, 8)) {
        where.push("(prompt LIKE ? ESCAPE '\\' OR negative LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR workflow LIKE ? ESCAPE '\\')");
        const like = `%${term.replace(/[\\%_]/g, m => "\\" + m)}%`;
        args.push(like, like, like, like, like);
      }
      const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const order = q.sort === "old" ? "created_at ASC" : q.sort === "az" ? "prompt COLLATE NOCASE ASC" : q.sort === "fav" ? "favorite DESC, created_at DESC" : "created_at DESC";
      const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM prompts ${w}`).get(...args) as any).n);
      const rows = db.prepare(`SELECT * FROM prompts ${w} ORDER BY ${order}, id DESC LIMIT ? OFFSET ?`).all(...args, Math.min(q.limit || 60, 200), q.offset || 0);
      return { items: rows.map(row), total };
    },
    get(id: number): PromptEntry | null { const r = db.prepare("SELECT * FROM prompts WHERE id = ?").get(id); return r ? row(r) : null; },
    update(id: number, p: Partial<Pick<PromptEntry, "prompt" | "negative" | "notes" | "tags" | "favorite">>): boolean {
      const sets: string[] = [], args: any[] = [];
      if (typeof p.prompt === "string" && p.prompt.trim()) { sets.push("prompt = ?"); args.push(p.prompt); }
      if (typeof p.negative === "string") { sets.push("negative = ?"); args.push(p.negative); }
      if (typeof p.notes === "string") { sets.push("notes = ?"); args.push(p.notes); }
      if (typeof p.tags === "string") { sets.push("tags = ?"); args.push(p.tags); }
      if (typeof p.favorite === "boolean") { sets.push("favorite = ?"); args.push(p.favorite ? 1 : 0); }
      if (!sets.length) return false;
      sets.push("updated_at = ?"); args.push(Date.now());
      return Number(db.prepare(`UPDATE prompts SET ${sets.join(", ")} WHERE id = ?`).run(...args, id).changes) > 0;
    },
    remove(id: number): boolean { return Number(db.prepare("DELETE FROM prompts WHERE id = ?").run(id).changes) > 0; },
    count(): number { return Number((db.prepare("SELECT COUNT(*) AS n FROM prompts").get() as any).n); },
    close() { db.close(); },
    exists: (file: string) => !!file && fs.existsSync(file),
  };
}
