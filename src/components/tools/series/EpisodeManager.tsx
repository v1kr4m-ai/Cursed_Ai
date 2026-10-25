import React from "react";
import { ArrowDown, ArrowUp, ChevronRight, Copy, Trash2 } from "lucide-react";
import { api, type Episode, type Project, type Ref, type Scene } from "./api";
import { applyGrouping, GROUPING_PRESETS, itemLabel, type Grouping } from "./groups";

const field = "w-full bg-neutral-900/60 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-500 transition-colors";
const newId = () => Math.random().toString(36).slice(2, 10);
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** Gives the episodes 1, 2, 3... in the order they are in (file names for new clips follow the number). */
export const renumber = (episodes: Episode[]): Episode[] => episodes.map((e, i) => (e.number === i + 1 ? e : { ...e, number: i + 1 }));

/**
 * Moves a scene to a place in the same or another episode (index 0 = first). A scene that changes episode takes its
 * pictures with it: a picture the other episode already has under the same name is reused, any other is copied across.
 * Scenes in both episodes are numbered again, and the clip a scene has already rendered goes with it.
 */
export function moveScene(episodes: Episode[], fromId: string, sceneId: string, toId: string, index: number): Episode[] {
  const from = episodes.find(e => e.id === fromId), to = episodes.find(e => e.id === toId);
  const scene = from?.scenes.find(sc => sc.id === sceneId);
  if (!from || !to || !scene) return episodes;
  const place = (list: Scene[], at: number) => { const next = [...list]; next.splice(Math.max(0, Math.min(at, next.length)), 0, scene); return next; };
  const number = (list: Scene[]) => list.map((sc, i) => (sc.number === i + 1 ? sc : { ...sc, number: i + 1 }));
  if (from.id === to.id) {
    const without = [...from.scenes].sort((a, b) => a.number - b.number).filter(sc => sc.id !== sceneId);
    return episodes.map(e => (e.id === from.id ? { ...e, scenes: number(place(without, index)) } : e));
  }
  const addRefs: Ref[] = [];
  const mapped = scene.refIds.map(id => {
    const r = from.refs.find(x => x.id === id);
    if (!r) return id;
    const same = [...to.refs, ...addRefs].find(x => x.name === r.name && (x.person || "") === (r.person || "") && !!x.prompt.trim() === !!r.prompt.trim());
    if (same) return same.id;
    const copy: Ref = { ...r, id: newId(), fromRefIds: undefined };
    addRefs.push(copy);
    return copy.id;
  });
  const moving: Scene = { ...scene, refIds: mapped };
  return episodes.map(e => {
    if (e.id === from.id) return { ...e, scenes: number([...e.scenes].sort((a, b) => a.number - b.number).filter(sc => sc.id !== sceneId)) };
    if (e.id === to.id) { const list = [...e.scenes].sort((a, b) => a.number - b.number); const next = [...list]; next.splice(Math.max(0, Math.min(index, next.length)), 0, moving); return { ...e, refs: [...e.refs, ...addRefs], scenes: number(next) }; }
    return e;
  });
}

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
  const shuffle = (e: Episode, s: Scene, toId: string, index: number) => store(moveScene(eps, e.id, s.id, toId, index));
  const copy = (i: number) => { const next = [...eps]; next.splice(i + 1, 0, copyEpisode(eps[i])); store(renumber(next)); };

  const [grouping, setGrouping] = React.useState(false);
  const [g, setG] = React.useState<Grouping>(project.grouping || GROUPING_PRESETS[0].g);
  const groupAll = async (next: Grouping) => onSaved(await api.patch(project.id, { grouping: next, episodes: applyGrouping(eps, next) }));
  const ungroup = async () => onSaved(await api.patch(project.id, { grouping: undefined, episodes: eps.map(e => ({ ...e, group: undefined })) }));
  const groupNames = [...new Set(eps.map(e => (e.group || "").trim()).filter(Boolean))];
  const seconds = project.settings.seconds || 7;
  const totalScenes = eps.reduce((n, e) => n + e.scenes.length, 0);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] text-neutral-500">
        <span>{eps.length} episode{eps.length === 1 ? "" : "s"} - {totalScenes} scenes - about {Math.round((totalScenes * seconds) / 60 * 10) / 10} min in all</span>
        <button onClick={() => setGrouping(x => !x)} className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-400 hover:text-white">{grouping ? "Done grouping" : "Group episodes"}</button>
      </div>
      {grouping && (
        <div className="space-y-2 rounded-lg border border-neutral-700 bg-neutral-900/60 p-2.5 text-[11px] text-neutral-300">
          <div className="text-neutral-400">Put the episodes into groups, such as Week 1 (Day 1-7), Season 2, or one storyline per character.</div>
          <div className="flex flex-wrap gap-1.5">
            {GROUPING_PRESETS.map(p => <button key={p.label} onClick={() => { setG(p.g); groupAll(p.g); }} className="rounded-full border border-neutral-700 px-2.5 py-0.5 hover:border-amber-400/60">{p.label}</button>)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            Every <input type="number" min={1} value={g.size} onChange={e => setG({ ...g, size: Number(e.target.value) || 1 })} className={field + " w-14"} /> episodes make a
            <input value={g.unit} onChange={e => setG({ ...g, unit: e.target.value })} placeholder="Week" className={field + " w-20"} />, each called a
            <input value={g.item} onChange={e => setG({ ...g, item: e.target.value })} placeholder="Day" className={field + " w-20"} />
            <button onClick={() => groupAll(g)} className="rounded-md bg-amber-600/30 px-2.5 py-1 text-amber-100 hover:bg-amber-600/50">Apply</button>
            {eps.some(e => e.group) && <button onClick={ungroup} className="rounded-md border border-neutral-700 px-2.5 py-1 hover:bg-neutral-800">Remove groups</button>}
          </div>
          <div className="text-neutral-500">For storylines, leave this and type a group name on each episode instead (open an episode, "Group"). New episodes join the last group, or the automatic grouping when one is set.</div>
        </div>
      )}
      {eps.map((e, i) => {
        const head = (e.group || "") !== (eps[i - 1]?.group || "") && !!e.group;
        const sub = itemLabel(project, e);
        const isOpen = open === e.id;
        const done = e.scenes.filter(s => s.status === "done").length;
        return (
          <React.Fragment key={e.id}>
          {head && <div className="px-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-amber-300/80">{e.group}</div>}
          <div className={"rounded-lg border " + (isOpen ? "border-neutral-600 bg-neutral-900/60" : "border-neutral-800 bg-neutral-900/40")}>
            <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-neutral-300">
              <button onClick={() => setOpen(isOpen ? null : e.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <ChevronRight size={13} className={"shrink-0 text-neutral-500 transition-transform " + (isOpen ? "rotate-90" : "")} />
                <span className="w-5 shrink-0 text-neutral-500">{e.number}</span>
                <span className="min-w-0 flex-1 truncate">{sub && <span className="mr-1.5 text-amber-200/70">{sub}</span>}{e.title}</span>
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
                <label className="block space-y-0.5"><span className="text-[10px] text-neutral-500">Group (Week 1, Season 2, a character's storyline... or empty)</span>
                  <input key={e.id + (e.group || "")} defaultValue={e.group || ""} list={"groups-" + project.id} onBlur={ev => ev.target.value.trim() !== (e.group || "") && edit(e.id, { group: ev.target.value.trim() || undefined })} className={field} />
                  <datalist id={"groups-" + project.id}>{groupNames.map(n => <option key={n} value={n} />)}</datalist></label>
                <label className="block space-y-0.5"><span className="text-[10px] text-neutral-500">What this episode covers</span>
                  <input key={e.id + e.era} defaultValue={e.era} onBlur={ev => ev.target.value !== e.era && edit(e.id, { era: ev.target.value })} className={field} /></label>
                <label className="block space-y-0.5"><span className="text-[10px] text-neutral-500">Closing hook (what pulls the viewer to the next episode)</span>
                  <input key={e.id + e.hookOut} defaultValue={e.hookOut} onBlur={ev => ev.target.value !== e.hookOut && edit(e.id, { hookOut: ev.target.value })} className={field} /></label>
                <div className="space-y-1.5">
                  <div className="text-[10px] text-neutral-500">Script - the shot (what the camera sees) and the line, scene by scene. A clip already rendered is not redone by editing; render it again in Produce.</div>
                  {[...e.scenes].sort((a, b) => a.number - b.number).map((s, si, all) => (
                    <div key={s.id} className="rounded-md border border-neutral-800 p-2">
                      <div className="mb-1 flex items-center gap-1.5 text-[10px] text-neutral-500"><span>Scene {s.number}</span>{s.status === "done" && <span className="text-emerald-400">rendered</span>}<span>{words(s.vo)} words</span>
                        <span className="ml-auto flex items-center gap-0.5">
                          <button onClick={() => shuffle(e, s, e.id, si - 1)} disabled={si === 0} title="Move this scene earlier" className="rounded p-0.5 hover:text-white disabled:opacity-25"><ArrowUp size={11} /></button>
                          <button onClick={() => shuffle(e, s, e.id, si + 1)} disabled={si === all.length - 1} title="Move this scene later" className="rounded p-0.5 hover:text-white disabled:opacity-25"><ArrowDown size={11} /></button>
                          {eps.length > 1 && (
                            <select value="" onChange={ev => ev.target.value && shuffle(e, s, ev.target.value, 9999)} title="Move this scene (and its clip) to the end of another episode" className="ml-1 max-w-[7rem] rounded border border-neutral-700 bg-transparent px-1 py-0.5 text-[10px] text-neutral-400 [&_*]:bg-white [&_*]:text-black">
                              <option value="">Move to...</option>
                              {eps.filter(x => x.id !== e.id).map(x => <option key={x.id} value={x.id}>Episode {x.number}</option>)}
                            </select>
                          )}
                        </span></div>
                      <textarea key={s.id + s.shot} defaultValue={s.shot} rows={2} onBlur={ev => ev.target.value !== s.shot && editScene(e.id, s.id, { shot: ev.target.value })} placeholder="Shot" className={field + " resize-none"} />
                      <textarea key={s.id + s.vo} defaultValue={s.vo} rows={2} onBlur={ev => ev.target.value !== s.vo && editScene(e.id, s.id, { vo: ev.target.value })} placeholder="Line" className={field + " mt-1 resize-none"} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
