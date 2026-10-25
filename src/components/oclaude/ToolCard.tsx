import React from "react";
import { Bot, Check, ChevronDown, FileText, Globe, ListChecks, Loader2, Pencil, Search, Terminal, Wrench, X } from "lucide-react";
import type { Item } from "./events";

type Tool = Extract<Item, { kind: "tool" }>;

const ICONS: Record<string, React.ReactNode> = {
  Bash: <Terminal size={14} />, Read: <FileText size={14} />, Write: <Pencil size={14} />, Edit: <Pencil size={14} />, MultiEdit: <Pencil size={14} />, NotebookEdit: <Pencil size={14} />,
  Grep: <Search size={14} />, Glob: <Search size={14} />, WebFetch: <Globe size={14} />, WebSearch: <Globe size={14} />, Task: <Bot size={14} />, Agent: <Bot size={14} />, TodoWrite: <ListChecks size={14} />,
};

/** The one line that says what a tool call is doing. */
export function summarize(name: string, input: any): string {
  if (!input || typeof input !== "object") return "";
  const pick = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.prompt;
  if (typeof pick === "string") return pick.replace(/\s+/g, " ").slice(0, 140);
  const first = Object.values(input).find(v => typeof v === "string") as string | undefined;
  return (first || "").replace(/\s+/g, " ").slice(0, 140);
}

function Lines({ text, tone }: { text: string; tone: "add" | "del" }) {
  return <pre className={`whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-[11px] leading-relaxed ${tone === "add" ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"}`}>{text.slice(0, 1500)}</pre>;
}

/** Several tool calls in a row, folded into one line ("Ran 3 commands"); a click shows each of them. */
export function ToolGroup({ tools }: { tools: Tool[] }) {
  const [open, setOpen] = React.useState(false);
  if (tools.length === 1) return <ToolCard tool={tools[0]} />;
  const running = tools.some(t => t.status === "running"), failed = tools.filter(t => t.status === "error").length;
  const label = tools.every(t => t.name === "Bash") ? `Ran ${tools.length} commands` : tools.every(t => /^(Read|Grep|Glob|LS)$/.test(t.name)) ? `Looked at ${tools.length} files` : `Used ${tools.length} tools`;
  return (
    <div className="my-1.5">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 py-1 text-sm text-zinc-400 transition-colors hover:text-zinc-200">
        {label}{failed ? <span className="text-rose-400">, {failed} failed</span> : null}
        {running && <Loader2 size={12} className="animate-spin text-amber-400" />}
        <ChevronDown size={13} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div className="ml-1.5 border-l border-white/10 pl-3">{tools.map(t => <ToolCard key={t.id} tool={t} />)}</div>}
    </div>
  );
}

/** One tool call: a collapsed line while it runs and when it is done, with the details a click away. */
export function ToolCard({ tool }: { tool: Tool }) {
  const [open, setOpen] = React.useState(false);
  const inp = tool.input || {};
  const body = (() => {
    if (tool.name === "Edit" && typeof inp.old_string === "string") return <div className="space-y-1.5"><Lines text={inp.old_string} tone="del" /><Lines text={inp.new_string ?? ""} tone="add" /></div>;
    if (tool.name === "Write" && typeof inp.content === "string") return <Lines text={inp.content.split("\n").slice(0, 24).join("\n")} tone="add" />;
    if (tool.name === "TodoWrite" && Array.isArray(inp.todos)) return <ul className="space-y-1 text-xs">{inp.todos.map((t: any, i: number) => <li key={i} className="flex items-center gap-2"><span className={t.status === "completed" ? "text-emerald-400" : t.status === "in_progress" ? "text-amber-400" : "text-zinc-600"}>{t.status === "completed" ? "✓" : t.status === "in_progress" ? "●" : "○"}</span><span className={t.status === "completed" ? "text-zinc-500 line-through" : "text-zinc-300"}>{t.content}</span></li>)}</ul>;
    return <pre className="whitespace-pre-wrap break-words rounded-lg bg-black/30 px-3 py-2 text-[11px] text-zinc-400">{JSON.stringify(inp, null, 2).slice(0, 2500)}</pre>;
  })();
  return (
    <div className="my-1.5 max-w-[88%] rounded-2xl border border-white/10 bg-white/[0.03] text-xs">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left">
        <span className="text-violet-400">{ICONS[tool.name] || <Wrench size={14} />}</span>
        <span className="font-bold text-zinc-200">{tool.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-500">{summarize(tool.name, inp)}</span>
        {tool.status === "running" ? <Loader2 size={13} className="animate-spin text-amber-400" /> : tool.status === "error" ? <X size={13} className="text-rose-400" /> : <Check size={13} className="text-emerald-400" />}
        <ChevronDown size={13} className={`text-zinc-600 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-white/5 px-3.5 py-3">
          {body}
          {tool.result !== undefined && (
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-zinc-600">{tool.status === "error" ? "Failed" : "Result"}</p>
              <pre className={`max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 px-3 py-2 text-[11px] ${tool.status === "error" ? "text-rose-300" : "text-zinc-400"}`}>{tool.result || "(empty)"}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
