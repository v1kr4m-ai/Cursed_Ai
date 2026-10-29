import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "motion/react";
import { AlertTriangle, Archive, Bot, Brain, Check, CheckCircle2, ChevronDown, Cloud, Copy, Cpu, Download, FolderOpen, GitBranch, GitFork, Mic, PanelLeft, PanelRight, Paperclip, Search, Loader2, MoreVertical, Plus, RefreshCw, Send, Settings2, ShieldCheck, Square, Trash2, Undo2, X } from "lucide-react";
import { AppSettings, MessageRole } from "../../types";
import { cn } from "@/lib/utils";
import { nativeFolder } from "../comfy/types";
import { notify, notifyError } from "../../lib/notify";
import { CodeBlock } from "../chat/ChatWindow";
import { changedFiles } from "./events";
import { ToolGroup } from "./ToolCard";
import { useDictation } from "../../services/useDictation";
import { APP_COMMANDS, Chip, QuickBar } from "./QuickBar";
import { StatusRings } from "./StatusRings";
import { applyEvent, emptyLive, loadSessions, newSession, noticeItem, saveSessions, titleFrom, toMarkdown, userItem, type Live, type Session } from "./events";

interface ModelInfo { name: string; compatible: boolean; reason: string; tools: boolean; thinking: boolean; vision: boolean; cloud: boolean; contextLength: number | null; sizeBytes: number | null; params: string }
interface Status {
  claude: { found: boolean; path: string | null; version: string };
  ollama: { running: boolean; version: string; url: string };
  models: ModelInfo[];
  loaded: { name: string; contextLength: number | null }[];
  workspace: string;
}

const PERMISSIONS = [
  { id: "plan", label: "Plan", note: "Read-only: Claude explores and proposes, changes nothing." },
  { id: "acceptEdits", label: "Edit", note: "Claude may read and edit files in the folder. Shell commands are blocked unless you allow them." },
  { id: "bypassPermissions", label: "Full", note: "Claude may do anything in the folder, including running commands. Use only in folders you can afford to lose." },
] as const;

const PREF_KEY = "cursed.oclaude.prefs";
interface Prefs { model: string; permission: string; userSettings: boolean; maxTurns: number; appendSystemPrompt: string; addDirs: string[]; showQuick: boolean; activeId: string; leftPane: boolean; rightPane: boolean }
const defaultPrefs: Prefs = { model: "", permission: "acceptEdits", userSettings: false, maxTurns: 0, appendSystemPrompt: "", addDirs: [], showQuick: true, activeId: "", leftPane: true, rightPane: true };
const loadPrefs = (): Prefs => { try { return { ...defaultPrefs, ...JSON.parse(localStorage.getItem(PREF_KEY) || "{}") }; } catch { return defaultPrefs; } };

const fmtSize = (n: number | null) => (n ? (n > 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`) : "");
const fmtCtx = (n: number | null) => (n ? (n >= 1000 ? `${Math.round(n / 1024)}k ctx` : `${n} ctx`) : "");
const ago = (t: number) => { const s = (Date.now() - t) / 1000; return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };

export function OllamaClaudeView({ settings }: { settings: AppSettings }) {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [prefs, setPrefsState] = React.useState<Prefs>(loadPrefs);
  const setPrefs = (patch: Partial<Prefs>) => setPrefsState(p => { const n = { ...p, ...patch }; try { localStorage.setItem(PREF_KEY, JSON.stringify(n)); } catch { /* storage blocked */ } return n; });
  const [sessions, setSessions] = React.useState<Session[]>(loadSessions);
  const [input, setInput] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [live, setLive] = React.useState<Live>(emptyLive);
  const [elapsed, setElapsed] = React.useState(0);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [sessionsOpen, setSessionsOpen] = React.useState(false);
  const [setupOpen, setSetupOpen] = React.useState(false);
  const [showHidden, setShowHidden] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const abort = React.useRef<AbortController | null>(null);
  const runId = React.useRef("");
  const scroller = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const refresh = React.useCallback(async () => {
    try { setStatus(await (await fetch("/api/oclaude/status")).json()); } catch { setStatus(null); }
  }, []);
  React.useEffect(() => { refresh(); const t = setInterval(refresh, 20000); return () => clearInterval(t); }, [refresh]);

  const compatible = status?.models.filter(m => m.compatible) ?? [];
  const hidden = status?.models.filter(m => !m.compatible) ?? [];
  const model = compatible.find(m => m.name === prefs.model) ? prefs.model : compatible[0]?.name ?? "";
  const modelInfo = compatible.find(m => m.name === model);

  const session: Session = sessions.find(s => s.id === prefs.activeId) || sessions[0] || null as any;
  const update = React.useCallback((id: string, fn: (s: Session) => Session) => {
    setSessions(list => { const next = list.map(s => (s.id === id ? fn(s) : s)); saveSessions(next); return next; });
  }, []);

  // A first visit starts with one empty session in the default folder.
  React.useEffect(() => {
    if (!status || sessions.length) return;
    const s = newSession(status.workspace, model);
    setSessions([s]); setPrefs({ activeId: s.id });
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [session?.items.length, live.text, live.thinking, running]);
  React.useEffect(() => {
    if (!running) { setElapsed(0); return; }
    const t0 = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);

  const [filesOpen, setFilesOpen] = React.useState(false);
  const undoFiles = async (paths: string[]) => {
    if (!session) return;
    const done: string[] = [];
    // Newest first, so a file Claude touched twice ends up as it was at the start.
    for (const f of changedFiles(session.items).filter(f => paths.includes(f.path) && !f.undone && !f.big).reverse()) {
      try {
        const r = await fetch("/api/oclaude/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: session.cwd, addDirs: prefs.addDirs, path: f.path, before: f.before }) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not undo");
        done.push(f.path);
      } catch (e: any) { notifyError(`${f.path}: ${e.message}`, "ollamaclaude"); }
    }
    if (done.length) {
      update(session.id, s => ({ ...s, items: s.items.map(it => (it.kind === "tool" && it.change && done.includes(it.change.path) ? { ...it, change: { ...it.change, undone: true } } : it)) }));
      notify({ message: `Put back ${done.length} file${done.length > 1 ? "s" : ""}`, tab: "ollamaclaude" });
    }
  };

  const startNew = (cwd?: string) => {
    const s = newSession(cwd || session?.cwd || status?.workspace || "", model);
    setSessions(l => { const n = [s, ...l]; saveSessions(n); return n; });
    setPrefs({ activeId: s.id }); setInput(""); setSessionsOpen(false);
  };
  const removeSession = (id: string) => {
    setSessions(l => { const n = l.filter(s => s.id !== id); saveSessions(n); if (id === prefs.activeId) setPrefs({ activeId: n[0]?.id || "" }); return n; });
  };
  const chooseFolder = async () => {
    const p = await nativeFolder(session?.cwd);
    if (typeof p === "string" && session) update(session.id, s => ({ ...s, cwd: p, claudeSessionId: undefined, init: undefined }));
  };
  const addFolder = async () => {
    const p = await nativeFolder(session?.cwd);
    if (typeof p === "string" && !prefs.addDirs.includes(p)) setPrefs({ addDirs: [...prefs.addDirs, p] });
  };
  const choosePermission = (id: string) => {
    if (id === "bypassPermissions" && !window.confirm("Full access lets Claude run any command and change any file in the working folder without asking. Only use it in a folder you can afford to lose. Switch on?")) return;
    setPrefs({ permission: id });
  };

  /** Says something in the transcript without running Claude. */
  const note = (text: string, tone: "info" | "warn" | "error" = "info") => update(session.id, s => ({ ...s, items: [...s.items, noticeItem(tone, text)] }));

  /**
   * Commands the app answers itself (Claude Code runs here without its interactive screen, so these would do nothing
   * there). Anything else that starts with "/" goes to Claude Code as before (/compact, /init, /review, your own commands).
   */
  function appCommand(text: string): boolean {
    const m = /^\/([a-z-]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
    if (!m) return false;
    const cmd = m[1].toLowerCase(), arg = (m[2] || "").trim();
    const find = (list: Session[], q: string) => (/^\d+$/.test(q) ? list[Number(q) - 1] : list.find(s => s.title.toLowerCase().includes(q.toLowerCase())));
    switch (cmd) {
      case "help":
        note(APP_COMMANDS.map(c => `/${c.name}${c.args ? " " + c.args : ""} - ${c.note}`).join("\n") + "\n\nOther commands (/compact, /init, /review, /cost, your own) go to Claude Code.");
        return true;
      case "clear": case "new": startNew(); return true;
      case "resume": {
        loadHistory();
        if (!folderSessions.length) { note(`No earlier sessions in ${session.cwd}. Change the folder (Environment, on the right, or /folder) to see another folder's sessions.`, "warn"); return true; }
        if (!arg) { setSessionsOpen(true); note(`Sessions in ${session.cwd}:\n` + folderSessions.map((s, i) => `${i + 1}. ${s.title} - ${ago(s.updatedAt)}${s.claudeId ? " (Claude Code)" : ""}`).join("\n") + "\n\nClick one in the list, or type /resume <number or part of the title>."); return true; }
        const e = /^\d+$/.test(arg) ? folderSessions[Number(arg) - 1] : folderSessions.find(x => x.title.toLowerCase().includes(arg.toLowerCase()));
        if (!e) { note(`No session in this folder matches "${arg}".`, "warn"); return true; }
        resumeEntry(e); return true;
      }
      case "rename":
        if (!arg) { note("Type the new name after /rename.", "warn"); return true; }
        update(session.id, s => ({ ...s, title: arg.slice(0, 80) })); notify({ message: `Renamed to "${arg.slice(0, 80)}"`, tab: "ollamaclaude" }); return true;
      case "model": {
        if (!arg) { note(`Model: ${model || "none"}\nAvailable: ${compatible.map(c => c.name).join(", ") || "none that support tool calls"}\n\nType /model <name>.`); return true; }
        const pick = compatible.find(c => c.name === arg) || compatible.find(c => c.name.toLowerCase().includes(arg.toLowerCase()));
        if (!pick) { note(`No model that supports tool calls matches "${arg}".`, "warn"); return true; }
        setPrefs({ model: pick.name }); notify({ message: `Model: ${pick.name}`, tab: "ollamaclaude" }); return true;
      }
      case "permissions": case "mode": {
        const p = PERMISSIONS.find(x => x.label.toLowerCase() === arg.toLowerCase() || x.id.toLowerCase() === arg.toLowerCase());
        if (!p) { note(`Permission: ${PERMISSIONS.find(x => x.id === prefs.permission)?.label}. Choose with /permissions plan, edit or full.`); return true; }
        choosePermission(p.id); return true;
      }
      case "folder": case "cd": chooseFolder(); return true;
      case "add-dir": addFolder(); return true;
      case "export": exportMd(); return true;
      case "fork": update(session.id, s => ({ ...s, fork: true })); note("The next message starts a new branch of this conversation (the original stays as it was)."); return true;
      case "status":
        note(`Model: ${model || "none"}${loadedCtx ? ` (${fmtCtx(loadedCtx)})` : ""}\nFolder: ${session.cwd}${prefs.addDirs.length ? `\nAlso: ${prefs.addDirs.join(", ")}` : ""}\nPermission: ${PERMISSIONS.find(x => x.id === prefs.permission)?.label}\nSession: ${session.title} (${session.items.length} entries)`);
        return true;
      case "delete": {
        if (!confirm(`Delete the session "${session.title}"? Its transcript is removed from this app (files Claude changed stay changed).`)) return true;
        removeSession(session.id); return true;
      }
      default: return false;
    }
  }

  async function send(textOverride?: string, extraAllowed: string[] = []) {
    const text = (textOverride ?? input).trim();
    if (!text || running || !session) return;
    if (!textOverride && appCommand(text)) { setInput(""); return; }
    if (!status?.claude.found) { notifyError("Claude Code is not installed - see the setup card.", "ollamaclaude"); return; }
    if (!model) { notifyError("No installed model supports tool calls, so none can drive Claude Code.", "ollamaclaude"); return; }
    const id = session.id;
    const allowed = [...new Set([...session.allowed, ...extraAllowed])];
    if (!textOverride) setInput("");
    // The transcript is built here, outside React's state updater: updaters run twice in development and would double every streamed word.
    const first = userItem(text);
    let itemsNow = [...session.items, first];
    update(id, s => ({ ...s, model, allowed, title: s.items.length ? s.title : titleFrom(text), items: itemsNow, updatedAt: Date.now() }));
    setRunning(true); setLive(emptyLive);
    const ctrl = new AbortController();
    abort.current = ctrl;
    let liveNow = emptyLive;
    try {
      const res = await fetch("/api/oclaude/run", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
        body: JSON.stringify({ prompt: text, model, cwd: session.cwd, sessionId: session.claudeSessionId, fork: !!session.fork, permission: prefs.permission, allowedTools: allowed, addDirs: prefs.addDirs, maxTurns: prefs.maxTurns, appendSystemPrompt: prefs.appendSystemPrompt, userSettings: prefs.userSettings }),
      });
      if (!res.ok || !res.body) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Could not start Claude Code."); }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          let ev: any;
          try { ev = JSON.parse(part.slice(6)); } catch { continue; }
          if (ev.type === "cursed_run") { runId.current = ev.runId; update(id, s => ({ ...s, fork: false })); continue; }
          const a = applyEvent(itemsNow, liveNow, ev);
          itemsNow = a.items; liveNow = a.live;
          update(id, s => ({ ...s, ...a.patch, items: a.items, updatedAt: Date.now() }));
          setLive(liveNow);
        }
      }
    } catch (e: any) {
      itemsNow = [...itemsNow, e?.name !== "AbortError" ? noticeItem("error", e?.message || String(e)) : noticeItem("info", "Stopped.")];
      const end = itemsNow;
      update(id, s => ({ ...s, items: end }));
    } finally {
      setRunning(false); setLive(emptyLive); abort.current = null; runId.current = "";
    }
  }
  const stop = () => {
    if (runId.current) fetch("/api/oclaude/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: runId.current }) }).catch(() => {});
    abort.current?.abort();
  };

  const allowAndRetry = (tools: string[]) => send("You now have permission to use " + tools.join(", ") + ". Please carry on with what you were doing.", tools);
  // Files dropped on the message box are saved in the session folder (attachments/) and mentioned with @, so Claude reads them.
  const [dragging, setDragging] = React.useState(false);
  const [sessionQuery, setSessionQuery] = React.useState("");
  const [git, setGit] = React.useState<{ repo: boolean; branch?: string; files?: number; added?: number; removed?: number; untracked?: number } | null>(null);
  React.useEffect(() => {
    if (!session?.cwd || running) return;
    fetch("/api/oclaude/git?cwd=" + encodeURIComponent(session.cwd)).then(r => r.json()).then(setGit).catch(() => setGit(null));
  }, [session?.cwd, running]);
  const dictation = useDictation(input, setInput);
  const [history, setHistory] = React.useState<{ id: string; title: string; updatedAt: number }[]>([]);
  const loadHistory = React.useCallback(() => {
    if (!session?.cwd) return;
    fetch("/api/oclaude/history?cwd=" + encodeURIComponent(session.cwd)).then(r => r.json()).then(d => setHistory(d.sessions || [])).catch(() => setHistory([]));
  }, [session?.cwd]);
  React.useEffect(() => { loadHistory(); }, [loadHistory]);
  type FolderEntry = { key: string; title: string; updatedAt: number; app?: Session; claudeId?: string };
  const folderSessions: FolderEntry[] = (() => {
    if (!session) return [];
    const mine = sessions.filter(x => x.cwd === session.cwd);
    const known = new Set(mine.map(x => x.claudeSessionId).filter(Boolean));
    return [
      ...mine.map(x => ({ key: x.id, title: x.title, updatedAt: x.updatedAt, app: x })),
      ...history.filter(h => !known.has(h.id)).map(h => ({ key: "cc-" + h.id, title: h.title, updatedAt: h.updatedAt, claudeId: h.id })),
    ].sort((a, b) => b.updatedAt - a.updatedAt);
  })();
  /** Opens a session from the folder list; one Claude Code made elsewhere is brought in with its conversation and continues where it stopped. */
  const resumeEntry = async (e: FolderEntry) => {
    setSessionsOpen(false);
    if (e.app) { setPrefs({ activeId: e.app.id }); return; }
    try {
      const r = await fetch(`/api/oclaude/history/${e.claudeId}?cwd=${encodeURIComponent(session.cwd)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not read that session.");
      const rid = () => Math.random().toString(36).slice(2, 10);
      const items = (d.items as any[]).map(it => (it.kind === "user" ? userItem(it.text) : it.kind === "text" ? { kind: "text" as const, id: rid(), text: it.text } : { kind: "tool" as const, id: rid(), toolId: it.toolId, name: it.name, input: it.input, status: "done" as const }));
      const s2: Session = { ...newSession(session.cwd, model), title: e.title, claudeSessionId: e.claudeId, items, updatedAt: e.updatedAt };
      setSessions(l => { const n = [s2, ...l]; saveSessions(n); return n; });
      setPrefs({ activeId: s2.id });
      notify({ message: `Resumed "${e.title}" - your next message continues it`, tab: "ollamaclaude" });
    } catch (err: any) { notifyError(err?.message || String(err), "ollamaclaude"); }
  };
  const filePicker = React.useRef<HTMLInputElement>(null);
  const dropFiles = async (files: FileList | null) => {
    setDragging(false);
    const list = Array.from(files || []);
    if (!list.length || !session) return;
    const refs: string[] = [];
    for (const f of list) {
      try {
        const r = await fetch(`/api/oclaude/drop?cwd=${encodeURIComponent(session.cwd)}&name=${encodeURIComponent(f.name)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: f });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not save the file.");
        refs.push("@" + (/\s/.test(d.path) ? `"${d.path}"` : d.path));
      } catch (e: any) { notifyError(`${f.name}: ${e?.message || e}`, "ollamaclaude"); }
    }
    if (refs.length) { setInput(v => (v && !v.endsWith(" ") ? v + " " : v) + refs.join(" ") + " "); inputRef.current?.focus(); notify({ message: `${refs.length} file${refs.length > 1 ? "s" : ""} added to attachments/ in the session folder`, tab: "ollamaclaude" }); }
  };
  const insert = (text: string, replace?: boolean) => { setInput(v => (replace ? text : v + text)); inputRef.current?.focus(); };
  const exportMd = () => {
    if (!session) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toMarkdown(session)], { type: "text/markdown" }));
    a.download = (session.title.replace(/[^\w -]+/g, "").trim() || "session") + ".md"; a.click(); URL.revokeObjectURL(a.href);
  };
  const copyCmd = (t: string) => { navigator.clipboard?.writeText(t).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };

  const problems = !status ? ["Cannot reach the Cursed_Ai server."] : [
    ...(!status.claude.found ? ["Claude Code is not installed. Install it (npm i -g @anthropic-ai/claude-code, or the native installer) and come back."] : []),
    ...(!status.ollama.running ? ["Ollama is not running. Start it (the tray icon, or `ollama serve`)."] : []),
    ...(status.ollama.running && !compatible.length ? ["None of your Ollama models support tool calls. Pull one that does, for example `ollama pull qwen3-coder` or `ollama pull qwen3:8b`."] : []),
  ];
  const loadedCtx = status?.loaded.find(l => l.name === model)?.contextLength ?? null;
  const smallCtx = loadedCtx !== null && loadedCtx < 16384;
  const [restarting, setRestarting] = React.useState(false);
  /** Restarts Ollama with a 32k window after the person confirms; everything Ollama has loaded is dropped. */
  const restartOllama = async () => {
    if (!confirm("Restart Ollama with a 32k context window?\n\nThis stops Ollama now: any model it has loaded or is answering is dropped (Chat, Series and Ollama_Claude may be interrupted). The setting is also saved for your Windows user, so Ollama keeps it next time.")) return;
    setRestarting(true);
    try {
      const r = await fetch("/api/oclaude/ollama-context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contextLength: 32768 }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not restart Ollama.");
      notify({ message: `Ollama restarted with a ${Math.round(d.contextLength / 1024)}k window - send your message again`, tab: "ollamaclaude" });
      refresh();
    } catch (e: any) { notifyError(e.message, "ollamaclaude"); } finally { setRestarting(false); }
  };
  const items = session?.items ?? [];
  const lastResult = [...items].reverse().find(i => i.kind === "result");
  const canSend = !!input.trim() && !running && !!model && !!status?.claude.found;

  const picker = (
    <div className="relative">
      <button onClick={() => setPickerOpen(v => !v)} title="Model (only models that can use tools are listed)" className="flex h-9 max-w-[11rem] items-center gap-1.5 rounded-xl border border-white/5 px-2.5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white">
        <Cpu size={16} className="shrink-0 text-violet-400" />
        <span className="max-w-[110px] truncate text-xs font-bold">{model || "No model"}</span>
        <ChevronDown size={14} className={cn("transition-transform", pickerOpen && "rotate-180")} />
      </button>
      {pickerOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
          <div className="absolute bottom-full left-0 z-50 mb-2 max-h-96 w-[min(22rem,calc(100vw-2.5rem))] overflow-y-auto rounded-2xl border border-white/15 bg-zinc-950 shadow-2xl shadow-black/60">
            <p className="px-4 pb-1 pt-3 text-[10px] font-black uppercase tracking-widest text-zinc-600">Models that can drive Claude Code</p>
            {compatible.map(m => (
              <button key={m.name} onClick={() => { setPrefs({ model: m.name }); setPickerOpen(false); }} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-zinc-200 transition-colors hover:bg-white/5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{m.name}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-[10px] uppercase tracking-widest text-zinc-500">
                    {m.cloud ? <span className="flex items-center gap-1 text-sky-400"><Cloud size={10} />online</span> : <span className="text-emerald-400">offline</span>}
                    {m.thinking && <span className="flex items-center gap-1"><Brain size={10} />thinks</span>}
                    {m.vision && <span>vision</span>}
                    {m.params && <span>{m.params}</span>}{!m.cloud && parseFloat(m.params) < 7 && <span className="text-amber-400" title="Models under about 7B often fumble Claude Code's tools or answer with nothing">small</span>}{fmtSize(m.sizeBytes) && <span>{fmtSize(m.sizeBytes)}</span>}{fmtCtx(m.contextLength) && <span>{fmtCtx(m.contextLength)}</span>}
                  </p>
                </div>
                {m.name === model && <CheckCircle2 size={16} className="shrink-0 text-violet-400" />}
              </button>
            ))}
            {!compatible.length && <p className="px-4 py-3 text-xs text-zinc-500">Nothing installed can use tools yet.</p>}
            {hidden.length > 0 && (
              <div className="border-t border-white/5">
                <button onClick={() => setShowHidden(v => !v)} className="w-full px-4 py-2.5 text-left text-[11px] text-zinc-600 hover:text-zinc-400">{hidden.length} other installed model{hidden.length === 1 ? "" : "s"} can't drive Claude Code {showHidden ? "(hide)" : "(why?)"}</button>
                {showHidden && hidden.map(m => <p key={m.name} className="px-4 pb-2 text-[11px] text-zinc-600"><span className="text-zinc-500">{m.name}</span> - {m.reason}</p>)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );

  if (!status || !session) {
    return <div className="glass flex h-full flex-1 items-center justify-center rounded-[2.5rem] text-sm text-zinc-500"><Loader2 size={16} className="mr-2 animate-spin" />{status === null ? "Looking for Claude Code and Ollama..." : "Starting..."}</div>;
  }

  // Sessions grouped by the folder they work in, newest first, filtered by the search box.
  const sessionGroups = (() => {
    const q = sessionQuery.trim().toLowerCase();
    const list = [...sessions].filter(s => !q || s.title.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q)).sort((a, b) => b.updatedAt - a.updatedAt);
    const out: { folder: string; cwd: string; list: Session[] }[] = [];
    for (const s of list) {
      const folder = s.cwd.split(/[\\/]/).filter(Boolean).pop() || s.cwd || "No folder";
      let g = out.find(x => x.cwd === s.cwd);
      if (!g) { g = { folder, cwd: s.cwd, list: [] }; out.push(g); }
      g.list.push(s);
    }
    return out;
  })();
  const ctxMax = loadedCtx || modelInfo?.contextLength || null;
  const ctxPct = ctxMax && session.ctxTokens ? Math.min(100, (session.ctxTokens / ctxMax) * 100) : null;
  const files = changedFiles(session.items);
  const card = "rounded-2xl border border-white/5 bg-white/[0.03] p-3.5";

  return (
    <div className="glass relative flex h-full flex-1 overflow-hidden rounded-[2.5rem]">
      {prefs.leftPane && (
        <aside className="hidden w-60 shrink-0 flex-col border-r border-white/5 bg-black/10 md:flex">
          <div className="space-y-1 p-3">
            <button onClick={() => startNew()} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-zinc-200 hover:bg-white/5"><Plus size={16} />New session</button>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input value={sessionQuery} onChange={e => setSessionQuery(e.target.value)} placeholder="Search" className="w-full rounded-xl bg-transparent py-2 pl-8 pr-2 text-sm text-zinc-200 placeholder:text-zinc-500 hover:bg-white/5 focus:bg-white/5 focus:outline-none" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {sessionGroups.map(g => (
              <div key={g.cwd} className="mb-3">
                <p className="truncate px-2.5 pb-1 text-[11px] font-medium text-zinc-500" title={g.cwd}>{g.folder}</p>
                {g.list.map(s => (
                  <div key={s.id} className={cn("group flex items-center rounded-lg", s.id === session.id ? "bg-white/10" : "hover:bg-white/5")}>
                    <button onClick={() => setPrefs({ activeId: s.id })} title={`${s.title}\n${s.model || "no model"} - ${ago(s.updatedAt)}`} className={cn("min-w-0 flex-1 truncate px-2.5 py-1.5 text-left text-[13px]", s.id === session.id ? "text-white" : "text-zinc-300")}>{s.title}</button>
                    <button onClick={() => { if (confirm(`Delete the session "${s.title}"?`)) removeSession(s.id); }} title="Delete" className="mr-1 hidden rounded p-1 text-zinc-500 hover:text-rose-400 group-hover:block"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            ))}
            {!sessionGroups.length && <p className="px-2.5 text-xs text-zinc-600">No sessions match.</p>}
          </div>
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
      {/* header */}
      <div className="z-10 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-white/5 bg-transparent px-5 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={() => setPrefs({ leftPane: !prefs.leftPane })} title={prefs.leftPane ? "Hide the sessions" : "Show the sessions"} className="hidden rounded-lg p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white md:block"><PanelLeft size={17} /></button>
          <span className="truncate text-sm font-medium text-zinc-200" title="Double-click to rename" onDoubleClick={() => { const t = window.prompt("Rename this session", session.title); if (t?.trim()) update(session.id, s => ({ ...s, title: t.trim().slice(0, 80) })); }}>{session.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button onClick={() => setPrefs({ rightPane: !prefs.rightPane })} title={prefs.rightPane ? "Hide the details" : "Show the details"} className="hidden p-2 text-zinc-500 transition-colors hover:text-white lg:block"><PanelRight size={18} /></button>
          <button onClick={() => setSetupOpen(v => !v)} title="Session settings" className={cn("p-2 transition-colors", setupOpen ? "text-violet-400" : "text-zinc-500 hover:text-white")}><Settings2 size={18} /></button>
          <div className="relative">
            <button onClick={() => { if (!sessionsOpen) loadHistory(); setSessionsOpen(v => !v); }} title="Sessions in this folder" className="p-2 text-zinc-500 transition-colors hover:text-white"><Archive size={18} /></button>
            {sessionsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSessionsOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-2 max-h-[28rem] w-96 overflow-y-auto rounded-2xl border border-white/15 bg-zinc-950 py-1 shadow-2xl shadow-black/60">
                  <div className="flex items-center gap-2 px-4 pb-1 pt-2.5">
                    <p className="min-w-0 flex-1 truncate text-[11px] text-zinc-500" title={session.cwd}>Sessions in <span className="text-zinc-300">{session.cwd.split(/[\\/]/).filter(Boolean).pop()}</span></p>
                    <button onClick={() => { setSessionsOpen(false); chooseFolder(); }} className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-violet-300 hover:bg-white/5">Change folder</button>
                  </div>
                  <button onClick={() => startNew()} className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-violet-300 hover:bg-white/5"><Plus size={15} />New session here</button>
                  {folderSessions.map((e, i) => (
                    <div key={e.key} className={cn("group flex items-center gap-2 px-4 py-2 hover:bg-white/5", e.app?.id === session.id && "bg-white/[0.04]")}>
                      <span className="w-5 shrink-0 text-right text-[10px] text-zinc-600">{i + 1}</span>
                      <button onClick={() => resumeEntry(e)} className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm text-zinc-200">{e.title}</p>
                        <p className="truncate text-[10px] text-zinc-600">{ago(e.updatedAt)}{e.claudeId ? " - made in Claude Code, click to continue it here" : e.app?.model ? ` - ${e.app.model}` : ""}</p>
                      </button>
                      {e.app && <button onClick={() => removeSession(e.app!.id)} title="Delete" className="hidden text-zinc-600 hover:text-rose-400 group-hover:block"><Trash2 size={13} /></button>}
                    </div>
                  ))}
                  {!folderSessions.length && <p className="px-4 py-3 text-xs text-zinc-500">No sessions in this folder yet.</p>}
                </div>
              </>
            )}
          </div>
          <div className="relative">
            <button onClick={() => setMenuOpen(v => !v)} title="Options" className="p-2 text-zinc-500 transition-colors hover:text-white"><MoreVertical size={18} /></button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-white/15 bg-zinc-950 py-1 shadow-2xl shadow-black/60">
                  {[
                    { icon: <Plus size={15} />, label: "New session here", act: () => startNew() },
                    { icon: <GitFork size={15} />, label: "Fork this session", act: () => { if (session.claudeSessionId) { const s = { ...newSession(session.cwd, model), title: session.title + " (fork)", items: session.items, claudeSessionId: session.claudeSessionId, fork: true, allowed: session.allowed, init: session.init }; setSessions(l => { const n = [s, ...l]; saveSessions(n); return n; }); setPrefs({ activeId: s.id }); notify({ message: "Forked - the next message continues in a copy", tab: "ollamaclaude" }); } else notifyError("Nothing to fork yet - send a message first.", "ollamaclaude"); } },
                    { icon: <Download size={15} />, label: "Export as Markdown", act: exportMd },
                    { icon: <Trash2 size={15} />, label: "Clear this session", act: () => { if (window.confirm("Clear this session's transcript? Claude's own memory of it is dropped too.")) update(session.id, s => ({ ...s, items: [], claudeSessionId: undefined, init: undefined, allowed: [] })); } },
                  ].map(it => <button key={it.label} onClick={() => { setMenuOpen(false); it.act(); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-zinc-200 hover:bg-white/5">{it.icon}{it.label}</button>)}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* session settings */}
      {setupOpen && (
        <div className="grid shrink-0 gap-3 border-b border-white/5 bg-white/[0.02] px-8 py-4 md:grid-cols-3">
          <div className="space-y-2 rounded-2xl border border-white/5 bg-white/[0.03] p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Folders Claude may use</p>
            <p className="truncate font-mono text-xs text-zinc-300" title={session.cwd}>{session.cwd}</p>
            <div className="flex flex-wrap gap-1.5">{prefs.addDirs.map(d => <Chip key={d} onRemove={() => setPrefs({ addDirs: prefs.addDirs.filter(x => x !== d) })}>{d.split(/[\\/]/).pop()}</Chip>)}</div>
            <button onClick={addFolder} className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-[11px] font-bold text-zinc-300 hover:bg-white/10"><Plus size={12} />Add another folder</button>
          </div>
          <div className="space-y-3 rounded-2xl border border-white/5 bg-white/[0.03] p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">How it runs</p>
            <label className="flex items-center justify-between gap-3 text-xs text-zinc-300"><span title="Adds your hooks and the whole skill list to every request - often 50k+ tokens. Fine for big models, too much for small ones.">Use my Claude settings, skills and plugins</span><input type="checkbox" checked={prefs.userSettings} onChange={e => setPrefs({ userSettings: e.target.checked })} className="accent-violet-500" /></label>
            <label className="flex items-center justify-between gap-3 text-xs text-zinc-300"><span>Stop after this many steps (0 = no limit)</span><input type="number" min={0} max={200} value={prefs.maxTurns} onChange={e => setPrefs({ maxTurns: Number(e.target.value) || 0 })} className="w-16 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-right text-xs text-white focus:outline-none" /></label>
            <div className="flex flex-wrap gap-1.5">{session.allowed.map(t => <Chip key={t} onRemove={() => update(session.id, s => ({ ...s, allowed: s.allowed.filter(x => x !== t) }))}><ShieldCheck size={11} className="text-emerald-400" />{t}</Chip>)}{!session.allowed.length && <span className="text-[11px] text-zinc-600">No extra tools allowed yet. Allow one when Claude is blocked.</span>}</div>
          </div>
          <div className="space-y-2 rounded-2xl border border-white/5 bg-white/[0.03] p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Extra instructions for every message</p>
            <textarea value={prefs.appendSystemPrompt} onChange={e => setPrefs({ appendSystemPrompt: e.target.value })} rows={4} placeholder="e.g. Keep answers short. Ask before deleting anything." className="w-full resize-none rounded-xl border border-white/10 bg-white/5 p-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none" />
          </div>
        </div>
      )}

      {/* messages */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-3xl flex-col pb-12">
          {!items.length && !running && (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-[2rem] border border-white/10 bg-white/5 shadow-2xl shadow-violet-500/10"><Bot size={40} className="text-violet-400" /></div>
              <h1 className="mb-3 text-2xl font-bold tracking-tight text-white">Claude Code, on your own models</h1>
              <p className="mb-8 max-w-md text-sm leading-relaxed text-zinc-500">Runs the real Claude Code agent - reading, editing, running commands - with <span className="font-mono text-violet-400">{model || "an Ollama model"}</span> doing the thinking. Nothing goes to Anthropic.</p>
              <div className="grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  { ok: status.claude.found, title: "Claude Code", note: status.claude.found ? status.claude.version : "not found" },
                  { ok: status.ollama.running, title: "Ollama", note: status.ollama.running ? `v${status.ollama.version || "?"}` : "not running" },
                  { ok: compatible.length > 0, title: "Models", note: `${compatible.length} can use tools` },
                ].map(c => (
                  <div key={c.title} className="rounded-2xl border border-white/5 p-4 text-left">
                    <div className="mb-1 flex items-center gap-2"><div className={cn("h-1.5 w-1.5 rounded-full", c.ok ? "bg-emerald-500" : "bg-rose-500")} /><span className="text-[10px] uppercase tracking-widest text-zinc-600">{c.title}</span></div>
                    <p className="text-xs font-medium text-zinc-400">{c.note}</p>
                  </div>
                ))}
              </div>
              {problems.length > 0 && (
                <div className="mt-6 w-full max-w-xl space-y-2">{problems.map(p => <div key={p} className="flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-left text-xs text-amber-300"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{p}</div>)}</div>
              )}
              <p className="mt-8 max-w-md text-[11px] leading-relaxed text-zinc-600">Pick the folder to work in (Environment, on the right), choose what Claude may do (under the message box: Plan, Edit or Full), then ask. The ready prompts above the box are a good start.</p>
            </div>
          )}

          {items.map((it, idx) => {
            // A run of tool calls shows as one line ("Ran 3 commands"), drawn where the run starts.
            if (it.kind === "tool") {
              if (items[idx - 1]?.kind === "tool") return null;
              const run: any[] = [];
              for (let j = idx; j < items.length && items[j].kind === "tool"; j++) run.push(items[j]);
              return <ToolGroup key={it.id} tools={run} />;
            }
            switch (it.kind) {
              case "user": return <motion.div key={it.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-5 mt-2 ml-auto max-w-[80%] whitespace-pre-wrap rounded-2xl bg-white/[0.07] px-4 py-3 text-sm leading-relaxed text-zinc-100">{it.text}</motion.div>;
              case "text": return (
                <motion.div key={it.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="group/t mb-3 text-[15px] leading-relaxed text-zinc-200">
                  <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock }}>{it.text}</ReactMarkdown></div>
                  <button onClick={() => navigator.clipboard?.writeText(it.text).then(() => notify({ message: "Copied", tab: "ollamaclaude" })).catch(() => {})} title="Copy" className="mt-1 rounded p-1 text-zinc-600 opacity-0 transition hover:text-zinc-300 group-hover/t:opacity-100"><Copy size={13} /></button>
                </motion.div>
              );
              case "thinking": return (
                <details key={it.id} className="mb-3 max-w-[80%] rounded-2xl border border-white/5 px-4 py-2 text-xs text-zinc-500">
                  <summary className="flex cursor-pointer items-center gap-2 select-none"><Brain size={13} className="text-violet-400" />Thinking</summary>
                  <p className="mt-2 whitespace-pre-wrap italic leading-relaxed">{it.text}</p>
                </details>
              );
              case "notice": return <div key={it.id} className={cn("mx-auto my-2 max-w-[80%] rounded-full px-4 py-1.5 text-center text-[11px]", it.tone === "error" ? "bg-rose-500/10 text-rose-300" : it.tone === "warn" ? "bg-amber-500/10 text-amber-300" : "bg-white/5 text-zinc-500")}>{it.text}</div>;
              case "result": return (
                <div key={it.id} className="mb-4 mt-1">
                  <p className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-600">
                    {it.ok ? <Check size={11} className="text-emerald-500" /> : <X size={11} className="text-rose-500" />}{it.ok ? "Done" : "Stopped with an error"}{it.turns ? ` - ${it.turns} step${it.turns === 1 ? "" : "s"}` : ""}{it.ms ? ` - ${(it.ms / 1000).toFixed(1)} s` : ""}
                  </p>
                  {it.denials.length > 0 && idx === items.length - 1 && (
                    <div className="mt-2 max-w-[88%] rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-200">
                      <p className="mb-2 flex items-center gap-2 font-bold"><ShieldCheck size={14} />Blocked by "{PERMISSIONS.find(p => p.id === prefs.permission)?.label}" mode</p>
                      <ul className="mb-3 space-y-1 font-mono text-[11px] text-amber-300/80">{it.denials.slice(0, 4).map((d, i) => <li key={i} className="truncate">{d.tool}: {typeof d.input?.command === "string" ? d.input.command : JSON.stringify(d.input).slice(0, 100)}</li>)}</ul>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => allowAndRetry([...new Set(it.denials.map(d => d.tool))])} disabled={running} className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-[11px] font-bold hover:bg-amber-500/30 disabled:opacity-40">Allow {[...new Set(it.denials.map(d => d.tool))].join(", ")} and carry on</button>
                        {prefs.permission !== "bypassPermissions" && <button onClick={() => choosePermission("bypassPermissions")} className="rounded-lg bg-white/5 px-3 py-1.5 text-[11px] font-bold hover:bg-white/10">Switch to Full</button>}
                      </div>
                    </div>
                  )}
                </div>
              );
            }
          })}

          {running && (live.thinking || live.text) && (
            <>
              {live.thinking && !live.text && <div className="mb-3 max-w-[80%] rounded-2xl border border-white/5 px-4 py-2 text-xs italic text-zinc-500"><Brain size={13} className="mr-2 inline text-violet-400" />{live.thinking.slice(-280)}</div>}
              {live.text && <div className="mb-3 text-[15px] leading-relaxed text-zinc-200"><div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock }}>{live.text + " ▋"}</ReactMarkdown></div></div>}
            </>
          )}
          {running && !live.text && !live.thinking && (
            <div className="mb-3 flex max-w-[88%] items-center gap-3 rounded-2xl border border-white/5 px-4 py-3 text-xs text-zinc-500">
              <Loader2 size={14} className="shrink-0 animate-spin text-violet-400" />
              <span>{elapsed < 8 ? "Starting Claude Code..." : `Working... ${elapsed}s`}{elapsed > 25 && !items.some(i => i.kind === "text" || i.kind === "tool") ? " - a local model reads Claude Code's long instructions first, so the first reply can take a few minutes." : ""}</span>
            </div>
          )}
        </div>
      </div>

      {/* composer */}
      <div className="shrink-0 bg-transparent px-6 pb-4 pt-2">
        <div className="mx-auto max-w-3xl">
          {smallCtx && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-300">
              <AlertTriangle size={14} className="shrink-0" />
              <span>Ollama loaded {model} with only {Math.round((loadedCtx || 0) / 1024)}k of context; Claude Code needs about 16k+ just for its instructions, so answers get cut off.</span>
              <button onClick={restartOllama} disabled={restarting} className="flex items-center gap-1.5 rounded-lg bg-amber-500/30 px-2.5 py-1 text-[11px] font-bold hover:bg-amber-500/40 disabled:opacity-50">{restarting ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}{restarting ? "Restarting Ollama..." : "Restart Ollama with a 32k window"}</button>
              <span className="text-amber-300/70">or by hand:</span>
              <button onClick={() => copyCmd("setx OLLAMA_CONTEXT_LENGTH 32768")} className="flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-2.5 py-1 font-mono text-[11px] hover:bg-amber-500/30">{copied ? <Check size={11} /> : <Copy size={11} />}setx OLLAMA_CONTEXT_LENGTH 32768</button>
            </div>
          )}
          {prefs.showQuick && <QuickBar cwd={session.cwd} known={session.init?.slashCommands || []} mcp={session.init?.mcpServers || []} draft={input} onInsert={insert} />}
          <div onDragOver={e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={e => { e.preventDefault(); dropFiles(e.dataTransfer.files); }}
            className={cn("relative rounded-2xl border bg-white/[0.04] shadow-xl shadow-black/30 transition-all focus-within:border-white/20 focus-within:bg-white/[0.06]", dragging ? "border-dashed border-violet-400" : "border-white/10")}>
            {dragging && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-violet-600/15 text-xs font-medium text-violet-100">Drop to add the file to the session folder and mention it</div>}
            <textarea
              ref={inputRef} value={input} onChange={e => setInput(e.target.value)} rows={1}
              onKeyDown={e => { if (e.key === "Enter" && (settings.enterToSend ? !e.shiftKey : (e.ctrlKey || e.metaKey))) { e.preventDefault(); send(); } }}
              placeholder={running ? "Claude is working..." : dictation.listening ? "Listening..." : "Type / for commands"}
              className="block max-h-48 min-h-[48px] w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] text-white placeholder:text-zinc-500 focus:outline-none"
              style={{ height: Math.min(192, 30 + input.split("\n").length * 22) }}
            />
            <div className="flex items-center gap-1 px-2 pb-2">
              <input ref={filePicker} type="file" multiple className="hidden" onChange={e => { dropFiles(e.target.files); e.target.value = ""; }} />
              <button onClick={() => filePicker.current?.click()} title="Add files (they are saved in the session folder and mentioned)" className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white"><Plus size={18} /></button>
              <button onClick={() => setPrefs({ showQuick: !prefs.showQuick })} title={prefs.showQuick ? "Hide the prompts and commands" : "Show the prompts and commands"} className={cn("flex h-8 w-8 items-center justify-center rounded-lg font-mono text-sm font-bold hover:bg-white/5", prefs.showQuick ? "text-violet-400" : "text-zinc-500 hover:text-white")}>/</button>
              <div className="ml-auto flex items-center gap-1">
                {dictation.supported && <button onClick={dictation.toggle} title="Speak your message" className={cn("flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/5", dictation.listening ? "text-rose-400" : "text-zinc-400 hover:text-white")}>{dictation.transcribing ? <Loader2 size={16} className="animate-spin" /> : <Mic size={17} />}</button>}
                {running ? (
                  <button onClick={stop} title="Stop" className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600/80 text-white hover:bg-red-500"><Square size={14} className="fill-current" /></button>
                ) : (
                  <button onClick={() => send()} disabled={!canSend} title="Send" className={cn("flex h-8 w-8 items-center justify-center rounded-lg transition-all", canSend ? "bg-violet-600 text-white hover:bg-violet-500" : "cursor-not-allowed text-zinc-600")}><Send size={15} /></button>
                )}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 px-1 text-xs text-zinc-400">
            <select value={prefs.permission} onChange={e => choosePermission(e.target.value)} title={PERMISSIONS.find(p => p.id === prefs.permission)?.note} className="rounded-lg bg-transparent px-1 py-1 hover:bg-white/5 focus:outline-none [&_*]:bg-zinc-900">
              {PERMISSIONS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <div className="flex items-center gap-2">
              {picker}
              <span title={ctxMax ? `Context: ${(session.ctxTokens || 0).toLocaleString()} of ${ctxMax.toLocaleString()} tokens` : "Context: not known yet"} className="relative h-5 w-5">
                <svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={2.5} /><circle cx="10" cy="10" r="8" fill="none" stroke={ctxPct !== null && ctxPct > 85 ? "#fb7185" : ctxPct !== null && ctxPct > 60 ? "#fbbf24" : "#a78bfa"} strokeWidth={2.5} strokeLinecap="round" strokeDasharray={50.27} strokeDashoffset={50.27 * (1 - (ctxPct ?? 0) / 100)} /></svg>
              </span>
            </div>
          </div>
        </div>
      </div>
      </div>
      {prefs.rightPane && (
        <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-white/5 p-3 lg:flex">
          <div className={card}>
            <p className="mb-2 text-[13px] font-medium text-zinc-200">Environment</p>
            <div className="space-y-2 text-[13px] text-zinc-300">
              <p className="flex items-center gap-2"><Bot size={14} className="shrink-0 text-zinc-500" />Claude Code {status.claude.version.split(" ")[0]}</p>
              <button onClick={chooseFolder} title={session.cwd} className="flex w-full items-center gap-2 text-left hover:text-white"><FolderOpen size={14} className="shrink-0 text-zinc-500" /><span className="truncate">{session.cwd.split(/[\\/]/).filter(Boolean).pop()}</span><span className="truncate text-[11px] text-zinc-600">{session.cwd}</span></button>
              {git?.repo && <p className="flex items-center gap-2"><GitBranch size={14} className="shrink-0 text-zinc-500" />{git.branch}</p>}
              {prefs.addDirs.map(d => <p key={d} className="flex items-center gap-2 text-zinc-400"><FolderOpen size={14} className="shrink-0 text-zinc-600" /><span className="truncate" title={d}>{d.split(/[\\/]/).pop()}</span></p>)}
              <p className="flex items-center gap-2"><span className={cn("ml-1 h-2 w-2 shrink-0 rounded-full", status.ollama.running ? "bg-emerald-500" : "bg-rose-500")} /><span className="ml-1">{status.ollama.running ? `Ollama ${status.ollama.version}` : "Ollama is off"}</span></p>
            </div>
          </div>
          <div className={card}>
            <div className="flex items-center justify-between text-[13px]"><span className="font-medium text-zinc-200">Context</span><span className="text-zinc-400">{ctxPct !== null ? `${Math.round(ctxPct)}%` : session.ctxTokens ? `${Math.round(session.ctxTokens / 100) / 10}k` : "-"}</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className={cn("h-full rounded-full transition-all", ctxPct !== null && ctxPct > 85 ? "bg-rose-400" : ctxPct !== null && ctxPct > 60 ? "bg-amber-400" : "bg-violet-400")} style={{ width: `${ctxPct ?? 0}%` }} /></div>
            <p className="mt-1.5 text-[11px] text-zinc-500">{(session.ctxTokens || 0).toLocaleString()} tokens{ctxMax ? ` of ${ctxMax.toLocaleString()}` : ""}. Type /compact when it fills up.</p>
          </div>
          <div className={card}>
            <p className="mb-1 text-[13px] font-medium text-zinc-200">This session</p>
            <StatusRings s={{ ctxTokens: session.ctxTokens || 0, ctxMax, model, permission: PERMISSIONS.find(p => p.id === prefs.permission)?.label || "", folder: session.cwd, filesChanged: files.length, tools: session.items.filter(i => i.kind === "tool").length, turns: lastResult?.kind === "result" ? lastResult.turns : 0, running, elapsed, lastMs: lastResult?.kind === "result" ? lastResult.ms : 0 }} />
          </div>
          <div className={card}>
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-medium text-zinc-200">Changes</span>
              {git?.repo && <span className="text-[12px]"><span className="text-emerald-400">+{(git.added || 0).toLocaleString()}</span> <span className="text-rose-400">-{(git.removed || 0).toLocaleString()}</span>{git.untracked ? <span className="text-zinc-500"> +{git.untracked} new</span> : null}</span>}
            </div>
            {files.length === 0 ? <p className="mt-1.5 text-[11px] text-zinc-500">Claude has not changed any file in this session.</p> : (
              <div className="mt-2 space-y-1 text-xs">
                {files.map(f => (
                  <div key={f.path} className="flex items-center gap-2">
                    <span className={cn("min-w-0 flex-1 truncate font-mono text-[11px]", f.undone ? "text-zinc-600 line-through" : "text-zinc-300")} title={f.path}>{f.path.split(/[\\/]/).pop()}</span>
                    <span className="text-[10px] text-zinc-500">{f.undone ? "put back" : f.before === null && !f.big ? "new" : f.big ? "large" : "edited"}</span>
                    {!f.undone && !f.big && <button onClick={() => undoFiles([f.path])} disabled={running} className="rounded px-1.5 py-0.5 text-[10px] text-violet-300 hover:bg-white/10 disabled:opacity-40">Undo</button>}
                  </div>
                ))}
                {files.some(f => !f.undone && !f.big) && <button onClick={() => undoFiles(files.filter(f => !f.undone && !f.big).map(f => f.path))} disabled={running} className="mt-1 flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[11px] hover:bg-white/10 disabled:opacity-40"><Undo2 size={12} />Undo all</button>}
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
