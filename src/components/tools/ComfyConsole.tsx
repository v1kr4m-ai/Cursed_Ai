import React from "react";
import { Copy, Pause, Play, Trash2 } from "lucide-react";
import { appendChunks, emptyLines, toneOf, type ComfyLines, type Tone } from "./comfyLines";

const TONE: Record<Tone, string> = { error: "text-red-400", warn: "text-yellow-400", run: "text-cyan-300", progress: "text-emerald-300", plain: "text-zinc-300" };

/** ComfyUI's own console (model loading, prompts, progress bars, errors), followed live. */
export function ComfyConsole() {
  const [state, setState] = React.useState<ComfyLines>(emptyLines);
  const [up, setUp] = React.useState<boolean | null>(null);
  const [supported, setSupported] = React.useState(true);
  const [paused, setPaused] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const since = React.useRef("");
  const pausedRef = React.useRef(false);
  const held = React.useRef<ComfyLines | null>(null);
  const bottom = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { pausedRef.current = paused; if (!paused && held.current) { setState(held.current); held.current = null; } }, [paused]);

  React.useEffect(() => {
    let stop = false;
    let live: ComfyLines = emptyLines();
    const tick = async () => {
      try {
        const r = await fetch(`/api/comfyui/logs?since=${encodeURIComponent(since.current)}`);
        const d = await r.json();
        if (stop) return;
        setUp(!!d.up); setSupported(d.supported !== false);
        if (d.restarted) live = emptyLines();
        if (d.entries?.length) {
          live = appendChunks(live, d.entries);
          since.current = d.next || since.current;
          if (pausedRef.current) held.current = live; else setState(live);
        } else if (d.next) since.current = d.next;
      } catch { if (!stop) setUp(false); }
    };
    tick();
    const timer = setInterval(tick, 1500);
    return () => { stop = true; clearInterval(timer); };
  }, []);

  React.useEffect(() => { if (!paused) bottom.current?.scrollIntoView({ block: "end" }); }, [state, paused]);

  const shown = state.partial ? [...state.lines, state.partial] : state.lines;
  const copyAll = () => navigator.clipboard?.writeText(shown.join("\n")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {});
  const btn = "glass px-3 py-2 rounded-xl border-white/5 text-zinc-400 hover:text-white transition-colors flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest";

  return (
    <div className="flex-1 glass rounded-[2rem] border-white/5 overflow-hidden flex flex-col min-h-0">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/5 px-5 py-3">
        <span className={`h-2 w-2 rounded-full ${up ? "bg-emerald-400" : up === false ? "bg-red-500" : "bg-zinc-600"}`} />
        <span className="text-xs text-zinc-400">{up ? "ComfyUI is running" : up === false ? "ComfyUI is not reachable" : "Checking ComfyUI..."}</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setPaused(p => !p)} className={btn}>{paused ? <Play size={12} /> : <Pause size={12} />}{paused ? "Resume" : "Pause"}</button>
          <button onClick={copyAll} className={btn}><Copy size={12} />{copied ? "Copied" : "Copy"}</button>
          <button onClick={() => { setState(emptyLines()); held.current = null; }} className={btn}><Trash2 size={12} />Clear</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5 font-mono text-[11px] leading-relaxed">
        {shown.length === 0 && (
          <p className="py-16 text-center text-zinc-600">
            {up === false
              ? "ComfyUI is not running. Start it (Engine tab, or its own start file) and its console appears here as soon as it is up."
              : !supported ? "This ComfyUI does not share its log. Update ComfyUI to a recent version to see it here."
              : "Nothing logged yet. Render an image or a clip and ComfyUI's messages show up here."}
          </p>
        )}
        {shown.map((l, i) => <div key={i} className={`whitespace-pre-wrap break-all ${TONE[toneOf(l)]}`}>{l || " "}</div>)}
        <div ref={bottom} />
      </div>
    </div>
  );
}
