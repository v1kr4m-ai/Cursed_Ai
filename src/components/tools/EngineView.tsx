import React from "react";
import { Activity, BatteryFull, BatteryLow, BatteryMedium, Cpu, Database, Gauge, HardDrive, Layers, MemoryStick, Power, RotateCcw, Timer, Zap } from "lucide-react";
import { notify, notifyError } from "../../lib/notify";

interface EngineSettings { gpuLayers: "auto" | "max" | number; flashAttention: boolean; batchSize: number | null; useMmap: boolean; useMlock: boolean; keepAliveMinutes: number; threads: number | null; contextSize: number | null; preloadModel: boolean; autoStartComfy: boolean; comfyUrl: string | null; lastModel: string | null }
interface EngineInfo {
  settings: EngineSettings;
  comfyUrl?: string;
  defaults: { threads: number; batchSize: number };
  hardware: { cores: number; ramGb: number; gpu: string | null; gpuNames: string[] };
  model: { name: string | null; gpuLayers: number; flashAttentionSupported: boolean; contextSize: number | null } | null;
}

const PROFILES = [
  { id: "BATTERY_SAVER", label: "Efficient", icon: BatteryLow, tone: "text-emerald-400", ring: "ring-emerald-500/40", note: "Few threads, small batches. Quiet and cool, slower replies." },
  { id: "BALANCED", label: "Balanced", icon: BatteryMedium, tone: "text-cyan-400", ring: "ring-cyan-500/40", note: "A sensible middle for everyday chat." },
  { id: "PERFORMANCE", label: "Brute", icon: BatteryFull, tone: "text-violet-400", ring: "ring-violet-500/40", note: "All the threads and big batches. Fastest, uses the most power." },
] as const;

const card = "glass rounded-[1.75rem] border-white/5 p-6";
const heading = "text-[10px] font-black text-zinc-500 uppercase tracking-[0.25em] flex items-center gap-2.5 mb-5";

/** A row of mutually exclusive choices. */
function Chips<T extends string | number | null>({ value, options, onChange, disabled }: { value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button key={String(o.value)} disabled={disabled} onClick={() => onChange(o.value)} title={o.hint}
          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-40 ${value === o.value ? "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40" : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"}`}>{o.label}</button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, title, note, disabled }: { on: boolean; onChange: (v: boolean) => void; title: string; note: string; disabled?: boolean }) {
  return (
    <button disabled={disabled} onClick={() => onChange(!on)} className="w-full flex items-center gap-4 text-left py-2.5 disabled:opacity-40 group">
      <span className="flex-1 min-w-0"><span className="block text-[13px] font-semibold text-zinc-200">{title}</span><span className="block text-[11px] text-zinc-500 leading-snug">{note}</span></span>
      <span className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${on ? "bg-cyan-500" : "bg-white/10"}`}><span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${on ? "left-5" : "left-1"}`} /></span>
    </button>
  );
}

function Field({ label, value, children, hint }: { label: string; value?: React.ReactNode; children: React.ReactNode; hint?: string }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between mb-2.5"><span className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">{label}</span>{value !== undefined && <span className="text-xs font-mono text-cyan-400">{value}</span>}</div>
      {children}
      {hint && <p className="text-[11px] text-zinc-600 mt-2 leading-snug">{hint}</p>}
    </div>
  );
}

export function EngineView() {
  const [stats, setStats] = React.useState<any>(null);
  const [info, setInfo] = React.useState<EngineInfo | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = React.useRef<Partial<EngineSettings>>({});

  const loadStats = React.useCallback(() => fetch("/api/stats").then(r => r.json()).then(setStats).catch(() => {}), []);
  const loadInfo = React.useCallback(() => fetch("/api/engine/settings").then(r => r.json()).then(setInfo).catch(() => {}), []);
  React.useEffect(() => { loadStats(); loadInfo(); const t = setInterval(loadStats, 4000); return () => clearInterval(t); }, [loadStats, loadInfo]);

  // Changes show at once and are sent a moment later (so dragging a slider is one request, not fifty).
  const change = (patch: Partial<EngineSettings>, reloads = false) => {
    setInfo(i => i ? { ...i, settings: { ...i.settings, ...patch } } : i);
    pending.current = { ...pending.current, ...patch };
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const body = pending.current; pending.current = {};
      try {
        const r = await fetch("/api/engine/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not apply that");
        notify({ message: reloads ? "Saved - the model reloads with your next message" : "Engine updated", tab: "engine" });
        loadInfo(); loadStats();
      } catch (e: any) { notifyError(e.message, "engine"); loadInfo(); }
      setDirty(false);
    }, 450);
  };

  const setProfile = async (mode: string) => {
    setBusy(true);
    try { await fetch("/api/mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) }); await loadStats(); await loadInfo(); } finally { setBusy(false); }
  };
  const unload = async () => { setBusy(true); try { await fetch("/api/engine/unload", { method: "POST" }); notify({ message: "Model unloaded - memory freed", tab: "engine" }); await loadStats(); await loadInfo(); } finally { setBusy(false); } };
  const wipe = async () => { if (!window.confirm("Delete every stored memory entry? This can't be undone.")) return; setBusy(true); try { await fetch("/api/memory", { method: "DELETE" }); notify({ message: "Memory wiped", tab: "engine" }); } finally { setBusy(false); } };
  const reset = () => change({ gpuLayers: "auto", flashAttention: false, batchSize: null, useMmap: true, useMlock: false, keepAliveMinutes: 0, threads: null, contextSize: null, preloadModel: false, autoStartComfy: false, comfyUrl: null }, true);

  const [comfyDraft, setComfyDraft] = React.useState<string | null>(null);
  const saveComfyUrl = async () => {
    try {
      const r = await fetch("/api/engine/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comfyUrl: comfyDraft }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not save");
      notify({ message: "ComfyUI address saved", tab: "engine" }); setComfyDraft(null); loadInfo();
    } catch (e: any) { notifyError(e.message, "engine"); }
  };
  const s = info?.settings;
  const hw = info?.hardware;
  const tps: number | undefined = stats?.engine?.tps;
  const cores = hw?.cores || 8;
  const gpuMode = !s ? "auto" : s.gpuLayers === "auto" ? "auto" : s.gpuLayers === "max" ? "max" : s.gpuLayers === 0 ? "cpu" : "custom";
  const threads = s?.threads ?? info?.defaults.threads ?? 4;
  const modelOn = !!stats?.model?.active;
  const activeProfile = stats?.performanceMode;
  const gpuName = hw?.gpuNames?.[0];

  return (
    <div className="flex-1 bg-transparent p-6 h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto pb-10">
        <header className="mb-7 mt-4 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-black text-white tracking-tighter flex items-center gap-3"><Cpu className="text-cyan-500" size={30} /> Engine</h1>
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-[0.2em] mt-1.5">How your local models run on this PC</p>
          </div>
          <div className="flex items-center gap-2">
            {dirty && <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400 animate-pulse">Applying...</span>}
            <span className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${stats?.model?.status === "busy" ? "bg-amber-500/15 text-amber-300" : modelOn ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-zinc-500"}`}>
              <span className={`w-2 h-2 rounded-full ${stats?.model?.status === "busy" ? "bg-amber-400 animate-pulse" : modelOn ? "bg-emerald-400" : "bg-zinc-600"}`} />
              {stats?.model?.status === "busy" ? "Generating" : modelOn ? "Model loaded" : "No model loaded"}
            </span>
          </div>
        </header>

        {/* Live numbers */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className={`${card} !p-5 relative overflow-hidden`}><Gauge className="absolute top-4 right-4 text-cyan-500/40" size={18} /><p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-1">Speed</p><p className="text-3xl font-black text-white tracking-tighter tabular-nums">{tps ? tps.toFixed(1) : "—"}<span className="text-xs font-bold text-zinc-500 ml-1.5 tracking-normal">tok/s</span></p></div>
          <div className={`${card} !p-5 relative overflow-hidden`}><Layers className="absolute top-4 right-4 text-violet-500/40" size={18} /><p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-1">Model</p><p className="text-base font-black text-white tracking-tight truncate pr-6">{stats?.model?.active || "None"}</p><p className="text-[11px] text-zinc-500 mt-1">{info?.model ? `${info.model.gpuLayers} layers on GPU${info.model.contextSize ? ` · ${info.model.contextSize} ctx` : ""}` : "loads on first message"}</p></div>
          <div className={`${card} !p-5 relative overflow-hidden`}><Zap className="absolute top-4 right-4 text-emerald-500/40" size={18} /><p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-1">Tokens this session</p><p className="text-3xl font-black text-white tracking-tighter tabular-nums">{stats?.engine?.totalTokens ?? 0}</p></div>
          <div className={`${card} !p-5 relative overflow-hidden`}><MemoryStick className="absolute top-4 right-4 text-amber-500/40" size={18} /><p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-1">App memory</p><p className="text-lg font-black text-white tracking-tight">{stats?.ram?.rss || "—"}</p><div className="h-1.5 rounded-full bg-white/10 mt-2 overflow-hidden"><div className="h-full rounded-full bg-amber-400/80 transition-all" style={{ width: `${stats?.ram?.heapUsedPct ?? 0}%` }} /></div></div>
        </div>

        <div className="grid lg:grid-cols-[1fr_340px] gap-6">
          <div className="space-y-6 min-w-0">
            {/* Profile */}
            <section className={card}>
              <h2 className={heading}><Zap size={14} className="text-cyan-500" /> Performance profile</h2>
              <div className="grid sm:grid-cols-3 gap-3">
                {PROFILES.map(p => (
                  <button key={p.id} onClick={() => setProfile(p.id)} disabled={busy} className={`text-left p-4 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] transition-all ${activeProfile === p.id ? `ring-2 ${p.ring} bg-white/[0.06]` : ""}`}>
                    <p.icon className={p.tone} size={22} />
                    <p className="text-sm font-black text-white mt-3">{p.label}</p>
                    <p className="text-[11px] text-zinc-500 leading-snug mt-1">{p.note}</p>
                  </button>
                ))}
              </div>
            </section>

            {/* Compute */}
            <section className={card}>
              <h2 className={heading}><Cpu size={14} className="text-cyan-500" /> Compute</h2>
              <div className="divide-y divide-white/5">
                <Field label="GPU offload" value={gpuMode === "custom" && typeof s?.gpuLayers === "number" ? `${s.gpuLayers} layers` : undefined}
                  hint={hw?.gpu && hw.gpu !== "cpu" ? `Detected ${hw.gpu.toUpperCase()}${gpuName ? ` · ${gpuName}` : ""}. Auto fits as many layers as the video memory allows.` : "No GPU backend was found, so everything runs on the CPU."}>
                  <Chips value={gpuMode} disabled={!s} onChange={(v: string) => change({ gpuLayers: v === "cpu" ? 0 : v === "custom" ? (typeof s?.gpuLayers === "number" && s.gpuLayers > 0 ? s.gpuLayers : 24) : (v as "auto" | "max") }, true)}
                    options={[{ value: "cpu", label: "CPU only" }, { value: "auto", label: "Auto" }, { value: "max", label: "All on GPU" }, { value: "custom", label: "Custom" }]} />
                  {gpuMode === "custom" && typeof s?.gpuLayers === "number" && <input type="range" min={1} max={80} value={s.gpuLayers} onChange={e => change({ gpuLayers: Number(e.target.value) }, true)} className="w-full mt-4 accent-cyan-500" />}
                </Field>
                <Field label="CPU threads" value={s?.threads ? `${threads}` : `${threads} (profile)`} hint={`This PC reports ${cores} logical cores. More threads help on CPU, little when the GPU does the work.`}>
                  <div className="flex items-center gap-3">
                    <input type="range" min={1} max={cores} value={threads} onChange={e => change({ threads: Number(e.target.value) })} className="flex-1 accent-cyan-500" />
                    {s?.threads && <button onClick={() => change({ threads: null })} className="text-[11px] text-zinc-500 hover:text-white shrink-0">Use profile</button>}
                  </div>
                </Field>
                <Field label="Batch size" value={s?.batchSize ? `${s.batchSize}` : `${info?.defaults.batchSize ?? "—"} (profile)`} hint="How many prompt tokens are processed at once. Bigger is faster for long prompts and uses more memory.">
                  <Chips value={s?.batchSize ?? null} disabled={!s} onChange={(v: number | null) => change({ batchSize: v })}
                    options={[{ value: null, label: "Auto" }, ...[128, 256, 512, 1024, 2048].map(n => ({ value: n as number | null, label: String(n) }))]} />
                </Field>
              </div>
            </section>

            {/* Memory */}
            <section className={card}>
              <h2 className={heading}><MemoryStick size={14} className="text-cyan-500" /> Memory & behaviour</h2>
              <div className="divide-y divide-white/5">
                <Field label="Context size" value={s?.contextSize ? `${s.contextSize} tokens` : "Auto"} hint="How much of the conversation the model can see. Larger values use a lot more memory.">
                  <Chips value={s?.contextSize ?? null} disabled={!s} onChange={(v: number | null) => change({ contextSize: v })}
                    options={[{ value: null, label: "Auto" }, ...[2048, 4096, 8192, 16384, 32768].map(n => ({ value: n as number | null, label: n >= 1024 ? `${n / 1024}K` : String(n) }))]} />
                </Field>
                <Field label="Keep the model loaded" value={s?.keepAliveMinutes ? `${s.keepAliveMinutes} min idle` : "Always"} hint="After this long without a message the model is unloaded to give memory back; it loads again on the next message.">
                  <Chips value={s?.keepAliveMinutes ?? 0} disabled={!s} onChange={(v: number) => change({ keepAliveMinutes: v })}
                    options={[{ value: 0, label: "Always" }, ...[5, 15, 30, 60].map(n => ({ value: n, label: `${n} min` }))]} />
                </Field>
                <div className="pt-2">
                  <Toggle on={!!s?.flashAttention} disabled={!s || info?.model?.flashAttentionSupported === false} onChange={v => change({ flashAttention: v })} title="Flash attention" note={info?.model?.flashAttentionSupported === false ? "Not supported by the loaded model." : "Faster and lighter on memory for long conversations, on models that support it."} />
                  <Toggle on={!!s?.useMmap} disabled={!s} onChange={v => change({ useMmap: v }, true)} title="Memory-map the model file" note="Loads quickly and shares memory with the disk cache. Turn off if loading is unstable." />
                  <Toggle on={!!s?.useMlock} disabled={!s} onChange={v => change({ useMlock: v }, true)} title="Lock the model in RAM" note="Stops Windows swapping it out to disk. Needs enough free memory." />
                </div>
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className={card}>
              <h2 className={heading}><Power size={14} className="text-cyan-500" /> Startup & services</h2>
              <div className="divide-y divide-white/5">
                <Toggle on={!!s?.preloadModel} disabled={!s} onChange={v => change({ preloadModel: v })} title="Load the last model at launch" note={s?.lastModel ? `Warms up ${s.lastModel.split("/").pop()} so the first reply is quick.` : "Chat once first so the app knows which model to load."} />
                <div className="pt-1"><Toggle on={!!s?.autoStartComfy} disabled={!s} onChange={v => change({ autoStartComfy: v })} title="Start ComfyUI at launch" note="Needs the ComfyUI folder to be set (Image or Video tab)." /></div>
                <div className="pt-3">
                  <p className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest mb-2">ComfyUI address</p>
                  <div className="flex gap-2">
                    <input value={comfyDraft ?? info?.comfyUrl ?? ""} onChange={e => setComfyDraft(e.target.value)} placeholder="http://127.0.0.1:8188" spellCheck={false} className="flex-1 min-w-0 bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2 text-[13px] text-white font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500" />
                    <button onClick={saveComfyUrl} disabled={comfyDraft === null} className="px-3.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold disabled:opacity-40">Save</button>
                  </div>
                  <p className="text-[11px] text-zinc-600 mt-2 leading-snug">Where ComfyUI listens - change it if you run it on another port or another PC.</p>
                </div>
              </div>
            </section>

            <section className={card}>
              <h2 className={heading}><HardDrive size={14} className="text-cyan-500" /> This PC</h2>
              <dl className="space-y-3 text-[13px]">
                <div className="flex justify-between gap-3"><dt className="text-zinc-500">Compute</dt><dd className="text-zinc-200 font-semibold text-right">{hw?.gpu && hw.gpu !== "cpu" ? hw.gpu.toUpperCase() : "CPU"}</dd></div>
                {gpuName && <div className="flex justify-between gap-3"><dt className="text-zinc-500">Graphics</dt><dd className="text-zinc-200 font-semibold text-right truncate">{gpuName}</dd></div>}
                <div className="flex justify-between gap-3"><dt className="text-zinc-500">CPU threads</dt><dd className="text-zinc-200 font-semibold">{cores}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-zinc-500">Memory</dt><dd className="text-zinc-200 font-semibold">{hw?.ramGb ?? "—"} GB</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-zinc-500">Running with</dt><dd className="text-cyan-400 font-mono font-semibold">{stats?.engine?.threads ?? "—"} threads · batch {stats?.engine?.batch ?? "—"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-zinc-500">Reply delay</dt><dd className="text-zinc-200 font-semibold">{tps ? `${Math.round(1000 / tps)} ms / token` : "—"}</dd></div>
              </dl>
            </section>

            <section className={card}>
              <h2 className={heading}><Activity size={14} className="text-cyan-500" /> Controls</h2>
              <div className="space-y-2.5">
                <button onClick={unload} disabled={busy || !modelOn} className="w-full flex items-center justify-between p-3.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 transition-colors group"><span className="flex items-center gap-2.5 text-[12px] font-bold text-zinc-300"><Power size={14} /> Unload model now</span><span className="text-[10px] text-zinc-600">frees RAM / VRAM</span></button>
                <button onClick={reset} disabled={!s} className="w-full flex items-center justify-between p-3.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 transition-colors"><span className="flex items-center gap-2.5 text-[12px] font-bold text-zinc-300"><RotateCcw size={14} /> Reset engine settings</span><span className="text-[10px] text-zinc-600">back to defaults</span></button>
                <button onClick={wipe} disabled={busy} className="w-full flex items-center justify-between p-3.5 rounded-xl bg-white/[0.04] hover:bg-red-500/10 disabled:opacity-40 transition-colors"><span className="flex items-center gap-2.5 text-[12px] font-bold text-zinc-300"><Database size={14} /> Wipe memory store</span><span className="text-[10px] text-zinc-600">notes</span></button>
              </div>
              <p className="text-[11px] text-zinc-600 mt-4 flex items-start gap-2 leading-snug"><Timer size={13} className="shrink-0 mt-0.5" /> GPU, memory-map and RAM-lock changes reload the model on your next message; everything else applies at once.</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
