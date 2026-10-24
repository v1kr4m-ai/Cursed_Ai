import React from "react";
import { ArrowDown, ArrowUp, ChevronRight, Copy, Trash2 } from "lucide-react";
import { api, type Episode, type Project, type Scene } from "./api";

const field = "w-full bg-neutral-900/60 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-500 transition-colors";
const newId = () => Math.random().toString(36).slice(2, 10);
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** Gives the episodes 1, 2, 3... in the order they are in (file names for new clips follow the number). */
export const renumber = (episodes: Episode[]): Episode[] => episodes.map((e, i) => (e.number === i + 1 ? e : { ...e, number: i + 1 }));

/** A copy of an episode's story (title, hook, scenes, picture prompts) with nothing rendered, so it can be reworked without touching the original's clips. */
export function copyEpisode(e: Episode): Episode {
  const refIds = new Map<string, string>();
  const refs = e.refs.map(r => { const id = newId(); refIds.set(r.id, id); return { ...r, id, status: "pending" as const, error: null, file: r.prompt.trim() ? null : r.file }; });
  const scenes: Scene[] = e.scenes.map(s => ({ ...s, id: newId(), status: "pending", error: null, clipPath: undefined, durationS: undefined, refIds: s.refIds.map(id => refIds.get(id) || id) } as Scene));
  return { ...e, id: newId(), title: `${e.title} (copy)`, refs, scenes, exportPath: null, outputs: undefined, finalKind: undefined, subtitles: undefined, audio: undefined, exportedAt: undefined };
}

/** The season as a list you can work on: reorder, rename, fix the hook, edit every scene's shot and line, copy, delete. */
export function EpisodeManager({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  const [open, setOpen] = React.useState<string | null>(null);
  const eps = project.episodes;
  const store = async (episodes: Episode[]) => onSaved(await api.patch(project.id, { episodes }));
  const edit = (id: string, change: Partial<Episode>) => store(eps.map(e => (e.id === id ? { ...e, ...change } : e)));
  const editScene = (epId: string, sceneId: string, change: Partial<Scene>) => store(eps.map(e => (e.id !== epId ? e : { ...e, scenes: e.scenes.map(s => (s.id === sceneId ? { ...s, ...change } : s)) })));
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= eps.length) return; const next = [...eps]; [next[i], next[j]] = [next[j], next[i]]; store(renumber(next)); };
  const remove = (e: Episode) => {
    const done = e.scenes.filter(s => s.status === "done").length;
    if (!confirm(`Delete episode ${e.number} "${e.title}"${done ? ` and its ${done} rendered clip${done === 1 ? "" : "s"} from the list` : ""}? The files on disk are not deleted.`)) return;
    store(renumber(eps.filter(x => x.id !== e.id)));
  };
  const copy = (i: number) => { const next = [...eps]; next.splice(i + 1, 0, copyEpisode(eps[i])); store(renumber(next)); };

  const seconds = project.settings.seconds || 7;
  const totalScenes = eps.reduce((n, e) => n + e.scenes.length, 0);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] text-neutral-500">
        <span>{eps.length} episode{eps.length === 1 ? "" : "s"} - {totalScenes} scenes - about {Math.round((totalScenes * seconds) / 60 * 10) / 10} min in all</span>
        <span>click an episode to edit its script</span>
      </div>
      {eps.map((e, i) => {
        const isOpen = open === e.id;
        const done = e.scenes.filter(s => s.status === "done").length;
        return (
          <div key={e.id} className={"rounded-lg border " + (isOpen ? "border-neutral-600 bg-neutral-900/60" : "border-neutral-800 bg-neutral-900/40")}>
            <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-neutral-300">
              <button onClick={() => setOpen(isOpen ? null : e.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <ChevronRight size={13} className={"shrink-0 text-neutral-500 transition-transform " + (isOpen ? "rotate-90" : "")} />
                <span className="w-5 shrink-0 text-neutral-500">{e.number}</span>
                <span className="min-w-0 flex-1 truncate">{e.title}</span>
                <span className="shrink-0 text-[10px] text-neutral-600">{done}/{e.scenes.length} clips</span>
              </button>
              <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up" className="rounded p-1 text-neutral-500 hover:text-white disabled:opacity-25"><ArrowUp size={12} /></button>
              <button onClick={() => move(i, 1)} disabled={i === eps.length - 1} title="Move down" className="rounded p-1 text-neutral-500 hover:text-white disabled:opacity-25"><ArrowDown size={12} /></button>
              <button onClick={() => copy(i)} title="Copy this episode's script (nothing rendered is copied)" className="rounded p-1 text-neutral-500 hover:text-white"><Copy size={12} /></button>
              <button onClick={() => remove(e)} title="Delete this episode" className="rounded p-1 text-neutral-600 hover:text-rose-400"><Trash2 size={12} /></button>
            </div>
            {isOpen && (
              <div className="space-y-2 border-t border-neutral-800 p-2.5">
                <label className="block space-y-0.5"><span className="text-[10px] text-neutral-500">Title</span>
                  <input key={e.id + e.title} defaultValue={e.title} onBlur={ev => ev.target.value.trim() && ev.target.value !== e.title && edit(e.id, { title: ev.target.value.trim() })} className={field} /></label>
                <label className="block space-y-0.5"><span className="text-[10px] text-neutral-500">What this episode covers</span>
                  <input key={e.id + e.era} defaultValue={e.era} onBlur={ev => ev.target.value !== e.era && edit(e.id, { era: ev.target.value })} className={field} /></label>
                <label className="block space-y-0.5"><span className="text-[10px] text-neutral-500">Closing hook (what pulls the viewer to the next episode)</span>
                  <input key={e.id + e.hookOut} defaultValue={e.hookOut} onBlur={ev => ev.target.value !== e.hookOut && edit(e.id, { hookOut: ev.target.value })} className={field} /></label>
                <div className="space-y-1.5">
                  <div className="text-[10px] text-neutral-500">Script - the shot (what the camera sees) and the line, scene by scene. A clip already rendered is not redone by editing; render it again in Produce.</div>
                  {[...e.scenes].sort((a, b) => a.number - b.number).map(s => (
                    <div key={s.id} className="rounded-md border border-neutral-800 p-2">
                      <div className="mb-1 flex items-center gap-2 text-[10px] text-neutral-500"><span>Scene {s.number}</span>{s.status === "done" && <span className="text-emerald-400">rendered</span>}<span className="ml-auto">{words(s.vo)} words</span></div>
                      <textarea key={s.id + s.shot} defaultValue={s.shot} rows={2} onBlur={ev => ev.target.value !== s.shot && editScene(e.id, s.id, { shot: ev.target.value })} placeholder="Shot" className={field + " resize-none"} />
                      <textarea key={s.id + s.vo} defaultValue={s.vo} rows={2} onBlur={ev => ev.target.value !== s.vo && editScene(e.id, s.id, { vo: ev.target.value })} placeholder="Line" className={field + " mt-1 resize-none"} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
