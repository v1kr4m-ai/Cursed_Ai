import React from "react";
import { Star, FolderOpen, Download } from "lucide-react";
import { api, fileUrl, type Episode, type Output, type OutputKind, type Project } from "./api";
import { nativeFolder } from "../../comfy/types";
import { HoverVideo } from "./DashKit";
import { postJson } from "../../comfy/types";
import { notify, notifyError } from "../../../lib/notify";
import { pickFolder } from "../pickFolder";

export const KINDS: Record<OutputKind, { label: string; note: string; chip: string }> = {
  joined: { label: "Joined", note: "The scenes cut together - no subtitles, no added sound", chip: "bg-neutral-500 text-white" },
  subtitled: { label: "Subtitled", note: "Joined video with the subtitles burned in", chip: "bg-sky-500 text-white" },
  audio: { label: "With audio", note: "Joined video with your audio mixed in", chip: "bg-violet-500 text-white" },
  final: { label: "Subtitles + audio", note: "Subtitles burned in and your audio mixed in", chip: "bg-emerald-500 text-white" },
};

/** Every version of an episode's video, oldest first. The plain join is always the first. */
export function listOutputs(ep: Episode): Output[] {
  const list = [...(ep.outputs || [])].filter(o => o.path);
  if (ep.exportPath && !list.some(o => o.kind === "joined")) list.push({ kind: "joined", path: ep.exportPath, at: "" });
  if (ep.subtitles?.outPath && !list.some(o => o.kind === "subtitled")) list.push({ kind: "subtitled", path: ep.subtitles.outPath, at: "" });
  return list.sort((a, b) => a.at.localeCompare(b.at));
}
/** The pinned version, or the newest one. */
export function finalOutput(ep: Episode): Output | null {
  const list = listOutputs(ep);
  return (ep.finalKind && list.find(o => o.kind === ep.finalKind)) || list[list.length - 1] || null;
}
/** A version's address, changed whenever it is made again so players load the new file and not a cached one. */
export const outputUrl = (o: Output) => fileUrl(o.path) + (o.at ? "&v=" + encodeURIComponent(o.at) : "");
/** True when the scenes were joined again, or the subtitles or audio edited, after this version was rendered. */
export function outdated(ep: Episode, o: Output): boolean {
  if (!o.at) return false;
  const joined = ep.outputs?.find(x => x.kind === "joined");
  if (o.kind !== "joined" && joined?.at && joined.at > o.at) return true;
  const subs = (o.kind === "subtitled" || o.kind === "final") && !!ep.subtitles?.updatedAt && ep.subtitles.updatedAt > o.at;
  const aud = (o.kind === "audio" || o.kind === "final") && !!ep.audio?.updatedAt && ep.audio.updatedAt > o.at;
  return subs || aud;
}
/** Asks for a folder (Windows' own dialog), remembering the last one. Returns null when cancelled. */
export async function chooseExportFolder(): Promise<string | null> {
  let last = "";
  try { last = localStorage.getItem("cursed.series.exportDir") || ""; } catch { /* storage blocked */ }
  const picked = await pickFolder(last || undefined, "Export to which folder?");
  if (!picked) return null;
  try { localStorage.setItem("cursed.series.exportDir", picked); } catch { /* storage blocked */ }
  return picked;
}

const ago = (iso: string) => {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

/** The newest (or pinned) version in the middle, every other version as a marked thumbnail beside it. */
export function OutputStage({ project, episode, onChanged }: { project: Project; episode: Episode; onChanged: (p: Project) => void }) {
  const all = listOutputs(episode);
  const fin = finalOutput(episode);
  const newest = all[all.length - 1];
  const [picked, setPicked] = React.useState<OutputKind | null>(null);
  React.useEffect(() => { setPicked(null); }, [newest?.path]); // a new render takes the centre
  const shown = (picked && all.find(o => o.kind === picked)) || fin || newest;
  if (!shown) return null;
  const pinned = !!episode.finalKind && shown.kind === episode.finalKind;
  const exportThis = async () => {
    const dir = await chooseExportFolder();
    if (!dir) return;
    try {
      const r = await api.exportEpisodes(project.id, dir, { kind: shown.kind, episodeIds: [episode.id] });
      notify({ message: "Exported " + KINDS[shown.kind].label + " to " + r.dir, tab: "series" });
      postJson("/api/series/reveal-folder", { path: r.dir }).catch(() => {});
    } catch (e: any) { notifyError(e?.message || String(e), "series"); }
  };
  const pin = async (kind: OutputKind | null) => {
    try { onChanged(await api.pinFinal(project.id, episode.id, kind)); } catch (e: any) { notifyError(e?.message || String(e), "series"); }
  };
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className={"rounded-full px-2 py-0.5 font-semibold " + KINDS[shown.kind].chip}>{KINDS[shown.kind].label}</span>
          {shown === newest && all.length > 1 && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-600">Latest</span>}
          {fin && shown.path === fin.path && <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 font-semibold text-emerald-600"><Star size={10} className="fill-current" />{episode.finalKind ? "Final (pinned)" : "Final (newest)"}</span>}
          {outdated(episode, shown) && <span className="rounded-full bg-rose-500/20 px-2 py-0.5 font-semibold text-rose-600" title="The scenes were joined again, or the subtitles or audio changed, after this was rendered">Out of date - render again</span>}
          <span className="opacity-55">{KINDS[shown.kind].note}{shown.at ? " - " + ago(shown.at) : ""}</span>
        </div>
        <div className="flex justify-center rounded-xl bg-black/50 p-2">
          <video key={outputUrl(shown)} src={outputUrl(shown)} controls className="max-h-[360px] max-w-full rounded" />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {pinned
            ? <button onClick={() => pin(null)} className="rounded-md border border-neutral-700 px-2.5 py-1 hover:opacity-80">Unpin (use the newest)</button>
            : <button onClick={() => pin(shown.kind)} className="flex items-center gap-1 rounded-md bg-emerald-600/80 px-2.5 py-1 font-medium text-white hover:bg-emerald-600"><Star size={11} />Use this as the final</button>}
          <button onClick={exportThis} className="flex items-center gap-1 rounded-md border border-neutral-700 px-2.5 py-1 hover:opacity-80" title="Copy this version (and its .srt) to a folder"><Download size={11} />Export this version...</button>
          <button onClick={() => postJson("/api/series/reveal-folder", { path: shown.path.replace(/[\\/][^\\/]+$/, "") }).catch(() => {})} className="flex items-center gap-1 opacity-60 hover:opacity-100" title={shown.path}><FolderOpen size={12} />Show the file</button>
          <span className="truncate opacity-40">{shown.path.split(/[\\/]/).pop()}</span>
        </div>
      </div>

      {/* the other versions */}
      <div className="flex gap-2 md:max-h-[420px] md:flex-col md:overflow-y-auto md:pr-1">
        {[...all].reverse().map(o => {
          const on = o.path === shown.path;
          return (
            <button key={o.kind} onClick={() => setPicked(o.kind)} title={KINDS[o.kind].label + " - " + KINDS[o.kind].note}
              className={"group relative w-24 shrink-0 overflow-hidden rounded-lg border-2 text-left transition " + (on ? "border-sky-400" : "border-transparent opacity-80 hover:opacity-100")}>
              <HoverVideo src={outputUrl(o)} className="aspect-[9/14] w-full bg-black object-cover" />
              <span className={"absolute left-1 top-1 rounded px-1 py-0.5 text-[9px] font-bold " + KINDS[o.kind].chip}>{KINDS[o.kind].label}</span>
              {o === newest && <span className="absolute right-1 top-1 rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold text-white">NEW</span>}
              {fin && o.path === fin.path && <Star size={12} className="absolute bottom-1 right-1 fill-emerald-400 text-emerald-400 drop-shadow" />}
              {outdated(episode, o) && <span className="absolute inset-x-0 bottom-0 bg-rose-600/90 px-1 py-0.5 text-center text-[8px] font-bold text-white">OUT OF DATE</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
