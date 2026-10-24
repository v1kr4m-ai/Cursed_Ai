import React from "react";
import { FolderOpen, Info, Loader2, Maximize2, Minimize2, Square, Trash2 } from "lucide-react";
import { nativeFolder } from "../comfy/types";
import type { Job } from "./trainApi";

export const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50";

/** What the (i) button on a card shows: what the step does, why it matters, and what each setting on the card changes. */
export interface CardInfo { job: string; why: string; settings?: [name: string, text: string][] }

/** A titled block, like the sections of the Image / Video pages. */
export function Card({ title, icon, note, children, right, info }: { title: string; icon?: React.ReactNode; note?: string; children: React.ReactNode; right?: React.ReactNode; info?: CardInfo }) {
  const [showInfo, setShowInfo] = React.useState(false);
  return (
    <section className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center gap-2.5">
        {icon && <span className="text-violet-400">{icon}</span>}
        <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-300">{title}</h3>
        {info && <button onClick={() => setShowInfo(v => !v)} title="What is this step?" aria-label={`About ${title}`} aria-expanded={showInfo} className={`rounded-full p-0.5 transition-colors ${showInfo ? "text-violet-300" : "text-zinc-600 hover:text-zinc-200"}`}><Info size={14} /></button>}
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {info && showInfo && (
        <div className="mb-3 space-y-2 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 text-[11px] leading-relaxed text-zinc-400">
          <p><span className="font-black uppercase tracking-widest text-violet-300">Job </span>{info.job}</p>
          <p><span className="font-black uppercase tracking-widest text-violet-300">Why it matters </span>{info.why}</p>
          {info.settings && info.settings.length > 0 && (
            <div><p className="mb-1 font-black uppercase tracking-widest text-violet-300">Settings</p>
              <ul className="space-y-1">{info.settings.map(([n, t]) => <li key={n}><span className="font-bold text-zinc-200">{n}: </span>{t}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {note && <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">{note}</p>}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Where a job is, read from what it printed (later lines win). Export steps print no percentage, so they are shown as "working". */
const SPEECH_STAGES: [RegExp, string, boolean][] = [
  [/\[speech\] done/, "Finishing", true],
  [/\[speech\] saving the model/, "Saving the model", true],
  [/after training:/, "Writing the results", true],
  [/\[speech\] trained \d+ steps/, "Scoring the trained model", true],
  [/\[speech\] training:/, "Training", false],
  [/before training:/, "Starting training", true],
  [/held back to score/, "Scoring the model before training", true],
  [/\[speech\] decoding audio/, "Reading the audio clips", true],
  [/\[speech\] loading/, "Loading the model", true],
  [/\[speech\] reading clips/, "Looking at the clips", true],
];
function stageOf(kind: string, lines: string[]): { text: string; indeterminate: boolean } | null {
  if (kind !== "llm" && kind !== "stt") return null;
  const rules: [RegExp, string, boolean][] = kind === "stt" ? SPEECH_STAGES : [
    [/\[train\.py\] done/, "Finishing", true],
    [/Converting GGUF bf16 into/, "Shrinking to q4_k_m (several minutes)", true],
    [/Converting model into bf16|Installing llama\.cpp/, "Converting to GGUF", true],
    [/exporting merged GGUF/, "Merging the adapter into the model", true],
    [/saving LoRA adapter/, "Saving the adapter", true],
    [/starting training/, "Training", false],
    [/loading dataset/, "Preparing the data", true],
    [/loading base model/, "Loading the model", true],
  ];
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 600); i--) {
    const hit = rules.find(([re]) => re.test(lines[i]));
    if (hit) return { text: hit[1], indeterminate: hit[2] };
  }
  return null;
}
const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ":" : ""}${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

/** Status in the page header: what is running, which step, percent, time elapsed and a Stop button; a short result chip after it ends. */
export function TrainProgress({ jobs }: { jobs: { title: string; job: Job }[] }) {
  const active = jobs.find(j => j.job.running);
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => { if (!active) return; const t = setInterval(tick, 1000); return () => clearInterval(t); }, [!!active]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!active) {
    const done = jobs.filter(j => j.job.state?.endedAt && Date.now() - (j.job.state.endedAt as number) < 10 * 60_000).sort((a, b) => (b.job.state!.endedAt as number) - (a.job.state!.endedAt as number))[0];
    if (!done) return null;
    const s = done.job.state!;
    const bad = s.failed || (s.code != null && s.code !== 0 && !s.stopped);
    return <div className={`flex shrink-0 items-center gap-2 border-b border-white/5 px-8 py-2 text-[12px] font-bold ${bad ? "bg-rose-500/10 text-rose-300" : s.stopped ? "bg-white/[0.03] text-zinc-400" : "bg-emerald-500/10 text-emerald-300"}`} role="status"><span className={`h-2 w-2 rounded-full ${bad ? "bg-rose-400" : s.stopped ? "bg-zinc-500" : "bg-emerald-400"}`} />{bad ? "Failed" : s.stopped ? "Stopped" : "Finished"} - {done.title}{bad && <span className="font-normal opacity-80"> (see the log at the bottom)</span>}</div>;
  }
  const { job, title } = active;
  const stage = stageOf(job.state?.kind || "", job.lines);
  const pct = !stage || stage.indeterminate || !job.progress ? null : Math.min(100, Math.max(0, job.progress.pct));
  const detail = stage?.indeterminate ? "" : job.progress?.text || "";
  return (
    <div className="flex shrink-0 items-center gap-4 border-b border-violet-500/20 bg-violet-500/10 px-8 py-3" role="status" aria-live="polite">
      <Loader2 size={20} className="shrink-0 animate-spin text-violet-300" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3 text-[12px]">
          <span className="shrink-0 font-black uppercase tracking-widest text-white">{title}</span>
          {stage && <span className="truncate font-semibold text-violet-200">{stage.text}</span>}
          <span className="ml-auto shrink-0 font-mono text-[13px] font-bold tabular-nums text-white">{pct != null ? `${pct}%` : ""}<span className="ml-3 font-normal text-zinc-400">{job.state?.startedAt ? clock(Date.now() - job.state.startedAt) : ""}</span></span>
        </div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-white/10">
          {pct != null ? <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400 transition-all" style={{ width: `${pct}%` }} /> : <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400" />}
        </div>
        {detail && <p className="mt-0.5 truncate text-[10px] text-zinc-400">{detail}</p>}
      </div>
      <button onClick={job.stop} title="Stop this job" className="flex shrink-0 items-center gap-1.5 rounded-lg bg-red-600/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white hover:bg-red-500"><Square size={10} className="fill-current" />Stop</button>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] leading-snug text-zinc-600">{hint}</span>}
    </label>
  );
}

export function NumberField({ label, value, onChange, min, max, step, hint }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; hint?: string }) {
  return <Field label={label} hint={hint}><input type="number" value={value} min={min} max={max} step={step} onChange={e => onChange(Number(e.target.value))} className={inputCls} /></Field>;
}

export function TextField({ label, value, onChange, placeholder, hint, mono }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string; mono?: boolean }) {
  return <Field label={label} hint={hint}><input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputCls + (mono ? " font-mono text-xs" : "")} /></Field>;
}

export function SelectField({ label, value, onChange, options, hint, empty }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; hint?: string; empty?: string }) {
  return (
    <Field label={label} hint={hint}>
      <select value={value} onChange={e => onChange(e.target.value)} className={inputCls}>
        {!options.length && <option value="">{empty || "Nothing found"}</option>}
        {options.map(o => <option key={o.value} value={o.value} className="bg-zinc-900">{o.label}</option>)}
      </select>
    </Field>
  );
}

/** A folder: type it, or browse with Windows' own dialog. */
export function FolderField({ label, value, onChange, hint, placeholder }: { label: string; value: string; onChange: (v: string) => void; hint?: string; placeholder?: string }) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputCls + " font-mono text-xs"} />
        <button type="button" onClick={async () => { const p = await nativeFolder(value || undefined); if (typeof p === "string") onChange(p); }} className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white/5 px-3 text-xs font-bold text-zinc-300 hover:bg-white/10"><FolderOpen size={14} />Browse</button>
      </div>
    </Field>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-violet-500" />{label}</label>;
}

export const btn = "flex items-center gap-2 rounded-xl bg-white/5 px-3.5 py-2 text-xs font-bold text-zinc-300 transition-colors hover:bg-white/10 disabled:opacity-40";
export const btnPrimary = "flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-violet-900/30 transition-colors hover:bg-violet-500 disabled:opacity-40";
export const btnDanger = "flex items-center gap-2 rounded-xl bg-red-600/80 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-red-500 disabled:opacity-40";

export function Badge({ ok, children, title }: { ok: boolean | null; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${ok === null ? "border-white/10 text-zinc-500" : ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok === null ? "bg-zinc-600" : ok ? "bg-emerald-500" : "bg-amber-500"}`} />{children}
    </span>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string; busy?: boolean }[] }) {
  return (
    <div className="flex items-center rounded-xl border border-white/10 bg-white/5 p-0.5">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[11px] font-black uppercase tracking-widest transition-colors ${value === t.id ? "bg-violet-600 text-white" : "text-zinc-500 hover:text-zinc-200"}`}>
          {t.label}{t.busy && <Loader2 size={11} className="animate-spin" />}
        </button>
      ))}
    </div>
  );
}

/** The live log of a job, with a progress bar and a Stop button. Sits at the bottom of the page. */
export function JobConsole({ job, title, idle }: { job: Job; title: string; idle?: string }) {
  const box = React.useRef<HTMLPreElement>(null);
  const [follow, setFollow] = React.useState(true);
  const [big, setBig] = React.useState(false);
  React.useEffect(() => { if (follow) box.current?.scrollTo({ top: box.current.scrollHeight }); }, [job.lines.length, follow, big]);
  React.useEffect(() => { if (!big) return; const esc = (e: KeyboardEvent) => e.key === "Escape" && setBig(false); window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc); }, [big]);
  const s = job.state;
  return (
    <>
    {big && <div className="fixed inset-0 z-[94] bg-black/60" onClick={() => setBig(false)} />}
    <div className={big ? "fixed inset-6 z-[95] flex min-h-0 flex-col rounded-2xl border border-white/15 bg-zinc-950 shadow-2xl" : "flex min-h-0 flex-col rounded-2xl border border-white/5 bg-black/30"}>
      <div className="flex items-center gap-3 border-b border-white/5 px-4 py-2">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">{title}</span>
        {s && <span className={`text-[10px] font-bold uppercase tracking-widest ${s.running ? "text-amber-400" : s.failed ? "text-rose-400" : s.stopped ? "text-zinc-500" : "text-emerald-400"}`}>{s.running ? "running" : s.failed ? "failed" : s.stopped ? "stopped" : "finished"}</span>}
        {s?.label && <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-600">{s.label}</span>}
        <label className="ml-auto flex items-center gap-1.5 text-[10px] text-zinc-500"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} className="accent-violet-500" />follow</label>
        <button onClick={() => setBig(v => !v)} title={big ? "Back to the small log (Esc)" : "Make the log bigger"} className="text-zinc-600 hover:text-zinc-300">{big ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
        <button onClick={job.clear} title="Clear the log" className="text-zinc-600 hover:text-zinc-300"><Trash2 size={13} /></button>
        {job.running && <button onClick={job.stop} className="flex items-center gap-1.5 rounded-lg bg-red-600/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white hover:bg-red-500"><Square size={10} className="fill-current" />Stop</button>}
      </div>
      {job.progress && (job.running || job.progress.pct < 100) && (
        <div className="px-4 pt-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 transition-all" style={{ width: `${job.progress.pct}%` }} /></div>
          <p className="mt-1 text-[10px] text-zinc-500">{job.progress.pct}% - {job.progress.text}</p>
        </div>
      )}
      <pre ref={box} className="min-h-[7rem] flex-1 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[11px] leading-relaxed text-zinc-400">{job.lines.length ? job.lines.join("\n") : idle || "Nothing has run yet. What a job prints shows up here as it happens."}</pre>
    </div>
    </>
  );
}
