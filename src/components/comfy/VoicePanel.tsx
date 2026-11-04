import React from "react";
import { FolderOpen, Play, Square, X } from "lucide-react";
import { api, useJob } from "../train/trainApi";
import { Badge, Card, JobConsole, TrainProgress, btn, btnDanger, btnPrimary, inputCls } from "../train/ui";

interface Status { dia: { ready: boolean; missing: string[] }; outputDir: string; results: string[]; running: boolean }

const media = (p: string) => `/api/voice/media?path=${encodeURIComponent(p)}`;
const name = (p: string) => p.split(/[\/]/).pop() || p;

/** Windows' own file window; returns the first picked path (none on a phone). */
async function pickAudio(): Promise<string> {
  try { const d = await api<{ paths?: string[] }>("/api/tool/native-pick", { mode: "files", filter: "Audio|*.wav;*.mp3;*.flac;*.m4a;*.ogg" }); return d.paths?.[0] || ""; } catch { return ""; }
}

/** Voice tab of the Audio Studio. One engine for now (Dia, local); more engines slot in beside it in ENGINES. */
const ENGINES = [{ id: "dia", label: "Dia (Local)", on: true }, { id: "cloud", label: "Cloud", on: false }, { id: "browser", label: "Browser voice", on: false }];

export function VoicePanel() {
  const [status, setStatus] = React.useState<Status | null>(null);
  const load = React.useCallback(async () => { try { setStatus(await api<Status>("/api/voice/status")); } catch { /* server restarting */ } }, []);
  React.useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  const [text, setText] = React.useState("");
  const [refAudio, setRefAudio] = React.useState("");
  const [refText, setRefText] = React.useState("");
  const [seed, setSeed] = React.useState("");
  const [cfg, setCfg] = React.useState("");
  const [temp, setTemp] = React.useState("");
  const [error, setError] = React.useState("");
  const job = useJob("dia");
  const wasRunning = React.useRef(false);
  React.useEffect(() => { if (wasRunning.current && !job.running) load(); wasRunning.current = job.running; }, [job.running, load]);

  const num = (v: string) => (v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const start = async () => {
    setError("");
    try {
      await api("/api/voice/dia/start", {
        text, referenceAudio: refAudio || undefined, referenceText: refAudio && refText.trim() ? refText : undefined,
        seed: num(seed), cfgScale: num(cfg), temperature: num(temp),
      });
    } catch (e: any) { setError(e.message); }
  };
  const ready = !!status?.dia.ready;
  const why = status && !ready ? `Missing: ${status.dia.missing.join(", ")}` : "";
  const results = (status?.results || []).slice(0, 5);

  return (
    <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem]">
      <TrainProgress jobs={[{ title: "Voice (Dia)", job }]} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-6 xl:grid-cols-2">
        <div className="space-y-4">
          <Card title="Engine" right={<Badge ok={status ? ready : null} title={why || "Dia and its environment were found"}>{status ? (ready ? "ready" : "not set up") : "checking"}</Badge>}>
            <div className="inline-flex gap-1 rounded-xl bg-white/5 p-1">
              {ENGINES.map(e => <button key={e.id} disabled={!e.on} title={e.on ? "" : "Not available yet"} className={`rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-widest ${e.on ? "bg-teal-500/20 text-teal-300" : "cursor-not-allowed text-zinc-700"}`}>{e.label}</button>)}
            </div>
          </Card>
          <Card title="Script" note="English only. Mark speakers with [S1] and [S2]; add sounds like (laughs) or (sighs).">
            <textarea value={text} onChange={e => setText(e.target.value)} rows={9} className={`${inputCls} resize-y`} placeholder={"[S1] Did you hear that? (gasps)\n[S2] Hear what? [S1] Never mind. (laughs)"} />
          </Card>
          <Card title="Copy a voice (optional)" note="A clean 5-15 s clip of one speaker, plus what is said in it.">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <button className={btn} onClick={async () => { const p = await pickAudio(); if (p) setRefAudio(p); }}><FolderOpen size={14} />Choose audio</button>
                {refAudio && <><span className="min-w-0 flex-1 truncate text-xs text-zinc-400" title={refAudio}>{name(refAudio)}</span><button onClick={() => setRefAudio("")} aria-label="Remove reference" className="text-zinc-500 hover:text-white"><X size={14} /></button></>}
              </div>
              {refAudio && <textarea value={refText} onChange={e => setRefText(e.target.value)} rows={3} className={`${inputCls} resize-y`} placeholder="[S1] The words spoken in the clip" />}
            </div>
          </Card>
          <details className="rounded-2xl border border-white/5 bg-black/20 px-4 py-3">
            <summary className="cursor-pointer text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Advanced</summary>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {([["Seed", seed, setSeed, "random"], ["CFG scale", cfg, setCfg, "default"], ["Temperature", temp, setTemp, "default"]] as const).map(([l, v, set, ph]) => (
                <label key={l} className="text-[11px] text-zinc-500">{l}<input type="number" value={v} onChange={e => set(e.target.value)} placeholder={ph} className={`${inputCls} mt-1`} /></label>
              ))}
            </div>
          </details>
          <div className="flex items-center gap-3">
            <button className={btnPrimary} disabled={!ready || job.running || !text.trim()} title={why} onClick={start}><Play size={14} />Speak</button>
            {job.running && <button className={btnDanger} onClick={job.stop}><Square size={14} />Stop</button>}
            {why && <span className="text-xs text-amber-300">{why}</span>}
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>
        <div className="flex min-h-0 flex-col gap-4">
          <Card title="Results" right={status?.outputDir && <button className={btn} onClick={() => api("/api/voice/open-folder", {}).catch(() => {})}><FolderOpen size={14} />Open folder</button>}>
            {results.length ? <div className="space-y-3">{results.map(p => <div key={p}><p className="truncate text-[10px] text-zinc-500" title={p}>{name(p)}</p><audio key={p} src={media(p)} controls className="w-full" /></div>)}</div>
              : <p className="text-xs text-zinc-500">Finished speech shows up here, newest on top.</p>}
          </Card>
          <JobConsole job={job} title="Log" idle="What Dia prints shows up here." />
        </div>
      </div>
    </div>
  );
}
