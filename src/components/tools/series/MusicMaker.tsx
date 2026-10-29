import React from "react";
import { ChevronRight, Loader2, Music } from "lucide-react";
import { api, type Episode, type Project } from "./api";
import { notify, notifyError } from "../../../lib/notify";

interface Wf { name: string; path: string; isRunnable: boolean; fields: { id: string; input: string; node: string; kind: string }[]; promptNodeId: string | null }

const field = "w-full bg-transparent border border-neutral-700 rounded-md px-2 py-1 text-xs focus:outline-none focus:border-neutral-500";
const post = async (url: string, body: unknown) => { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Failed"); return d; };

/**
 * Music for one episode, made with an audio workflow from the Audio studio (a song workflow such as ACE-Step):
 * as long as the episode, styled by tags taken from the series (editable), instrumental unless words are given.
 * The finished file is added to the episode's audio tracks at `startAt`, ready to place and mix.
 */
export function MusicMaker({ project, episode, length, startAt, onChanged }: { project: Project; episode: Episode; length: number; startAt: number; onChanged: (p: Project) => void }) {
  const [open, setOpen] = React.useState(false);
  const [wfs, setWfs] = React.useState<Wf[] | null>(null);
  const [path, setPath] = React.useState("");
  const [tags, setTags] = React.useState(() => ["instrumental background music", project.idea?.tone, project.format === "ugc" || project.format === "vlog" ? "upbeat, light, modern" : "cinematic"].filter(Boolean).join(", "));
  const [lyrics, setLyrics] = React.useState("");
  const [seconds, setSeconds] = React.useState(Math.max(5, Math.round(length)));
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setSeconds(Math.max(5, Math.round(length))), [length]);

  React.useEffect(() => {
    if (!open || wfs) return;
    fetch("/api/tool/workflows?kind=audio").then(r => r.json()).then(d => {
      const list: Wf[] = (d.workflows || []).filter((w: Wf) => w.isRunnable && !w.name.startsWith("API_FORMAT/"));
      setWfs(list);
      setPath((list.find(w => w.fields.some(f => f.input === "seconds")) || list[0])?.path || "");
    }).catch(() => setWfs([]));
  }, [open, wfs]);

  const make = async () => {
    const wf = wfs?.find(w => w.path === path);
    if (!wf) return;
    setBusy(true); setNote("Starting...");
    try {
      const values: Record<string, unknown> = {};
      const sec = wf.fields.find(f => f.input === "seconds" || f.input === "duration");
      if (sec) values[sec.id] = seconds;
      const words = wf.fields.find(f => f.input === "lyrics" && f.node === wf.promptNodeId) || wf.fields.find(f => f.input === "lyrics");
      if (words) values[words.id] = lyrics.trim() || "[instrumental]";
      const slug = `${project.title}-ep${episode.number}-music`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const { runId } = await post("/api/tool/run", { kind: "audio", workflowPath: wf.path, promptText: tags, fieldValues: values, randomizeSeed: true, outputFilename: slug });
      let state: any = null;
      for (let i = 0; i < 900; i++) {
        await new Promise(r => setTimeout(r, 3000));
        state = (await (await fetch(`/api/tool/run-state?ids=${runId}`)).json()).runs[0];
        if (["done", "failed", "cancelled", "unknown"].includes(state.status)) break;
        setNote(state.status === "running" ? "Making the music..." : "Waiting for ComfyUI...");
      }
      if (state?.status !== "done" || !state.result) throw new Error(state?.error || "The music was not made.");
      setNote("Adding it to the episode...");
      const blob = await (await fetch(`/api/tool/file?path=${encodeURIComponent(state.result)}`)).blob();
      const name = String(state.result).split(/[\\/]/).pop() || "music.mp3";
      onChanged(await api.uploadAudio(project.id, episode.id, new File([blob], name, { type: blob.type || "audio/mpeg" }), startAt));
      setNote(`Added "${name}" - drag it on the timeline, set its volume and fades, then Mix into the video.`);
      notify({ message: `Music made for episode ${episode.number}`, tab: "series" });
    } catch (e: any) { setNote(""); notifyError(e?.message || String(e), "series"); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-neutral-800">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-neutral-200">
        <ChevronRight size={13} className={`transition-transform ${open ? "rotate-90" : ""}`} /><Music size={13} className="text-teal-400" />Make music for this episode
        <span className="ml-auto text-[10px] opacity-50">with an Audio studio workflow</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-neutral-800 p-3 text-xs">
          {wfs === null ? <p className="flex items-center gap-1.5 opacity-60"><Loader2 size={12} className="animate-spin" />Looking for audio workflows...</p>
            : !wfs.length ? <p className="opacity-60">No audio workflow that can run was found. Add one (for example a text-to-song workflow) to ComfyUI's workflow folder; the Audio tab uses the same ones.</p>
            : <>
              <label className="block space-y-1"><span className="opacity-60">Workflow</span>
                <select value={path} onChange={e => setPath(e.target.value)} className={`${field} [&_*]:bg-white [&_*]:text-black`}>{wfs.map(w => <option key={w.path} value={w.path}>{w.name}</option>)}</select></label>
              <label className="block space-y-1"><span className="opacity-60">Style (tags: genre, mood, instruments, tempo)</span>
                <input value={tags} onChange={e => setTags(e.target.value)} className={field} /></label>
              <label className="block space-y-1"><span className="opacity-60">Words to sing (empty = instrumental)</span>
                <textarea value={lyrics} onChange={e => setLyrics(e.target.value)} rows={3} placeholder="[verse] the words, one line per sung line" className={`${field} resize-y font-mono`} /></label>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5"><span className="opacity-60">Length</span><input type="number" min={5} max={600} value={seconds} onChange={e => setSeconds(Number(e.target.value) || 5)} className={`${field} w-20`} /><span className="opacity-60">s (the episode is {Math.round(length)} s)</span></label>
                <button onClick={make} disabled={busy || !path || !tags.trim()} className="ml-auto flex items-center gap-1.5 rounded-md bg-teal-600/80 px-3 py-1.5 font-medium text-white hover:bg-teal-600 disabled:opacity-40">{busy ? <Loader2 size={13} className="animate-spin" /> : <Music size={13} />}Make music</button>
              </div>
              {note && <p className="opacity-70">{note}</p>}
            </>}
        </div>
      )}
    </div>
  );
}
