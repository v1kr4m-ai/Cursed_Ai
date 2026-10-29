/**
 * Claude Code keeps every conversation as a .jsonl file under ~/.claude/projects/<folder>/, where <folder> is the
 * working folder with every character that is not a letter or digit turned into "-". Reading those lets a folder's
 * earlier sessions (from this app, the terminal or the desktop app) be listed and continued.
 */
import fs from "fs";
import os from "os";
import path from "path";

export const projectDirFor = (cwd: string, home = os.homedir()) => path.join(home, ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));

const textOf = (content: any): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("\n") : "";

/** A user line that someone typed (not a tool result, not the app's own wrapper text). */
const typed = (t: string) => !!t.trim() && !/^<(command|local-command|system-reminder|bash-)/.test(t.trim()) && !t.startsWith("Caveat:");

/** Title (first thing typed) of a session file's lines. */
export function titleOf(lines: string[]): string {
  for (const line of lines) {
    try {
      const j = JSON.parse(line);
      if (j.type === "user" && !j.isMeta) { const t = textOf(j.message?.content); if (typed(t)) return t.replace(/\s+/g, " ").trim().slice(0, 80); }
      if (j.type === "summary" && j.summary) return String(j.summary).slice(0, 80);
    } catch { /* a partial line */ }
  }
  return "(untitled session)";
}

export type HistoryItem =
  | { kind: "user"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; toolId: string; name: string; input: any };

/** The conversation in a session file, as transcript items (what was typed, what Claude wrote, the tools it used). */
export function itemsOf(lines: string[], max = 600): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (const line of lines) {
    let j: any;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.isMeta || j.isSidechain) continue;
    if (j.type === "user") { const t = textOf(j.message?.content); if (typed(t)) out.push({ kind: "user", text: t }); }
    else if (j.type === "assistant" && Array.isArray(j.message?.content)) {
      for (const b of j.message.content) {
        if (b.type === "text" && b.text?.trim()) out.push({ kind: "text", text: b.text });
        else if (b.type === "tool_use") out.push({ kind: "tool", toolId: b.id, name: b.name, input: b.input });
      }
    }
  }
  return out.slice(-max);
}

export function listSessions(cwd: string, home?: string): { id: string; title: string; updatedAt: number }[] {
  const dir = projectDirFor(cwd, home);
  let names: string[];
  try { names = fs.readdirSync(dir).filter(n => n.endsWith(".jsonl")); } catch { return []; }
  return names.map(n => {
    const file = path.join(dir, n);
    const st = fs.statSync(file);
    // The title is near the top; reading the first part is enough even for long sessions.
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(Math.min(st.size, 256_000));
    try { fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
    return { id: n.slice(0, -6), title: titleOf(buf.toString("utf8").split(/\r?\n/)), updatedAt: st.mtimeMs };
  }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
}

/** The real folder a session file was made in (Claude Code writes it on its lines as "cwd"). */
export function cwdOf(lines: string[]): string | null {
  for (const line of lines) {
    try { const j = JSON.parse(line); if (typeof j.cwd === "string" && j.cwd) return j.cwd; } catch { /* a partial line */ }
  }
  return null;
}

/** Every folder Claude Code has sessions in, newest first, with how many. Temporary folders are left out. */
export function listFolders(home = os.homedir()): { cwd: string; count: number; updatedAt: number }[] {
  const root = path.join(home, ".claude", "projects");
  let dirs: string[];
  try { dirs = fs.readdirSync(root); } catch { return []; }
  const out: { cwd: string; count: number; updatedAt: number }[] = [];
  for (const d of dirs) {
    const dir = path.join(root, d);
    let files: { f: string; t: number }[];
    try { files = fs.readdirSync(dir).filter(n => n.endsWith(".jsonl")).map(n => ({ f: path.join(dir, n), t: fs.statSync(path.join(dir, n)).mtimeMs })); } catch { continue; }
    if (!files.length) continue;
    files.sort((a, b) => b.t - a.t);
    let cwd: string | null = null;
    for (const { f } of files.slice(0, 3)) {
      const fd = fs.openSync(f, "r");
      const buf = Buffer.alloc(Math.min(fs.statSync(f).size, 128_000));
      try { fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
      cwd = cwdOf(buf.toString("utf8").split(/\r?\n/));
      if (cwd) break;
    }
    if (!cwd || /[\\/](temp|tmp)[\\/]/i.test(cwd)) continue;
    out.push({ cwd, count: files.length, updatedAt: files[0].t });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function readSession(cwd: string, id: string, home?: string): HistoryItem[] | null {
  if (!/^[A-Za-z0-9-]+$/.test(id)) return null;
  const file = path.join(projectDirFor(cwd, home), id + ".jsonl");
  try { return itemsOf(fs.readFileSync(file, "utf8").split(/\r?\n/)); } catch { return null; }
}
