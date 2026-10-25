import React from "react";
import { ArrowUpRight, Clapperboard } from "lucide-react";

interface Summary { id: string; title: string; updatedAt: string; episodes: number; scenes: number; scenesDone: number; exports: number }

/** Small card on the Chat home: where your series stand, one click into the Series studio. Shows nothing when there are none. */
export function SeriesSummaryCard({ onOpen }: { onOpen: () => void }) {
  const [projects, setProjects] = React.useState<Summary[]>([]);
  React.useEffect(() => {
    let live = true;
    fetch("/api/series/projects").then(r => r.json()).then(d => { if (live && Array.isArray(d.projects)) setProjects(d.projects); }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!projects.length) return null;
  const shown = projects.filter(p => !(p as any).archived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 2);
  return (
    <button onClick={onOpen} title="Open Series Studio" className="mt-8 w-full max-w-xl text-left rounded-2xl border border-white/5 hover:border-white/20 hover:bg-white/5 p-4 transition-all group">
      <div className="flex items-center gap-2 mb-3">
        <Clapperboard size={14} className="text-violet-400" />
        <span className="text-[10px] text-zinc-500 uppercase tracking-widest flex-1">Your series</span>
        <ArrowUpRight size={14} className="text-zinc-600 group-hover:text-zinc-300" />
      </div>
      <div className="space-y-3">
        {shown.map(p => {
          const pct = p.scenes ? Math.round((p.scenesDone / p.scenes) * 100) : 0;
          return (
            <div key={p.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-zinc-200 truncate">{p.title}</span>
                <span className="text-[11px] text-zinc-500 shrink-0">{p.scenesDone}/{p.scenes} scenes · {p.exports}/{p.episodes} joined</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} /></div>
            </div>
          );
        })}
      </div>
    </button>
  );
}
