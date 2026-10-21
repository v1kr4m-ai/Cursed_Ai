/** The transcript of an Ollama_Claude session and how Claude Code's stream-json events build it. */

export type Item =
  | { kind: "user"; id: string; text: string }
  | { kind: "text"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string }
  | { kind: "tool"; id: string; toolId: string; name: string; input: any; status: "running" | "done" | "error"; result?: string; change?: Change }
  | { kind: "notice"; id: string; tone: "info" | "warn" | "error"; text: string }
  | { kind: "result"; id: string; ok: boolean; turns: number; ms: number; denials: { tool: string; input: any }[] };

/** A file Claude wrote or edited, with what it held before (null = it did not exist), so the change can be undone. */
export interface Change { path: string; before: string | null; big?: boolean; undone?: boolean }
const UNDO_LIMIT = 400_000;

/** Write and Edit results carry the file's previous content; keep it. */
function changeOf(r: any): Change | undefined {
  if (!r || typeof r.filePath !== "string" || r.originalFile === undefined) return undefined;
  const before: string | null = r.originalFile;
  if (typeof before === "string" && before.length > UNDO_LIMIT) return { path: r.filePath, before: null, big: true };
  return { path: r.filePath, before };
}

/** The files changed in a session, one row each: the oldest "before" wins, so undoing restores what was there at the start. */
export function changedFiles(items: Item[]): { path: string; before: string | null; big: boolean; undone: boolean }[] {
  const map = new Map<string, { path: string; before: string | null; big: boolean; undone: boolean }>();
  for (const it of items) {
    if (it.kind !== "tool" || !it.change) continue;
    const c = it.change, prev = map.get(c.path);
    if (prev) prev.undone = !!c.undone;
    else map.set(c.path, { path: c.path, before: c.before, big: !!c.big, undone: !!c.undone });
  }
  return [...map.values()];
}

export interface InitInfo { model: string; tools: string[]; slashCommands: string[]; mcpServers: { name: string; status: string }[]; cwd: string }

export interface Session {
  id: string;
  title: string;
  cwd: string;
  model: string;
  /** Claude Code's own session id, needed to continue the conversation. */
  claudeSessionId?: string;
  /** Start the next run as a copy of the Claude session instead of continuing it. */
  fork?: boolean;
  items: Item[];
  /** Tools the user allowed after a denial, kept for this session. */
  allowed: string[];
  init?: InitInfo;
  createdAt: number;
  updatedAt: number;
}

export interface Live { text: string; thinking: string }
export const emptyLive: Live = { text: "", thinking: "" };

let n = 0;
const uid = () => `i${Date.now().toString(36)}${(n++).toString(36)}`;

/** Tool results can be long; keep what the page needs to show. */
export function resultText(content: any): string {
  const t = typeof content === "string" ? content : Array.isArray(content) ? content.map((c: any) => (typeof c === "string" ? c : c?.text ?? "")).join("\n") : JSON.stringify(content ?? "");
  return t.length > 6000 ? t.slice(0, 6000) + `\n... (${t.length - 6000} more characters)` : t;
}

export interface Applied { items: Item[]; live: Live; patch: Partial<Session> }

/** Folds one event from the run into the transcript. Pure, so it can be tested. */
export function applyEvent(items: Item[], live: Live, ev: any): Applied {
  const same = { items, live, patch: {} as Partial<Session> };
  switch (ev?.type) {
    case "system": {
      if (ev.subtype !== "init") return same;
      const init: InitInfo = {
        model: ev.model || "", tools: ev.tools || [], slashCommands: ev.slash_commands || [], cwd: ev.cwd || "",
        mcpServers: (ev.mcp_servers || []).map((m: any) => ({ name: m.name, status: m.status })),
      };
      return { items, live, patch: { claudeSessionId: ev.session_id, init } };
    }
    case "stream_event": {
      const e = ev.event;
      if (e?.type === "content_block_delta") {
        if (e.delta?.type === "text_delta") return { items, live: { ...live, text: live.text + (e.delta.text || "") }, patch: {} };
        if (e.delta?.type === "thinking_delta") return { items, live: { ...live, thinking: live.thinking + (e.delta.thinking || "") }, patch: {} };
      }
      return same;
    }
    case "assistant": {
      const blocks: any[] = Array.isArray(ev.message?.content) ? ev.message.content : [];
      const add: Item[] = [];
      for (const b of blocks) {
        if (b.type === "text" && b.text?.trim()) add.push({ kind: "text", id: uid(), text: b.text });
        else if (b.type === "thinking" && b.thinking?.trim()) add.push({ kind: "thinking", id: uid(), text: b.thinking });
        else if (b.type === "tool_use") add.push({ kind: "tool", id: uid(), toolId: b.id, name: b.name, input: b.input, status: "running" });
      }
      return { items: [...items, ...add], live: emptyLive, patch: {} };
    }
    case "user": {
      const blocks: any[] = Array.isArray(ev.message?.content) ? ev.message.content : [];
      let next = items;
      for (const b of blocks) {
        if (b.type !== "tool_result") continue;
        next = next.map(it => (it.kind === "tool" && it.toolId === b.tool_use_id ? { ...it, status: b.is_error ? "error" : "done", result: resultText(b.content), change: b.is_error ? undefined : changeOf(ev.tool_use_result) } : it));
      }
      return { items: next, live, patch: {} };
    }
    case "result": {
      const denials = (ev.permission_denials || []).map((d: any) => ({ tool: d.tool_name, input: d.tool_input }));
      const add: Item[] = [];
      // An error with no assistant text before it (for example a model that cannot answer) still needs to be seen.
      if (ev.is_error && typeof ev.result === "string" && ev.result.trim()) add.push({ kind: "notice", id: uid(), tone: "error", text: ev.result });
      // A reply with nothing in it (small models do this when the instructions are long) would otherwise look like the page broke.
      const lastUser = items.map(i => i.kind).lastIndexOf("user");
      if (!ev.is_error && lastUser >= 0 && !items.slice(lastUser + 1).some(i => i.kind === "text" || i.kind === "tool") && !(typeof ev.result === "string" && ev.result.trim())) add.push({ kind: "notice", id: uid(), tone: "warn", text: "The model sent back an empty answer. Try a larger model, or a shorter, more specific request." });
      else if (!ev.is_error && lastUser >= 0 && !items.slice(lastUser + 1).some(i => i.kind === "text") && typeof ev.result === "string" && ev.result.trim()) add.push({ kind: "text", id: uid(), text: ev.result });
      add.push({ kind: "result", id: uid(), ok: !ev.is_error, turns: ev.num_turns || 0, ms: ev.duration_ms || 0, denials });
      // Anything still marked running did not get a result: the run ended.
      const closed = items.map(it => (it.kind === "tool" && it.status === "running" ? { ...it, status: "error" as const, result: it.result ?? "(no result - the run ended)" } : it));
      return { items: [...closed, ...add], live: emptyLive, patch: ev.session_id ? { claudeSessionId: ev.session_id } : {} };
    }
    case "cursed_exit": {
      if (!ev.code) return same;
      return { items: [...items, { kind: "notice", id: uid(), tone: "error", text: ev.stderr ? `Claude Code stopped (exit ${ev.code}): ${ev.stderr}` : `Claude Code stopped (exit ${ev.code}).` }], live: emptyLive, patch: {} };
    }
    case "cursed_error":
      return { items: [...items, { kind: "notice", id: uid(), tone: "error", text: ev.text }], live, patch: {} };
    default:
      return same;
  }
}

export const newSession = (cwd: string, model: string): Session => ({ id: uid(), title: "New session", cwd, model, items: [], allowed: [], createdAt: Date.now(), updatedAt: Date.now() });
export const userItem = (text: string): Item => ({ kind: "user", id: uid(), text });
export const noticeItem = (tone: "info" | "warn" | "error", text: string): Item => ({ kind: "notice", id: uid(), tone, text });

/** A short title from the first thing asked. */
export const titleFrom = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 48) || "New session";

const KEY = "cursed.oclaude.sessions";
export function loadSessions(): Session[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveSessions(list: Session[]) {
  const trimmed = [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
  try { localStorage.setItem(KEY, JSON.stringify(trimmed)); } catch { /* storage full or blocked */ }
}

/** The transcript as Markdown, for saving. */
export function toMarkdown(s: Session): string {
  const out = [`# ${s.title}`, "", `Model: ${s.model} - Folder: ${s.cwd}`, ""];
  for (const it of s.items) {
    if (it.kind === "user") out.push(`## You`, "", it.text, "");
    else if (it.kind === "text") out.push(`## Claude`, "", it.text, "");
    else if (it.kind === "tool") out.push(`**${it.name}** \`${JSON.stringify(it.input).slice(0, 200)}\``, "", it.result ? "```\n" + it.result.slice(0, 1500) + "\n```" : "", "");
    else if (it.kind === "notice") out.push(`> ${it.text}`, "");
  }
  return out.join("\n");
}
