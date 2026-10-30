import React from "react";
import { Clapperboard, Loader2 } from "lucide-react";
import { api, type Project, type ProjectSummary } from "../tools/series/api";
import { REF_KINDS, type RefKind } from "../../../seriesTool/refKinds";
import { notify, notifyError } from "../../lib/notify";
import { fileUrl } from "./types";

const field = "w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-zinc-200 focus:outline-none [&_option]:bg-white [&_option]:text-black";

/**
 * Sends a finished picture to a series as a reference photo of one of its episodes: a face from an expression
 * sheet, an outfit, a location. It lands done, exactly like a picture dropped on the Develop tab.
 * An `audio` file is added to the episode's audio tracks instead (from the start, ready to place and mix), and a
 * `video` becomes one scene's clip in place of rendering it.
 */
export function SendToSeries({ path, className, mode = "image" }: { path: string; className: string; mode?: "image" | "audio" | "video" }) {
  const audio = mode === "audio", video = mode === "video";
  const [open, setOpen] = React.useState(false);
  const [list, setList] = React.useState<ProjectSummary[] | null>(null);
  const [project, setProject] = React.useState<Project | null>(null);
  const [episodeId, setEpisodeId] = React.useState("");
  const [sceneId, setSceneId] = React.useState("");
  const [kind, setKind] = React.useState<RefKind>("person");
  const [label, setLabel] = React.useState("");
  const [person, setPerson] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open && !list) api.list().then(d => setList(d.projects)).catch(() => setList([]));
  }, [open, list]);

  const pick = async (id: string) => {
    setProject(null);
    if (!id) return;
    const p = await api.get(id);
    setProject(p);
    setEpisodeId(p.episodes[0]?.id || "");
    setSceneId(p.episodes[0]?.scenes[0]?.id || "");
  };
  const scenes = project?.episodes.find(e => e.id === episodeId)?.scenes || [];
  const people = project ? [...new Set(project.episodes.flatMap(e => e.refs.map(r => r.person).filter((x): x is string => !!x)))] : [];

  const send = async () => {
    if (!project || !episodeId) return;
    setBusy(true);
    try {
      // `path` is a file on disk, or a URL the app already serves (the quick studios show gallery URLs).
      const blob = await (await fetch(/^(\/api\/|https?:|blob:)/.test(path) ? path : fileUrl(path))).blob();
      const name = decodeURIComponent(path.split("?")[0].split(/[\\/]/).pop() || "") ||(audio ? "audio.mp3" : "picture.png");
      if (video) {
        await api.uploadClip(project.id, sceneId, new File([blob], name, { type: "video/mp4" }));
        notify({ message: `Clip set for "${project.title}"`, tab: "series" });
        setOpen(false);
        return;
      }
      if (audio) {
        await api.uploadAudio(project.id, episodeId, new File([blob], name, { type: blob.type || "audio/mpeg" }), 0);
        notify({ message: `Added to "${project.title}" as an audio track`, tab: "series" });
        setOpen(false);
        return;
      }
      const info = REF_KINDS.find(k => k.id === kind)!;
      await api.uploadRef(project.id, episodeId, new File([blob], name, { type: blob.type || "image/png" }), label.trim() || person.trim() || name.replace(/\.[^.]+$/, ""), info.role, kind, kind === "person" ? person.trim() : undefined);
      notify({ message: `Added to "${project.title}" as ${info.label.toLowerCase()}`, tab: "series" });
      setOpen(false);
    } catch (e: any) { notifyError(e?.message || String(e), mode); }
    finally { setBusy(false); }
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} title={video ? "Use this as a scene's clip in a series" : audio ? "Add this to an episode's audio tracks" : "Add this picture to a series as a reference photo"} className={className}><Clapperboard size={13} /> Series</button>
      {open && (
        <div className="absolute bottom-full right-0 z-30 mb-2 w-72 space-y-2 rounded-xl border border-white/10 bg-zinc-950 p-3 shadow-2xl">
          {list === null ? <p className="flex items-center gap-1.5 text-[11px] text-zinc-500"><Loader2 size={12} className="animate-spin" />Loading series...</p>
            : !list.length ? <p className="text-[11px] text-zinc-500">No series yet. Make one in the Series tab first.</p>
            : <>
              <select defaultValue="" onChange={e => pick(e.target.value)} className={field}>
                <option value="">Pick a series...</option>
                {list.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
              {project && <>
                {project.episodes.length > 1 && <select value={episodeId} onChange={e => { setEpisodeId(e.target.value); setSceneId(project.episodes.find(x => x.id === e.target.value)?.scenes[0]?.id || ""); }} className={field}>
                  {project.episodes.map(e => <option key={e.id} value={e.id}>Episode {e.number}{e.title ? `: ${e.title}` : ""}</option>)}
                </select>}
                {video && (scenes.length ? <select value={sceneId} onChange={e => setSceneId(e.target.value)} className={field}>
                  {scenes.map(sc => <option key={sc.id} value={sc.id}>Scene {sc.number}{sc.clipPath ? " (replaces its clip)" : ""}{sc.vo ? `: ${sc.vo.slice(0, 40)}` : ""}</option>)}
                </select> : <p className="text-[11px] text-zinc-500">This episode has no scenes yet.</p>)}
                {mode === "image" && <>
                <select value={kind} onChange={e => setKind(e.target.value as RefKind)} className={field}>
                  {REF_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
                {kind === "person" && <>
                  <input value={person} onChange={e => setPerson(e.target.value)} list="send-series-people" placeholder="Who is it? (a character's name)" className={field} />
                  <datalist id="send-series-people">{people.map(n => <option key={n} value={n} />)}</datalist>
                </>}
                <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Name of the picture (optional)" className={field} />
                </>}
                <button onClick={send} disabled={busy || !episodeId || (video && !sceneId)} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/10 py-1.5 text-[11px] font-bold text-white hover:bg-white/15 disabled:opacity-40">{busy && <Loader2 size={12} className="animate-spin" />}{video ? "Use as the scene's clip" : audio ? "Add to the episode's audio" : "Add to series"}</button>
              </>}
            </>}
        </div>
      )}
    </div>
  );
}
