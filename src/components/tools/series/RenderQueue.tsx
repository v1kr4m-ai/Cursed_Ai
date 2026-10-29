import React from "react";
import { ArrowDown, ArrowUp, ChevronsUp, Clock, Image as ImageIcon, Film, Loader2, Pause, Play, X } from "lucide-react";
import type { Project } from "./api";
import { onSeriesEvent } from "./seriesEvents";

interface QueueState {
  paused: boolean;
  running: { targetId: string; kind: "ref" | "scene"; label: string; progress: [number, number] | null } | null;
  waiting: { targetId: string; kind: "ref" | "scene"; label: string }[];
  avgMs: { ref: number | null; scene: number | null };
}

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
const mins = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);

/**
 * The render queue of one series: the job on the GPU and everything waiting, in order. Waiting jobs can be moved,
 * sent to the top or taken out; the whole queue can be paused (the running job finishes, nothing new starts).
 * Times are estimated from how long pictures and clips took lately.
 */
export function RenderQueue({ project }: { project: Project }) {
  const [q, setQ] = React.useState<QueueState | null>(null);
  const [open, setOpen] = React.useState(true);
  const base = `/api/series/projects/${project.id}/queue`;
  const load = React.useCallback(() => { fetch(base).then(r => r.json()).then(setQ).catch(() => {}); }, [base]);
  React.useEffect(() => {
    load();
    const stop = onSeriesEvent(d => { if (d.projectId === project.id && ["started", "finished", "failed", "updated", "idle"].includes(d.type)) load(); });
    const t = setInterval(load, 10_000);
    return () => { stop(); clearInterval(t); };
  }, [load, project.id]);

  if (!q || !Array.isArray(q.waiting) || (!q.running && !q.waiting.length && !q.paused)) return null;
  const guess = (kind: "ref" | "scene") => q.avgMs[kind] ?? q.avgMs.scene ?? q.avgMs.ref ?? null;
  const runLeft = q.running && guess(q.running.kind) !== null && q.running.progress && q.running.progress[1] > 0
    ? guess(q.running.kind)! * (1 - q.running.progress[0] / q.running.progress[1]) : q.running ? guess(q.running.kind) : 0;
  let acc = runLeft || 0;
  const rows = q.waiting.map(w => { const g = guess(w.kind); const startsIn = acc; if (g !== null) acc += g; return { ...w, startsIn: g !== null || startsIn ? startsIn : null }; });
  const total = q.avgMs.scene !== null || q.avgMs.ref !== null ? acc : null;
  const act = (path: string, body: unknown) => post(`${base}/${path}`, body).then(load);
  const btn = "rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-white disabled:opacity-25";

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen(o => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-neutral-100">
          <Clock size={14} className="text-sky-400" />
          <span>Render queue</span>
          <span className="text-[11px] text-neutral-500">{q.running ? "1 running" : "nothing running"}{q.waiting.length ? `, ${q.waiting.length} waiting` : ""}{total ? ` - about ${mins(total)} left` : ""}{q.paused ? " - paused" : ""}</span>
        </button>
        <button onClick={() => act("pause", { paused: !q.paused })} title={q.paused ? "Carry on with the queue" : "Pause: the job on the GPU finishes, nothing new starts"} className={"flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] " + (q.paused ? "bg-emerald-600/80 text-white hover:bg-emerald-600" : "border border-neutral-700 text-neutral-300 hover:bg-neutral-800")}>
          {q.paused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
        </button>
      </div>
      {open && (
        <div className="space-y-1 border-t border-neutral-800 p-2">
          {q.running && (
            <div className="flex items-center gap-2 rounded-lg bg-sky-950/40 px-2 py-1.5 text-xs text-sky-100">
              <Loader2 size={12} className="shrink-0 animate-spin text-sky-300" />
              {q.running.kind === "scene" ? <Film size={12} className="shrink-0" /> : <ImageIcon size={12} className="shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{q.running.label}</span>
              {q.running.progress && q.running.progress[1] > 0 && <span className="shrink-0 text-[10px] text-sky-300">step {q.running.progress[0]}/{q.running.progress[1]}</span>}
              {runLeft ? <span className="shrink-0 text-[10px] text-sky-300/70">~{mins(runLeft)}</span> : null}
            </div>
          )}
          {rows.map((w, i) => (
            <div key={w.targetId} className="group flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800/50">
              <span className="w-5 shrink-0 text-right text-[10px] text-neutral-600">{i + 1}</span>
              {w.kind === "scene" ? <Film size={12} className="shrink-0 text-neutral-500" /> : <ImageIcon size={12} className="shrink-0 text-neutral-500" />}
              <span className="min-w-0 flex-1 truncate">{w.label}</span>
              {w.startsIn !== null && <span className="shrink-0 text-[10px] text-neutral-600">starts in ~{mins(w.startsIn)}</span>}
              <span className="flex shrink-0 items-center opacity-60 group-hover:opacity-100">
                <button onClick={() => act("move", { targetId: w.targetId, to: "top" })} disabled={i === 0} title="Next to render" className={btn}><ChevronsUp size={12} /></button>
                <button onClick={() => act("move", { targetId: w.targetId, to: "up" })} disabled={i === 0} title="Earlier" className={btn}><ArrowUp size={12} /></button>
                <button onClick={() => act("move", { targetId: w.targetId, to: "down" })} disabled={i === rows.length - 1} title="Later" className={btn}><ArrowDown size={12} /></button>
                <button onClick={() => act("remove", { targetId: w.targetId })} title="Take it out of the queue" className={btn + " hover:text-rose-400"}><X size={12} /></button>
              </span>
            </div>
          ))}
          {!rows.length && <p className="px-2 py-1 text-[11px] text-neutral-500">Nothing waiting.</p>}
          {total === null && rows.length > 0 && <p className="px-2 text-[10px] text-neutral-600">Times show once a picture or clip has finished in this session.</p>}
        </div>
      )}
    </div>
  );
}
