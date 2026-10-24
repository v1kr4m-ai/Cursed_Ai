import React from "react";
import { adoptPlannedPeople, ensureCast, peopleOf, placeCast } from "./people";
import { syncPhotos } from "./photos";
import { useWorkflowInfo } from "./workflows";
import { WorkflowCheck } from "./WorkflowPicker";
import { ZoomImage } from "./ZoomImage";
import { projectFormat } from "../../../../seriesTool/formats";
import { kindOf, refKindInfo, REF_KINDS } from "../../../../seriesTool/refKinds";
import { motion, AnimatePresence } from "motion/react";
import {
  Play, RefreshCw, Image as ImageIcon, Film, ChevronRight, X, AlertTriangle,
  Clock, Loader2, CheckCircle2, CircleSlash, Trash2, Wand2, Clapperboard, Mic,
  Plus,
} from "lucide-react";
import { api, fileUrl, type Episode, type Project, type Ref, type Scene, type Status } from "./api";
import { RefDrop } from "./RefDrop";

/**
 * Stage 2. The production board: every episode, its reference stills and its scenes, each with a
 * status and a render button. This is the screen that answers "what is done, what is left".
 */

const field = "w-full bg-neutral-900/60 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-500 transition-colors";

const STATUS_ICON: Record<Status, React.ComponentType<{ size?: number; className?: string }>> = {
  pending: CircleSlash, queued: Clock, running: Loader2, done: CheckCircle2, failed: AlertTriangle,
};
const STATUS_TONE: Record<Status, string> = {
  pending: "bg-neutral-700/40 text-neutral-400 border-neutral-700",
  queued: "bg-amber-500/15 text-amber-300 border-amber-700/50",
  running: "bg-sky-500/15 text-sky-300 border-sky-600/50",
  done: "bg-emerald-500/15 text-emerald-300 border-emerald-700/50",
  failed: "bg-rose-500/15 text-rose-300 border-rose-700/50",
};

function Badge({ status, progress }: { status: Status; progress?: [number, number] | null }) {
  const Icon = STATUS_ICON[status];
  const label = status === "running" && progress && progress[1]
    ? `${Math.round((progress[0] / progress[1]) * 100)}%`
    : status;
  return (
    <motion.span
      layout
      initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[status]}`}
    >
      <Icon size={10} className={status === "running" ? "animate-spin" : ""} />
      {label}
    </motion.span>
  );
}

function RefCard({ project, episode, ref_, running, onChanged }: {
  project: Project; episode: Episode; ref_: Ref;
  running: { targetId: string; progress: [number, number] | null } | null;
  onChanged: (p: Project) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(ref_);
  React.useEffect(() => setDraft(ref_), [ref_.id, ref_.status, ref_.file]);
  const isRunning = running?.targetId === ref_.id;

  const save = async (changes: Partial<Ref>) => {
    const next = { ...draft, ...changes };
    setDraft(next);
    const episodes = project.episodes.map(e => e.id !== episode.id ? e : { ...e, refs: e.refs.map(r => (r.id === ref_.id ? next : r)) });
    onChanged(await api.patch(project.id, { episodes }));
  };

  const picker = React.useRef<HTMLInputElement>(null);
  const [swapping, setSwapping] = React.useState(false);
  const isPerson = kindOf(ref_) === "person";
  /** Swaps this generated picture for a real one in every scene (and every episode), under the same name. */
  const finishSwap = async (episodes: Episode[]) => {
    const patched = await api.patch(project.id, { episodes });
    const synced = await syncPhotos(patched);
    onChanged(await api.patch(project.id, { episodes: ensureCast({ ...synced.project, episodes: adoptPlannedPeople(synced.project) }) }));
  };
  const useMyImage = async (file: File) => {
    setSwapping(true);
    try {
      const person = isPerson ? (ref_.person || ref_.name) : undefined;
      const { ref: made } = await api.uploadRef(project.id, episode.id, file, ref_.name, ref_.role === "style" ? "style" : "character", kindOf(ref_), person);
      const fresh = await api.get(project.id);
      await finishSwap(fresh.episodes.map(e => (e.id !== episode.id ? e : { ...e, refs: e.refs.filter(r => r.id !== ref_.id), scenes: e.scenes.map(sc => ({ ...sc, refIds: sc.refIds.map(id => (id === ref_.id ? made.id : id)) })) })));
    } finally { setSwapping(false); if (picker.current) picker.current.value = ""; }
  };
  const usePhoto = async (photo: Ref) => {
    setSwapping(true);
    try {
      await finishSwap(project.episodes.map(e => (e.id !== episode.id ? e : {
        ...e,
        refs: e.refs.filter(r => r.id !== ref_.id).map(r => (r.id === photo.id && isPerson ? { ...r, person: ref_.person || ref_.name } : r)),
        scenes: e.scenes.map(sc => ({ ...sc, refIds: sc.refIds.map(id => (id === ref_.id ? photo.id : id)).filter((id, i, a) => a.indexOf(id) === i) })),
      })));
    } finally { setSwapping(false); }
  };

  const remove = async () => {
    if (!confirm(`Remove the reference "${ref_.name}"? Scenes using it will lose that slot.`)) return;
    await api.deleteRef(project.id, ref_.id);
    onChanged(await api.get(project.id));
  };

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
      className="group rounded-lg border border-neutral-800 bg-neutral-900/50 overflow-hidden hover:border-neutral-700 transition-colors">
      <div className="flex items-center gap-2 p-2">
        <motion.div whileHover={{ scale: 1.08 }} className="h-12 w-12 shrink-0 overflow-hidden rounded bg-neutral-800 grid place-items-center">
          {ref_.file
            ? <ZoomImage src={fileUrl(ref_.file)} alt={ref_.name} className="h-full w-full object-cover" />
            : <ImageIcon size={16} className="text-neutral-600" />}
        </motion.div>
        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(o => !o)}>
          <div className="truncate text-sm text-neutral-200">{ref_.name}</div>
          <div className="flex items-center gap-1 text-[11px] text-neutral-500">
            {ref_.role === "style" ? <><Wand2 size={9} className="text-violet-400" /> {refKindInfo(kindOf(ref_))!.label}{kindOf(ref_) === "style" ? " - Picture 1" : ""}</> : <><ImageIcon size={9} /> {refKindInfo(kindOf(ref_))!.label}</>}
          </div>
        </button>
        <Badge status={isRunning ? "running" : ref_.status} progress={running?.progress} />
        <div className="flex items-center gap-1">
          {!(ref_.file && !ref_.prompt.trim()) && <motion.button whileTap={{ scale: 0.9 }} onClick={() => api.generateRef(project.id, ref_.id)}
            className="rounded-md border border-neutral-700 p-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-white"
            title={ref_.file ? "Render again" : "Render this still"}>
            {ref_.file ? <RefreshCw size={14} /> : <Play size={14} />}
          </motion.button>}
          <button onClick={remove} className="rounded-md p-1.5 text-neutral-600 opacity-0 transition group-hover:opacity-100 hover:text-rose-400" title="Remove reference">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {ref_.error && <div className="px-3 pb-2 text-[11px] text-rose-300">{ref_.error}</div>}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-neutral-800">
            <div className="space-y-2 p-3">
              <textarea className={`${field} h-24 resize-none text-xs`} value={draft.prompt} onChange={e => setDraft({ ...draft, prompt: e.target.value })} onBlur={() => save({ prompt: draft.prompt })} placeholder="Image prompt" />
              <textarea className={`${field} h-16 resize-none text-xs`} value={draft.negative} onChange={e => setDraft({ ...draft, negative: e.target.value })} onBlur={() => save({ negative: draft.negative })} placeholder="Negative prompt" />
              <label className="flex items-center gap-2 text-[11px] text-neutral-400"><input type="checkbox" checked={!!draft.skip} onChange={e => save({ skip: e.target.checked })} />Skip this picture: leave it out of every prompt and workflow slot (nothing is deleted)</label>
              {kindOf(draft) === "person" && (
                <div>
                  <label className="text-[11px] text-neutral-500">Who is this person? (pictures with the same name are the same person)</label>
                  <input className={`${field} text-xs`} value={draft.person || ""} list="series-people-card" onChange={e => setDraft({ ...draft, person: e.target.value })} onBlur={() => save({ person: (draft.person || "").trim() || undefined })} placeholder="Name" />
                  <datalist id="series-people-card">{peopleOf(project).map(x => <option key={x.name} value={x.name} />)}</datalist>
                </div>
              )}
              <div>
                <label className="text-[11px] text-neutral-500">What this picture is for</label>
                <select value={kindOf(draft)} onChange={e => { const k = REF_KINDS.find(x => x.id === e.target.value)!; save({ kind: k.id, role: k.role }); }} className={`${field} text-xs [&_*]:bg-white [&_*]:text-black`}>
                  {REF_KINDS.map(k => <option key={k.id} value={k.id}>{k.label} - {k.blurb}</option>)}
                </select>
              </div>
              {draft.prompt.trim() && episode.refs.some(r => r.id !== ref_.id && r.file && !r.prompt.trim()) && (
                <div>
                  <label className="text-[11px] text-neutral-500">Made from these photos (image-to-image) - none picked means all attached photos</label>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {episode.refs.filter(r => r.id !== ref_.id && r.file && !r.prompt.trim()).map(r => {
                      const on = (draft.fromRefIds || []).includes(r.id);
                      return (
                        <button key={r.id} title={r.name} onClick={() => save({ fromRefIds: on ? (draft.fromRefIds || []).filter(x => x !== r.id) : [...(draft.fromRefIds || []), r.id] })}
                          className={"h-10 w-10 overflow-hidden rounded border-2 transition " + (on ? "border-sky-400" : "border-neutral-700 opacity-70 hover:opacity-100")}>
                          <img src={fileUrl(r.file!)} alt={r.name} className="h-full w-full object-cover" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {draft.prompt.trim() && (
                <div className="space-y-1.5 rounded-lg border border-neutral-800 p-2">
                  <div className="text-[11px] text-neutral-400">Do not want this picture made by ComfyUI?</div>
                  <input ref={picker} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && useMyImage(e.target.files[0])} />
                  <button onClick={() => picker.current?.click()} disabled={swapping} className="rounded-md border border-neutral-600 px-2.5 py-1 text-[11px] text-neutral-200 hover:bg-neutral-800 disabled:opacity-50">{swapping ? "Working..." : "Use my own image instead"}</button>
                  {episode.refs.some(r => r.id !== ref_.id && r.file && !r.prompt.trim()) && (
                    <div>
                      <div className="text-[11px] text-neutral-500">...or use a photo already attached (click one):</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {episode.refs.filter(r => r.id !== ref_.id && r.file && !r.prompt.trim()).map(r => (
                          <button key={r.id} title={`Use ${r.name} as "${ref_.name}"`} disabled={swapping} onClick={() => usePhoto(r)} className="h-10 w-10 overflow-hidden rounded border-2 border-neutral-700 transition hover:border-emerald-400 disabled:opacity-50"><img src={fileUrl(r.file!)} alt={r.name} className="h-full w-full object-cover" /></button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-[10px] leading-relaxed text-neutral-600">The picture is replaced in every scene and keeps the name "{ref_.name}", so prompts that mention it point at your image. To make a picture that follows your photo instead, pick the photos under "Made from these photos".</p>
                </div>
              )}
              {ref_.file && <a href={fileUrl(ref_.file)} target="_blank" rel="noreferrer" className="block truncate text-[11px] text-sky-400 hover:underline">{ref_.file}</a>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SceneCard({ project, episode, scene, running, onChanged }: {
  project: Project; episode: Episode; scene: Scene;
  running: { targetId: string; progress: [number, number] | null } | null;
  onChanged: (p: Project) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [draft, setDraft] = React.useState(scene);
  React.useEffect(() => setDraft(scene), [scene.id, scene.status, scene.clipPath]);

  const isRunning = running?.targetId === scene.id;
  const fmt = projectFormat(project);
  const people = peopleOf(project);
  const videoWf = useWorkflowInfo("video", project.settings.videoWorkflow);
  const words = draft.vo.trim().split(/\s+/).filter(Boolean).length;
  const [minWords, maxWords] = fmt.lineWords.split("-").map(Number);
  const inRange = fmt.speech === "none" || (words >= minWords && words <= maxWords);

  const save = async (changes: Partial<Scene>) => {
    const next = { ...draft, ...changes };
    setDraft(next);
    const episodes = project.episodes.map(e => e.id !== episode.id ? e : { ...e, scenes: e.scenes.map(s => (s.id === scene.id ? next : s)) });
    onChanged(await api.patch(project.id, { episodes }));
  };

  const toggleRef = (refId: string) => {
    const has = draft.refIds.includes(refId);
    save({ refIds: has ? draft.refIds.filter(r => r !== refId) : [...draft.refIds, refId] });
  };

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={`rounded-lg border bg-neutral-900/50 overflow-hidden transition-colors ${isRunning ? "border-sky-700/70" : "border-neutral-800 hover:border-neutral-700"}`}>
      <div className="flex items-start gap-3 p-3">
        {scene.clipPath ? (
          <motion.button whileHover={{ scale: 1.06 }} onClick={() => setPlaying(true)} title="Play this clip" className="relative h-14 w-10 shrink-0 overflow-hidden rounded bg-black">
            <video src={fileUrl(scene.clipPath) + "#t=0.4"} muted playsInline preload="metadata" className="h-full w-full object-cover" />
            <span className="absolute inset-0 grid place-items-center bg-black/25 opacity-80 hover:opacity-100"><Play size={14} className="text-white" /></span>
          </motion.button>
        ) : (
          <div className="grid h-14 w-10 shrink-0 place-items-center rounded bg-neutral-800"><Film size={16} className="text-neutral-600" /></div>
        )}
        {playing && scene.clipPath && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" onClick={() => setPlaying(false)}>
            <div className="max-h-full space-y-2" onClick={e => e.stopPropagation()}>
              <video src={fileUrl(scene.clipPath)} controls autoPlay loop playsInline className="max-h-[80vh] max-w-full rounded-lg bg-black" />
              <div className="flex items-center justify-between text-xs text-neutral-300">
                <span>Episode {episode.number}, scene {scene.number}</span>
                <span className="flex gap-2">
                  <button onClick={() => { api.generateScene(project.id, scene.id); setPlaying(false); }} className="rounded-md border border-neutral-600 px-2.5 py-1 hover:bg-neutral-800">Render again</button>
                  <button onClick={() => setPlaying(false)} className="rounded-md border border-neutral-600 px-2.5 py-1 hover:bg-neutral-800">Close</button>
                </span>
              </div>
            </div>
          </div>
        )}
        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(o => !o)}>
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">#{scene.number}</span>
            <Badge status={isRunning ? "running" : scene.status} progress={running?.progress} />
            {scene.durationS && <span className="text-[11px] text-neutral-500">{scene.durationS.toFixed(2)}s</span>}
          </div>
          <div className="mt-1 line-clamp-2 text-sm text-neutral-200">{scene.vo || <span className="text-neutral-600">No {fmt.lineLabel.toLowerCase()} yet</span>}</div>
          {draft.refIds.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1" title="The pictures this scene is made from, in order">
              <span className="text-[10px] text-neutral-600">uses</span>
              {draft.refIds.map(id => episode.refs.find(r => r.id === id)).filter((r): r is Ref => !!r).map(r => (
                <span key={r.id} className={"flex items-center gap-1 rounded-full border border-neutral-700 py-0.5 pl-0.5 pr-2 text-[10px] " + (r.skip ? "text-neutral-600 line-through" : "text-neutral-300")}>
                  {r.file ? <img src={fileUrl(r.file)} alt="" className="h-4 w-4 rounded-full object-cover" /> : <span className="h-4 w-4 rounded-full bg-neutral-700" />}
                  {r.person || r.name}{r.file && !r.prompt.trim() ? " (photo)" : !r.file ? " (not made yet)" : ""}
                </span>
              ))}
            </div>
          )}
        </button>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => api.generateScene(project.id, scene.id)}
          className="rounded-md border border-neutral-700 p-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-white"
          title={scene.clipPath ? "Render again" : "Render this scene"}>
          {scene.clipPath ? <RefreshCw size={14} /> : <Play size={14} />}
        </motion.button>
      </div>

      {isRunning && running?.progress && running.progress[1] > 0 && (
        <div className="h-0.5 bg-neutral-800">
          <motion.div className="h-full bg-sky-500" animate={{ width: `${(running.progress[0] / running.progress[1]) * 100}%` }} transition={{ ease: "linear" }} />
        </div>
      )}

      {scene.error && (
        <div className="mx-3 mb-2 flex items-start gap-2 rounded border border-rose-900/60 bg-rose-950/30 px-2 py-1.5 text-[11px] text-rose-200">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {scene.error}
        </div>
      )}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-neutral-800">
            <div className="space-y-3 p-3">
              <div>
                <label className="flex justify-between text-[11px] text-neutral-500">
                  <span className="flex items-center gap-1"><Mic size={10} /> {fmt.lineLabel}</span>
                  <motion.span animate={{ color: inRange ? "rgb(52 211 153)" : "rgb(251 191 36)" }}>{words} words{fmt.speech === "none" ? "" : ` (aim for ${fmt.lineWords})`}</motion.span>
                </label>
                <textarea className={`${field} h-16 resize-none text-xs`} value={draft.vo} onChange={e => setDraft({ ...draft, vo: e.target.value })} onBlur={() => save({ vo: draft.vo })} />
              </div>
              <div>
                <label className="flex items-center gap-1 text-[11px] text-neutral-500"><Clapperboard size={10} /> Shot</label>
                <textarea className={`${field} h-20 resize-none text-xs`} value={draft.shot} onChange={e => setDraft({ ...draft, shot: e.target.value })} onBlur={() => save({ shot: draft.shot })} />
              </div>
              <div>
                <label className="text-[11px] text-neutral-500">On-screen text card {project.allowTextCards ? "" : "(not used: text cards are switched off in Develop, so no writing is added to the video)"}</label>
                <input className={`${field} text-xs`} value={draft.textCard} onChange={e => setDraft({ ...draft, textCard: e.target.value })} onBlur={() => save({ textCard: draft.textCard })} />
              </div>
              {people.length > 0 && (
                <div>
                  <label className="text-[11px] text-neutral-500">People in this scene</label>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {people.map(person => {
                      const on = (draft.cast || []).some(n => n.toLowerCase() === person.name.toLowerCase());
                      return (
                        <button key={person.name} onClick={() => { const cast = on ? (draft.cast || []).filter(n => n.toLowerCase() !== person.name.toLowerCase()) : [...(draft.cast || []), person.name]; save({ cast, refIds: placeCast(episode, { ...draft, cast }, people, project.stillPeople).refIds }); }}
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${on ? "border-emerald-600 bg-emerald-600/20 text-emerald-200" : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"}`}>{person.name}</button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div>
                <label className="text-[11px] text-neutral-500">References: tick the pictures this scene uses (the order is the Picture order)</label>
                <div className="mt-1 space-y-1">
                  {episode.refs.map(r => {
                    const index = draft.refIds.indexOf(r.id);
                    const on = index >= 0 && !r.skip;
                    return (
                      <label key={r.id} className={`flex items-center gap-2 rounded-md border px-2 py-1 text-[11px] transition ${on ? "border-sky-700 bg-sky-600/10 text-sky-100" : "border-neutral-800 text-neutral-400"} ${r.skip ? "opacity-50" : ""}`}>
                        <input type="checkbox" checked={index >= 0} disabled={r.skip} onChange={() => toggleRef(r.id)} />
                        {r.file ? <ZoomImage src={fileUrl(r.file)} alt={r.name} className="h-6 w-6 rounded-sm object-cover" /> : <span className="h-6 w-6 rounded-sm bg-neutral-800" />}
                        <span className="min-w-0 flex-1 truncate">{on ? `Picture ${index + 1}: ` : ""}{r.name}{r.person ? ` (${r.person})` : ""}</span>
                        <span className="shrink-0 text-[10px] text-neutral-500">{r.skip ? "skipped everywhere" : !r.file ? "not rendered" : refKindInfo(kindOf(r))!.label.split(" ")[0]}</span>
                      </label>
                    );
                  })}
                </div>
                {videoWf && (() => {
                  const used = draft.refIds.filter(id => !episode.refs.find(r => r.id === id)?.skip).length;
                  const slots = videoWf.refImageCount;
                  return (
                    <p className={`mt-1 text-[10px] leading-relaxed ${used > slots ? "text-rose-300" : "text-neutral-500"}`}>
                      {slots === 0 ? "This workflow shows no reference slots." : `The clip workflow has ${slots} reference slot${slots === 1 ? "" : "s"}; this scene uses ${used}.`}
                      {used > slots ? " Untick some: extra pictures stop the render." : used < slots ? (videoWf.refImageBypassable?.slice(used).every(Boolean) ? " Slots left empty are skipped by the workflow." : " Slots left empty repeat the first picture, because this workflow cannot skip them.") : ""}
                    </p>
                  );
                })()}
              </div>
              <div>
                <label className="flex justify-between text-[11px] text-neutral-500">
                  <span>Prompt sent to ComfyUI</span>
                  {draft.promptEdited && <button className="text-sky-400 hover:underline" onClick={() => save({ promptEdited: false, promptText: "" })}>revert to generated</button>}
                </label>
                <textarea className={`${field} h-32 resize-none font-mono text-[11px]`} value={draft.promptText}
                  placeholder="Built from the style lock, narrator, shot and references when you render."
                  onChange={e => setDraft({ ...draft, promptText: e.target.value })}
                  onBlur={() => save({ promptText: draft.promptText, promptEdited: !!draft.promptText.trim() })} />
              </div>
              {scene.clipPath && <video src={fileUrl(scene.clipPath)} controls className="max-h-72 w-full rounded bg-black" />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function Board({ project, onChanged, focusEpisodeId, onAddEpisode, onOpenSettings }: { project: Project; onChanged: (p: Project) => void; focusEpisodeId?: string | null; onAddEpisode?: () => void; onOpenSettings?: () => void }) {
  // Opens where the work is: the episode you came for, else the first one with clips still to make.
  const [openEpisode, setOpenEpisode] = React.useState<string | null>(focusEpisodeId || (project.episodes.find(e => e.scenes.some(sc => sc.status !== "done")) || project.episodes[0])?.id || null);
  const [onlyTodo, setOnlyTodo] = React.useState(false);
  const allScenes = project.episodes.flatMap(e => e.scenes), allRefs = project.episodes.flatMap(e => e.refs);
  const scenesLeft = allScenes.filter(sc => sc.status !== "done").length, refsLeft = allRefs.filter(r => r.status !== "done" && !r.skip && (r.prompt || "").trim()).length;
  const failed = allScenes.filter(sc => sc.status === "failed").length + allRefs.filter(r => r.status === "failed").length;
  React.useEffect(() => { if (focusEpisodeId) setOpenEpisode(focusEpisodeId); }, [focusEpisodeId]);
  const running = project.running || null;

  if (!project.episodes.length) {
    return (
      <div className="grid h-full place-items-center text-center">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-md space-y-2">
          <motion.div animate={{ rotate: [0, -8, 8, 0] }} transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}>
            <Clapperboard size={32} className="mx-auto text-neutral-600" />
          </motion.div>
          <p className="text-sm text-neutral-400">No episodes yet.</p>
          <p className="text-xs text-neutral-500">Go to Develop, talk the series through, then press "Build the episode plan".</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto pr-1">
      <AnimatePresence>
        {running && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="sticky top-0 z-10 flex items-center gap-3 rounded-lg border border-sky-900/60 bg-sky-950/70 px-3 py-2 backdrop-blur">
            <Loader2 size={13} className="animate-spin text-sky-300" />
            <span className="text-xs text-sky-200">{running.label}</span>
            {running.progress && running.progress[1] > 0 && (
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-neutral-800">
                <motion.div className="h-full rounded bg-gradient-to-r from-sky-500 to-cyan-400"
                  animate={{ width: `${(running.progress[0] / running.progress[1]) * 100}%` }} transition={{ ease: "linear" }} />
              </div>
            )}
            <button onClick={() => api.cancel(project.id)} className="flex items-center gap-1 rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800">
              <X size={12} /> Cancel
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <WorkflowCheck project={project} onChanged={onChanged} onOpenSettings={onOpenSettings} />
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-neutral-100">{scenesLeft === 0 && refsLeft === 0 ? "Everything is rendered" : `${scenesLeft} clip${scenesLeft === 1 ? "" : "s"} and ${refsLeft} picture${refsLeft === 1 ? "" : "s"} left to make`}</div>
          <div className="text-[11px] text-neutral-500">{allScenes.length - scenesLeft} of {allScenes.length} clips done{failed ? ` - ${failed} failed (open the episode and press render again)` : ""}. {scenesLeft === 0 && refsLeft === 0 ? "Next: join the episodes in Assemble." : "Pictures are made first, then the clips."}</div>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-neutral-400"><input type="checkbox" checked={onlyTodo} onChange={e => setOnlyTodo(e.target.checked)} /> only what needs work</label>
        <button onClick={() => setOpenEpisode(openEpisode ? null : project.episodes[0].id)} className="rounded-lg border border-neutral-700 px-2.5 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-800">{openEpisode ? "Fold all" : "Open first"}</button>
        {(scenesLeft > 0 || refsLeft > 0) && !running && (
          <button onClick={async () => { for (const ep of project.episodes) if (ep.scenes.some(sc => sc.status !== "done") || ep.refs.some(r => r.status !== "done" && (r.prompt || "").trim())) { try { await api.generateEpisode(project.id, ep.id); } catch { break; } } }} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500" title="Queue every picture and clip that is still missing, episode by episode">Render everything missing</button>
        )}
      </div>
      {onAddEpisode && (
        <button onClick={onAddEpisode} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-700/60 bg-emerald-600/10 px-3 py-2.5 text-sm text-emerald-200 transition hover:bg-emerald-600/20">
          <Plus size={15} /> Add the next episode (episode {(project.episodes[project.episodes.length - 1]?.number || 0) + 1})
        </button>
      )}
      {project.episodes.map((ep, i) => {
        const open = openEpisode === ep.id;
        const scenesDone = ep.scenes.filter(s => s.status === "done").length;
        const refsDone = ep.refs.filter(r => r.status === "done").length;
        const pct = ep.scenes.length ? (scenesDone / ep.scenes.length) * 100 : 0;
        return (
          <motion.div key={ep.id} layout
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.2) }}
            className="rounded-xl border border-neutral-800 bg-neutral-900/30 overflow-hidden">
            <div className="flex items-center gap-3 p-3">
              <button onClick={() => setOpenEpisode(open ? null : ep.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ type: "spring", stiffness: 400, damping: 25 }}>
                  <ChevronRight size={16} className="text-neutral-500" />
                </motion.span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-neutral-100">{ep.number}. {ep.title}</div>
                  <div className="truncate text-[11px] text-neutral-500">{ep.era}</div>
                </div>
              </button>
              <div className="hidden items-center gap-3 text-[11px] text-neutral-400 sm:flex">
                <span>refs {refsDone}/{ep.refs.length}</span>
                <span>scenes {scenesDone}/{ep.scenes.length}</span>
              </div>
              <div className="h-1.5 w-24 overflow-hidden rounded bg-neutral-800">
                <motion.div className="h-full rounded bg-gradient-to-r from-emerald-500 to-teal-400"
                  initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
              </div>
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => api.generateEpisode(project.id, ep.id)}
                className="rounded-lg bg-neutral-700 px-3 py-1.5 text-xs text-white hover:bg-neutral-600"
                title="Queue every reference and scene this episode still needs">
                Render what's missing
              </motion.button>
            </div>

            <AnimatePresence initial={false}>
              {open && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="grid gap-3 border-t border-neutral-800 p-3 lg:grid-cols-[300px_1fr]">
                    <div className="space-y-2">
                      <h4 className="text-[11px] uppercase tracking-wide text-neutral-500">References</h4>
                      <AnimatePresence initial={false}>
                        {ep.refs.map(r => <RefCard key={r.id} project={project} episode={ep} ref_={r} running={running} onChanged={onChanged} />)}
                      </AnimatePresence>
                      <RefDrop project={project} episodeId={ep.id} onChanged={onChanged} compact />
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-[11px] uppercase tracking-wide text-neutral-500">Scenes{onlyTodo ? " that need work" : ""}</h4>
                      {onlyTodo && !ep.scenes.some(s => s.status !== "done") && <p className="text-xs text-emerald-300">All clips of this episode are done.</p>}
                      {[...ep.scenes].sort((a, b) => a.number - b.number).filter(s => !onlyTodo || s.status !== "done").map(s => (
                        <SceneCard key={s.id} project={project} episode={ep} scene={s} running={running} onChanged={onChanged} />
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}
