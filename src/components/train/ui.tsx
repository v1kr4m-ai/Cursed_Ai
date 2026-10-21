import React from "react";
import { FolderOpen, Loader2, Square, Trash2 } from "lucide-react";
import { nativeFolder } from "../comfy/types";
import type { Job } from "./trainApi";

export const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50";

/** A titled block, like the sections of the Image / Video pages. */
export function Card({ title, icon, note, children, right }: { title: string; icon?: React.ReactNode; note?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center gap-2.5">
        {icon && <span className="text-violet-400">{icon}</span>}
        <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-300">{title}</h3>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {note && <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">{note}</p>}
      <div className="space-y-3">{children}</div>
    </section>
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
  React.useEffect(() => { if (follow) box.current?.scrollTo({ top: box.current.scrollHeight }); }, [job.lines.length, follow]);
  const s = job.state;
  return (
    <div className="flex min-h-0 flex-col rounded-2xl border border-white/5 bg-black/30">
      <div className="flex items-center gap-3 border-b border-white/5 px-4 py-2">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">{title}</span>
        {s && <span className={`text-[10px] font-bold uppercase tracking-widest ${s.running ? "text-amber-400" : s.failed ? "text-rose-400" : s.stopped ? "text-zinc-500" : "text-emerald-400"}`}>{s.running ? "running" : s.failed ? "failed" : s.stopped ? "stopped" : "finished"}</span>}
        {s?.label && <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-600">{s.label}</span>}
        <label className="ml-auto flex items-center gap-1.5 text-[10px] text-zinc-500"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} className="accent-violet-500" />follow</label>
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
  );
}
