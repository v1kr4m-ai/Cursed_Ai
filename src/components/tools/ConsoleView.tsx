import React from "react";
import { Terminal, Trash2, Pause, Play } from "lucide-react";
import { LogLine } from "../../types";
import { ComfyConsole } from "./ComfyConsole";
import { setPipped, usePipped } from "./consolePip";

const LEVEL_COLOR: Record<string, string> = {
  log: "text-zinc-400",
  info: "text-cyan-400",
  warn: "text-yellow-400",
  error: "text-red-400",
};

export function ConsoleView() {
  const pipped = usePipped();
  const [lines, setLines] = React.useState<LogLine[]>([]);
  const [paused, setPaused] = React.useState(false);
  const [source, setSource] = React.useState<"app" | "comfy">("app");
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const linesRef = React.useRef<LogLine[]>([]);

  React.useEffect(() => {
    let cancelled = false;

    fetch("/api/console/history")
      .then(r => r.json())
      .then((history: LogLine[]) => {
        if (cancelled) return;
        linesRef.current = history;
        setLines(history);
      })
      .catch(e => console.error("Failed to load console history", e));

    const es = new EventSource("/api/console/stream");
    es.onmessage = (event) => {
      const entry: LogLine = JSON.parse(event.data);
      linesRef.current = [...linesRef.current, entry].slice(-500);
      if (!pausedRef.current) setLines(linesRef.current);
    };
    return () => {
      cancelled = true;
      es.close();
    };
  }, []);

  // Keep a ref in sync with `paused` so the SSE handler above (registered
  // once) reads live state instead of a stale closure.
  const pausedRef = React.useRef(paused);
  React.useEffect(() => { pausedRef.current = paused; }, [paused]);
  React.useEffect(() => {
    if (!paused) setLines(linesRef.current);
  }, [paused]);

  React.useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, paused]);

  return (
    <div className="flex-1 bg-transparent p-6 h-full overflow-hidden">
      <div className="max-w-5xl mx-auto h-full flex flex-col">
        <header className="mb-8 mt-6 shrink-0 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-white mb-2 tracking-tighter flex items-center gap-4">
              <Terminal className="text-emerald-500" size={32} />
              Console
            </h1>
            <p className="text-zinc-500 text-sm font-medium uppercase tracking-[0.2em]">{source === "app" ? "Live server log • Real, not simulated" : "ComfyUI's own console • Live"}</p>
            <div className="mt-4 flex gap-1.5">
              {([["app", "App"], ["comfy", "ComfyUI"]] as const).map(([id, label]) => (
                <button key={id} onClick={() => setSource(id)} className={`rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${source === id ? "bg-violet-600 text-white" : "bg-white/5 text-zinc-400 hover:bg-white/10"}`}>{label}</button>
              ))}
            </div>
          </div>
          <div className={source === "app" ? "flex gap-3" : "hidden"}>
            <button
              onClick={() => setPaused(p => !p)}
              className="glass px-4 py-2.5 rounded-xl border-white/5 text-zinc-400 hover:text-white transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-widest"
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={() => { linesRef.current = []; setLines([]); }}
              className="glass px-4 py-2.5 rounded-xl border-white/5 text-zinc-400 hover:text-red-400 transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-widest"
            >
              <Trash2 size={14} /> Clear
            </button>
          </div>
        </header>

        {source === "comfy" && (pipped
          ? (
            <div className="flex-1 glass rounded-[2rem] border-white/5 grid place-items-center text-center p-8">
              <div className="space-y-3">
                <p className="text-sm text-zinc-300">ComfyUI's console is floating over the app.</p>
                <button onClick={() => setPipped(false)} className="glass px-4 py-2.5 rounded-xl border-white/5 text-zinc-300 hover:text-white text-xs font-bold uppercase tracking-widest">Bring it back here</button>
              </div>
            </div>
          )
          : <ComfyConsole />)}
        <div className={source === "app" ? "flex-1 glass rounded-[2rem] border-white/5 overflow-hidden flex flex-col" : "hidden"}>
          <div className="flex-1 overflow-y-auto p-6 font-mono text-xs space-y-1.5">
            {lines.length === 0 && (
              <p className="text-zinc-600 text-center py-20">No log lines yet — do something (send a chat message, load a model) and it'll show up here.</p>
            )}
            {lines.map((line) => (
              <div key={line.id} className="flex gap-3 leading-relaxed">
                <span className="text-zinc-700 shrink-0">{new Date(line.timestamp).toLocaleTimeString()}</span>
                <span className={`shrink-0 uppercase font-bold ${LEVEL_COLOR[line.level] || "text-zinc-400"}`}>[{line.level}]</span>
                <span className="text-zinc-300 whitespace-pre-wrap break-all">{line.message}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
