import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "motion/react";
import { AlertTriangle, Archive, Bot, Brain, Check, CheckCircle2, ChevronDown, Cloud, Copy, Cpu, Download, FolderOpen, GitFork, Loader2, MoreVertical, Plus, Send, Settings2, ShieldCheck, Square, Trash2, X } from "lucide-react";
import { AppSettings, MessageRole } from "../../types";
import { cn } from "@/lib/utils";
import { nativeFolder } from "../comfy/types";
import { notify, notifyError } from "../../lib/notify";
import { CodeBlock } from "../chat/ChatWindow";
import { ToolCard } from "./ToolCard";
import { Chip, QuickBar } from "./QuickBar";
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
interface Prefs { model: string; permission: string; userSettings: boolean; maxTurns: number; appendSystemPrompt: string; addDirs: string[]; showQuick: boolean; activeId: string }
const defaultPrefs: Prefs = { model: "", permission: "acceptEdits", userSettings: false, maxTurns: 0, appendSystemPrompt: "", addDirs: [], showQuick: true, activeId: "" };
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

  async function send(textOverride?: string, extraAllowed: string[] = []) {
    const text = (textOverride ?? input).trim();
    if (!text || running || !session) return;
    if (!status?.claude.found) { notifyError("Claude Code is not installed - see the setup card.", "ollamaclaude"); return; }
    if (!model) { notifyError("No installed model supports tool calls, so none can drive Claude Code.", "ollamaclaude"); return; }
    const id = session.id;
    const allowed = [...new Set([...session.allowed, ...extraAllowed])];
    if (!textOverride) setInput("");
    update(id, s => ({ ...s, model, allowed, title: s.items.length ? s.title : titleFrom(text), items: [...s.items, userItem(text)], updatedAt: Date.now() }));
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
          update(id, s => {
            const a = applyEvent(s.items, liveNow, ev);
            liveNow = a.live;
            return { ...s, ...a.patch, items: a.items, updatedAt: Date.now() };
          });
          setLive(liveNow);
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") update(id, s => ({ ...s, items: [...s.items, noticeItem("error", e?.message || String(e))] }));
      else update(id, s => ({ ...s, items: [...s.items, noticeItem("info", "Stopped.")] }));
    } finally {
      setRunning(false); setLive(emptyLive); abort.current = null; runId.current = "";
    }
  }
  const stop = () => {
    if (runId.current) fetch("/api/oclaude/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: runId.current }) }).catch(() => {});
    abort.current?.abort();
  };

  const allowAndRetry = (tools: string[]) => send("You now have permission to use " + tools.join(", ") + ". Please carry on with what you were doing.", tools);
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

  return (
    <div className="glass relative flex h-full flex-1 flex-col overflow-hidden rounded-[2.5rem]">
      {/* header */}
      <div className="z-10 flex h-20 shrink-0 items-center justify-between gap-4 border-b border-white/5 bg-transparent px-8 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex shrink-0 items-center gap-2">
            <div className="model-tag">Ollama_Claude</div>
            {status.claude.version && <div className="vulkan-tag" title={status.claude.path || ""}>{status.claude.version.split(" ")[0]}</div>}
          </div>
          <button onClick={chooseFolder} title={"Working folder - Claude reads and writes here\n" + session.cwd} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-white/10">
            <FolderOpen size={14} className="shrink-0 text-violet-400" /><span className="max-w-[16rem] truncate font-mono">{session.cwd}</span>
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden items-center rounded-xl border border-white/10 bg-white/5 p-0.5 md:flex" role="group" aria-label="What Claude may do">
            {PERMISSIONS.map(p => (
              <button key={p.id} onClick={() => choosePermission(p.id)} title={p.note} className={cn("rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors", prefs.permission === p.id ? (p.id === "bypassPermissions" ? "bg-rose-600 text-white" : "bg-violet-600 text-white") : "text-zinc-500 hover:text-zinc-200")}>{p.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-2" title={status.ollama.running ? `Ollama ${status.ollama.version} is running` : "Ollama is not running"}>
            <div className={cn("h-2 w-2 rounded-full", status.ollama.running ? "bg-emerald-500 shadow-[0_0_10px_#10b981]" : "bg-rose-500")} />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">{status.ollama.running ? "Ollama online" : "Ollama off"}</span>
          </div>
          <div className="mx-1 h-6 w-[1px] bg-white/5" />
          <button onClick={() => setSetupOpen(v => !v)} title="Session settings" className={cn("p-2 transition-colors", setupOpen ? "text-violet-400" : "text-zinc-500 hover:text-white")}><Settings2 size={18} /></button>
          <div className="relative">
            <button onClick={() => setSessionsOpen(v => !v)} title="Sessions" className="p-2 text-zinc-500 transition-colors hover:text-white"><Archive size={18} /></button>
            {sessionsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSessionsOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-2 max-h-96 w-80 overflow-y-auto rounded-2xl border border-white/15 bg-zinc-950 py-1 shadow-2xl shadow-black/60">
                  <button onClick={() => startNew()} className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-violet-300 hover:bg-white/5"><Plus size={15} />New session</button>
                  {sessions.map(s => (
                    <div key={s.id} className={cn("group flex items-center gap-2 px-4 py-2 hover:bg-white/5", s.id === session.id && "bg-white/[0.04]")}>
                      <button onClick={() => { setPrefs({ activeId: s.id }); setSessionsOpen(false); }} className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm text-zinc-200">{s.title}</p>
                        <p className="truncate text-[10px] text-zinc-600">{s.model || "no model"} - {ago(s.updatedAt)} - {s.cwd.split(/[\\/]/).pop()}</p>
                      </button>
                      <button onClick={() => removeSession(s.id)} title="Delete" className="hidden text-zinc-600 hover:text-rose-400 group-hover:block"><Trash2 size={13} /></button>
                    </div>
                  ))}
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
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto flex max-w-4xl flex-col pb-12">
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
              <p className="mt-8 max-w-md text-[11px] leading-relaxed text-zinc-600">Pick the folder to work in (top left), choose what Claude may do (Plan / Edit / Full), then ask. The ready prompts below the box are a good start.</p>
            </div>
          )}

          {items.map((it, idx) => {
            switch (it.kind) {
              case "user": return <motion.div key={it.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="chat-bubble user-bubble whitespace-pre-wrap">{it.text}</motion.div>;
              case "text": return (
                <motion.div key={it.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="chat-bubble ai-bubble">
                  <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock }}>{it.text}</ReactMarkdown></div>
                </motion.div>
              );
              case "thinking": return (
                <details key={it.id} className="mb-3 max-w-[80%] rounded-2xl border border-white/5 px-4 py-2 text-xs text-zinc-500">
                  <summary className="flex cursor-pointer items-center gap-2 select-none"><Brain size={13} className="text-violet-400" />Thinking</summary>
                  <p className="mt-2 whitespace-pre-wrap italic leading-relaxed">{it.text}</p>
                </details>
              );
              case "tool": return <ToolCard key={it.id} tool={it} />;
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
              {live.text && <div className="chat-bubble ai-bubble"><div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock }}>{live.text + " ▋"}</ReactMarkdown></div></div>}
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
      <div className="shrink-0 border-t border-white/5 bg-transparent p-6">
        <div className="mx-auto max-w-4xl">
          {smallCtx && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-300">
              <AlertTriangle size={14} className="shrink-0" />
              <span>Ollama loaded {model} with only {Math.round((loadedCtx || 0) / 1024)}k of context; Claude Code needs about 16k+ just for its instructions, so answers get cut off. Restart Ollama with a bigger window:</span>
              <button onClick={() => copyCmd("setx OLLAMA_CONTEXT_LENGTH 32768")} className="flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-2.5 py-1 font-mono text-[11px] hover:bg-amber-500/30">{copied ? <Check size={11} /> : <Copy size={11} />}setx OLLAMA_CONTEXT_LENGTH 32768</button>
            </div>
          )}
          {prefs.showQuick && <QuickBar cwd={session.cwd} known={session.init?.slashCommands || []} mcp={session.init?.mcpServers || []} draft={input} onInsert={insert} />}
          <div className="flex items-end gap-1.5 rounded-2xl border border-white/10 bg-white/5 p-1.5 shadow-xl shadow-black/40 transition-all duration-300 ease-out focus-within:border-violet-500/40 focus-within:bg-white/[0.07] focus-within:shadow-[0_0_28px_-6px_rgba(139,92,246,0.45)]">
            <div className="mb-0.5 ml-0.5 flex shrink-0 gap-0.5">
              {picker}
              <button onClick={() => setPrefs({ showQuick: !prefs.showQuick })} title={prefs.showQuick ? "Hide the prompts and commands" : "Show the prompts and commands"} className={cn("flex h-9 w-9 items-center justify-center rounded-xl transition-all hover:bg-white/5", prefs.showQuick ? "text-violet-400" : "text-zinc-500 hover:text-white")}><Brain size={17} className="hidden" /><span className="font-mono text-base font-bold">/</span></button>
            </div>
            <div className="min-w-0 flex-1">
              <textarea
                ref={inputRef} value={input} onChange={e => setInput(e.target.value)} rows={1}
                onKeyDown={e => { if (e.key === "Enter" && (settings.enterToSend ? !e.shiftKey : (e.ctrlKey || e.metaKey))) { e.preventDefault(); send(); } }}
                placeholder={running ? "Claude is working..." : lastResult ? "Ask a follow-up, or give the next task..." : `Ask Claude Code to work in ${session.cwd.split(/[\\/]/).pop()}...`}
                className="max-h-40 min-h-[44px] w-full resize-none bg-transparent px-3 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none"
                style={{ height: Math.min(160, 24 + input.split("\n").length * 22) }}
              />
            </div>
            {running ? (
              <button onClick={stop} title="Stop" className="mb-0.5 mr-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-red-600/80 text-white transition-all hover:bg-red-500"><Square size={15} className="fill-current" /></button>
            ) : (
              <button onClick={() => send()} disabled={!canSend} title="Send" className={cn("mb-0.5 mr-0.5 flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200", canSend ? "bg-violet-600 text-white shadow-lg shadow-violet-900/30 hover:scale-105 hover:bg-violet-500 active:scale-95" : "cursor-not-allowed bg-white/5 text-zinc-600")}><Send size={16} className={canSend ? "translate-x-px" : ""} /></button>
            )}
          </div>
          <p className="mt-2 px-1 text-[10px] text-zinc-600">{PERMISSIONS.find(p => p.id === prefs.permission)?.note} {modelInfo?.cloud ? "This model runs in Ollama's cloud, so it needs internet." : ""}</p>
        </div>
      </div>
    </div>
  );
}
