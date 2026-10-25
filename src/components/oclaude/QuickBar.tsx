import React from "react";
import { ChevronDown, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";

export interface ReadyPrompt { label: string; text: string; group: string }

/** Ready-made requests: click one and it lands in the message box. */
export const READY_PROMPTS: ReadyPrompt[] = [
  { group: "Explore", label: "Explain this project", text: "Look around this folder and explain what the project is, how it is organised and how to run it." },
  { group: "Explore", label: "Show the structure", text: "List the folder structure two levels deep and say what each part is for." },
  { group: "Explore", label: "Find where...", text: "Find where in this code the following happens, and explain how it works: " },
  { group: "Git", label: "git status + summary", text: "Run git status and git diff --stat, then summarise what has changed in plain words." },
  { group: "Git", label: "Review my changes", text: "Review the uncommitted changes for bugs, mistakes and anything risky. Be specific and cite files and lines." },
  { group: "Git", label: "Write a commit message", text: "Look at the staged changes and write a clear commit message for them (do not commit)." },
  { group: "Git", label: "Recent history", text: "Show the last 10 commits and summarise the direction the project has been moving in." },
  { group: "Build", label: "Run the tests", text: "Run the project's tests. If any fail, find the cause and fix it, then run them again." },
  { group: "Build", label: "Lint and fix", text: "Run the linter or type-checker and fix every problem it reports." },
  { group: "Build", label: "Build it", text: "Build the project and fix any errors until it builds cleanly." },
  { group: "Write", label: "Write tests for...", text: "Write tests for the following, using the project's existing test setup: " },
  { group: "Write", label: "Add a README", text: "Write a README.md for this project: what it is, how to install and run it, and how it is laid out." },
  { group: "Write", label: "Explain this file", text: "Explain what this file does, section by section: " },
  { group: "Fix", label: "Fix this error", text: "I get this error. Find the cause and fix it:\n\n" },
  { group: "Fix", label: "Find bugs", text: "Read through the main code and list real bugs or edge cases that would break, with a suggested fix for each." },
  { group: "Fix", label: "Speed it up", text: "Find the slowest or most wasteful part of this code and suggest, then make, the smallest change that improves it." },
  { group: "Safety", label: "Security check", text: "Review this project for security problems (secrets in code, injection, unsafe file or shell use) and list what you find." },
  { group: "Safety", label: "Dependency check", text: "List the dependencies, note any that look outdated or unused, and say what could be removed." },
];

/** Commands this app answers itself; the rest go to Claude Code. */
export const APP_COMMANDS: { name: string; args?: string; note: string }[] = [
  { name: "help", note: "list these commands" },
  { name: "resume", args: "[number or title]", note: "go back to an earlier session" },
  { name: "rename", args: "<name>", note: "rename this session" },
  { name: "model", args: "[name]", note: "show or change the model" },
  { name: "permissions", args: "[plan|edit|full]", note: "show or change what Claude may do" },
  { name: "status", note: "model, folder, permission and session" },
  { name: "clear", note: "start a new session in the same folder" },
  { name: "fork", note: "branch the conversation from here" },
  { name: "folder", note: "choose the working folder" },
  { name: "add-dir", note: "let Claude work in one more folder" },
  { name: "export", note: "save the session as Markdown" },
  { name: "delete", note: "delete this session" },
];

type Tab = "prompts" | "commands" | "skills" | "mcp";
const FOLD_KEY = "cursed.oclaude.quickFolded";
const MINE_KEY = "cursed.oclaude.myprompts";
const loadMine = (): ReadyPrompt[] => { try { const v = JSON.parse(localStorage.getItem(MINE_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };

interface Props {
  cwd: string;
  /** Names Claude Code reported for this session (slash commands and skills together). */
  known: string[];
  mcp: { name: string; status: string }[];
  draft: string;
  onInsert: (text: string, replace?: boolean) => void;
}

/** The strip above the message box: prompts, slash commands, skills and MCP servers, one click each. */
export function QuickBar({ cwd, known, mcp, draft, onInsert }: Props) {
  const [tab, setTab] = React.useState<Tab>("prompts");
  const [q, setQ] = React.useState("");
  const [scanned, setScanned] = React.useState<{ commands: string[]; skills: string[] }>({ commands: [], skills: [] });
  const [mcpList, setMcpList] = React.useState<{ name: string; target: string; status: string }[] | null>(null);
  const [loadingMcp, setLoadingMcp] = React.useState(false);
  const [mine, setMine] = React.useState<ReadyPrompt[]>(loadMine);
  const [folded, setFolded] = React.useState(() => { try { return localStorage.getItem(FOLD_KEY) === "1"; } catch { return false; } });
  const fold = (v: boolean) => { setFolded(v); try { v ? localStorage.setItem(FOLD_KEY, "1") : localStorage.removeItem(FOLD_KEY); } catch { /* storage blocked */ } };

  React.useEffect(() => { fetch("/api/oclaude/commands?cwd=" + encodeURIComponent(cwd)).then(r => r.json()).then(setScanned).catch(() => {}); }, [cwd]);
  const refreshMcp = async () => {
    setLoadingMcp(true);
    try { setMcpList((await (await fetch("/api/oclaude/mcp?cwd=" + encodeURIComponent(cwd))).json()).servers || []); } catch { setMcpList([]); } finally { setLoadingMcp(false); }
  };
  React.useEffect(() => { if (tab === "mcp" && mcpList === null) refreshMcp(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMine = (list: ReadyPrompt[]) => { setMine(list); try { localStorage.setItem(MINE_KEY, JSON.stringify(list)); } catch { /* storage blocked */ } };
  const addMine = () => {
    const text = draft.trim();
    if (!text) return;
    saveMine([...mine, { group: "Mine", label: text.replace(/\s+/g, " ").slice(0, 28), text }]);
  };

  const names = [...new Set([...known, ...scanned.commands, ...scanned.skills])];
  const builtin = ["compact", "init", "review", "security-review", "cost", "context", "memory", "pr-comments", "agents", "hooks", "doctor"].filter(c => !names.includes(c) && !APP_COMMANDS.some(a => a.name === c));
  const appCmds = APP_COMMANDS.filter(c => match(c.name + c.note));
  const match = (s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase());
  const slash = [...names.filter(n => !scanned.skills.includes(n) || !known.length), ...builtin].filter(match);
  const skillNames = [...new Set([...scanned.skills, ...known.filter(n => n.includes(":"))])].filter(match);
  const prompts = [...mine, ...READY_PROMPTS].filter(p => match(p.label + p.group));

  const chip = "rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-zinc-400 hover:border-violet-500/40 hover:text-white transition-colors";
  return (
    <div className="mb-2 rounded-2xl border border-white/5 bg-white/[0.02] p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <button onClick={() => fold(!folded)} title={folded ? "Show" : "Fold away"} className="rounded-md p-1 text-zinc-500 hover:text-white"><ChevronDown size={13} className={`transition-transform ${folded ? "-rotate-90" : ""}`} /></button>
        {([["prompts", "Ready prompts"], ["commands", "Commands"], ["skills", "Skills"], ["mcp", "MCP"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => { setTab(id); fold(false); }} className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-widest transition-colors ${tab === id ? "bg-violet-600 text-white" : "bg-white/5 text-zinc-500 hover:bg-white/10"}`}>{label}</button>
        ))}
        <div className="relative ml-auto">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter" className="h-7 w-32 rounded-lg border border-white/5 bg-white/5 pl-7 pr-2 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-white/20 focus:outline-none" />
        </div>
      </div>
      {!folded && <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
        {tab === "prompts" && (
          <>
            {prompts.map((p, i) => (
              <span key={p.group + p.label + i} className="group/p relative">
                <button onClick={() => onInsert(p.text, true)} title={p.text} className={chip}><span className="mr-1.5 text-[9px] uppercase tracking-widest text-violet-400/70">{p.group}</span>{p.label}</button>
                {p.group === "Mine" && <button onClick={() => saveMine(mine.filter(m => m !== p))} title="Remove" className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:text-rose-400 group-hover/p:flex"><Trash2 size={9} /></button>}
              </span>
            ))}
            <button onClick={addMine} disabled={!draft.trim()} title="Save what is in the message box as a ready prompt" className={`${chip} flex items-center gap-1 disabled:opacity-40`}><Plus size={11} />Save the message box</button>
          </>
        )}
        {tab === "commands" && (
          <>
            {appCmds.map(c => <button key={"app-" + c.name} onClick={() => onInsert("/" + c.name + " ", true)} title={`${c.note}${c.args ? ` - /${c.name} ${c.args}` : ""} (handled by this app)`} className={chip + " border-violet-500/25 text-violet-200/90"}>/{c.name}</button>)}
            {slash.map(c => <button key={c} onClick={() => onInsert("/" + c + " ")} title="Sent to Claude Code" className={chip}>/{c}</button>)}
          </>
        )}
        {tab === "skills" && (skillNames.length ? skillNames.map(c => <button key={c} onClick={() => onInsert("/" + c + " ")} className={chip}>{c}</button>) : <span className="text-[11px] text-zinc-600">No skills found in your .claude folders.</span>)}
        {tab === "mcp" && (
          <>
            {(mcpList ?? []).map(m => <button key={m.name} onClick={() => onInsert(`Use the ${m.name} MCP server to `)} title={m.target} className={chip}><span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${/connected|ok|✓/i.test(m.status) ? "bg-emerald-500" : "bg-zinc-600"}`} />{m.name}</button>)}
            {mcp.filter(m => !(mcpList ?? []).some(x => x.name === m.name)).map(m => <button key={m.name} onClick={() => onInsert(`Use the ${m.name} MCP server to `)} className={chip}>{m.name}</button>)}
            {mcpList !== null && !mcpList.length && !mcp.length && <span className="text-[11px] text-zinc-600">No MCP servers set up (claude mcp add ...).</span>}
            <button onClick={refreshMcp} disabled={loadingMcp} className={`${chip} flex items-center gap-1`}><RefreshCw size={11} className={loadingMcp ? "animate-spin" : ""} />{loadingMcp ? "Checking..." : "Refresh"}</button>
          </>
        )}
      </div>}
    </div>
  );
}

/** Small removable chip, used for the allowed tools and extra folders. */
export function Chip({ children, onRemove }: { children: React.ReactNode; onRemove?: () => void }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-zinc-300">{children}{onRemove && <button onClick={onRemove} className="text-zinc-500 hover:text-rose-400"><X size={11} /></button>}</span>;
}
