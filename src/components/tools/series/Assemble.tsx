import React from "react";
import { Scissors, Loader2, FolderOpen, ChevronDown } from "lucide-react";
import { api, fileUrl, type Episode, type Project } from "./api";
import { SubtitlesPanel } from "./Subtitles";
import { AudioPanel } from "./AudioPanel";
import { OutputStage, KINDS, finalOutput, listOutputs } from "./Outputs";
import { HoverVideo } from "./DashKit";
import { notify, notifyError } from "../../../lib/notify";
import { nativeFolder, postJson } from "../../comfy/types";

/**
 * Stage 3. Join each episode's finished scenes into one file with ffmpeg, and show the checklist
 * of what still blocks that.
 */

const OPEN_KEY = "cursed.series.assembleOpen";
const readOpen = (): string[] | null => { try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) || "null"); return Array.isArray(v) ? v : null; } catch { return null; } };

function Chip({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <span className={"rounded-full px-2 py-0.5 text-[10px] " + (on ? "bg-emerald-500/20 text-emerald-600" : "bg-current/10 opacity-55")}>{on ? "\u2713 " : ""}{children}</span>;
}

function EpisodeRow({ project, episode, onChanged, open, onToggle }: { project: Project; episode: Episode; onChanged: (p: Project) => void; open: boolean; onToggle: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<"subtitles" | "audio">("subtitles");

  const ordered = [...episode.scenes].sort((a, b) => a.number - b.number);
  const done = ordered.filter(s => s.status === "done" && s.clipPath);
  const ready = ordered.length > 0 && done.length === ordered.length;
  const total = done.reduce((n, s) => n + (s.durationS || 0), 0);
  const fin = finalOutput(episode);
  const made = listOutputs(episode).map(o => o.kind);

  async function run(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.get(project.id));
      await api.stitch(project.id, episode.id);
      onChanged(await api.get(project.id));
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/30">
      <div role="button" tabIndex={0} onClick={onToggle} onKeyDown={e => (e.key === "Enter" || e.key === " ") && onToggle()} className="flex cursor-pointer items-center gap-3 p-3">
        <ChevronDown size={16} className={"shrink-0 opacity-60 transition-transform " + (open ? "" : "-rotate-90")} />
        {fin ? <HoverVideo src={fileUrl(fin.path)} className="h-12 w-8 shrink-0 rounded bg-black object-cover" /> : <div className="h-12 w-8 shrink-0 rounded bg-current/10" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-neutral-100">{episode.number}. {episode.title}</div>
          <div className="text-[11px] text-neutral-500">{done.length}/{ordered.length} scenes rendered{total ? ` - ${total.toFixed(1)}s total` : ""}</div>
          <div className="mt-1 flex flex-wrap gap-1"><Chip on={ready}>Rendered</Chip><Chip on={!!episode.exportPath}>Joined</Chip><Chip on={made.includes("subtitled") || made.includes("final")}>Subtitled</Chip><Chip on={made.includes("audio") || made.includes("final")}>Audio</Chip>{fin && <span className={"rounded-full px-2 py-0.5 text-[10px] font-semibold " + KINDS[fin.kind].chip}>Final: {KINDS[fin.kind].label}</span>}</div>
        </div>
        <button onClick={run} disabled={!ready || busy} className="flex shrink-0 items-center gap-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-40 disabled:hover:bg-emerald-600/80 px-3 py-2 text-xs font-medium text-white">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
          {episode.exportPath ? "Join again" : "Join into one file"}
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-neutral-800 p-3">
          {error && <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 p-2 text-[11px] text-rose-200">{error}</div>}
          {!episode.exportPath && <p className="text-xs text-neutral-500">{ready ? "Press Join to cut the scenes into one video." : "Render every scene first, then join them."}</p>}
          {episode.exportPath && <OutputStage project={project} episode={episode} onChanged={onChanged} />}
          {episode.exportPath && (
            <div className="space-y-2">
              <div className="flex gap-1 border-b border-neutral-800 text-xs">
                {([["subtitles", "Subtitles"], ["audio", "Audio"]] as const).map(([id, label]) => (
                  <button key={id} onClick={() => setTab(id)} className={"relative px-3 py-1.5 " + (tab === id ? "font-semibold" : "opacity-55 hover:opacity-100")}>
                    {label}{id === "audio" && !!episode.audio?.tracks.length && <span className="ml-1 rounded-full bg-violet-500/30 px-1.5 text-[9px]">{episode.audio.tracks.length}</span>}
                    {tab === id && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-sky-400" />}
                  </button>
                ))}
              </div>
              {tab === "subtitles"
                ? <SubtitlesPanel project={project} episode={episode} onChanged={onChanged} />
                : <AudioPanel project={project} episode={episode} onChanged={onChanged} wantSubtitles={!!episode.subtitles?.cues.length} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Subtitles for every joined episode that has none yet, then burned in with the default look. */
function SubtitleAll({ project, onChanged }: { project: Project; onChanged: (p: Project) => void }) {
  const [source, setSource] = React.useState("script");
  const [step, setStep] = React.useState("");
  const todo = project.episodes.filter(e => e.exportPath && !listOutputs(e).some(o => o.kind === "subtitled" || o.kind === "final"));
  async function run() {
    try {
      for (let i = 0; i < todo.length; i++) {
        const e = todo[i];
        setStep(`Episode ${e.number} (${i + 1}/${todo.length}): ${e.subtitles?.cues.length ? "burning" : "listening"}...`);
        if (!e.subtitles?.cues.length) onChanged(await api.generateSubtitles(project.id, e.id, source));
        setStep(`Episode ${e.number} (${i + 1}/${todo.length}): burning in...`);
        onChanged(await api.burnSubtitles(project.id, e.id));
      }
      notify({ message: `Subtitled ${todo.length} episode${todo.length === 1 ? "" : "s"}`, tab: "series" });
    } catch (e: any) { notifyError(e?.message || String(e), "series"); }
    finally { setStep(""); }
  }
  if (!project.episodes.some(e => e.exportPath)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/30 p-3 text-xs">
      <span className="font-medium">Subtitle every joined episode</span>
      <select value={source} onChange={e => setSource(e.target.value)} disabled={!!step} className="bg-transparent border border-neutral-700 rounded-md px-2 py-1 [&_*]:bg-white [&_*]:text-black">
        <option value="script">From the script</option><option value="offline">Offline (Whisper)</option><option value="online">Online (Gemini)</option>
      </select>
      <button onClick={run} disabled={!!step || !todo.length} className="flex items-center gap-1.5 rounded-md bg-sky-600/80 hover:bg-sky-600 disabled:opacity-40 px-3 py-1.5 font-medium text-white">
        {step ? <Loader2 size={13} className="animate-spin" /> : null}{step || (todo.length ? `Do the ${todo.length} without subtitles` : "All done")}
      </button>
      <span className="opacity-55">Uses each episode's saved look; fix any line afterwards in its own panel and burn again.</span>
    </div>
  );
}

/** Copies the joined episodes (subtitled copies when they exist) to a folder, with .srt files and a series.json. */
function ExportBar({ project }: { project: Project }) {
  const [busy, setBusy] = React.useState(false);
  const [subtitled, setSubtitled] = React.useState(true);
  const [done, setDone] = React.useState<{ dir: string; episodes: number } | null>(null);
  const last = (() => { try { return localStorage.getItem("cursed.series.exportDir") || ""; } catch { return ""; } })();
  const joined = project.episodes.filter(e => e.exportPath).length;
  if (!joined) return null;
  async function run() {
    const picked = await nativeFolder(last || undefined);
    if (typeof picked !== "string") { if (picked === undefined) notifyError("The folder picker is not available - type a folder in config.", "series"); return; }
    setBusy(true);
    try {
      const r = await api.exportEpisodes(project.id, picked, subtitled);
      try { localStorage.setItem("cursed.series.exportDir", picked); } catch { /* storage blocked */ }
      setDone({ dir: r.dir, episodes: r.episodes });
      notify({ message: `Exported ${r.episodes} episode${r.episodes === 1 ? "" : "s"}`, tab: "series" });
    } catch (e: any) { notifyError(e?.message || String(e), "series"); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/30 p-3 text-xs">
      <span className="font-medium">Export finished episodes</span>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={subtitled} onChange={e => setSubtitled(e.target.checked)} className="accent-sky-500" />Use the final version (pinned, or the newest) rather than the plain join</label>
      <button onClick={run} disabled={busy} className="flex items-center gap-1.5 rounded-md bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-40 px-3 py-1.5 font-medium text-white">{busy ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />}Export {joined} to a folder...</button>
      {done && <button onClick={() => postJson("/api/series/reveal-folder", { path: done.dir }).catch(() => {})} className="truncate text-sky-400 hover:underline" title="Open the folder">{done.dir}</button>}
      <span className="opacity-55">Numbered file names, an .srt next to each video, and a series.json.</span>
    </div>
  );
}

export function Assemble({ project, onChanged }: { project: Project; onChanged: (p: Project) => void }) {
  // Rows start folded (the first one open when there is only a handful); the choice is remembered.
  const [openIds, setOpenIds] = React.useState<string[]>(() => readOpen() ?? (project.episodes.length <= 1 ? project.episodes.map(e => e.id) : []));
  const setOpen = (ids: string[]) => { setOpenIds(ids); try { localStorage.setItem(OPEN_KEY, JSON.stringify(ids)); } catch { /* storage blocked */ } };
  if (!project.episodes.length) {
    return <div className="grid place-items-center h-full text-sm text-neutral-500">Nothing to assemble yet.</div>;
  }
  return (
    <div className="h-full overflow-y-auto space-y-3 pr-1">
      <p className="text-xs text-neutral-500">
        Scenes are normalised to {project.settings.width}x{project.settings.height} at {project.settings.fps} fps before joining, so clips rendered at different sizes still cut together.
      </p>
      <SubtitleAll project={project} onChanged={onChanged} />
      <ExportBar project={project} />
      <div className="flex items-center gap-2 text-[11px] text-neutral-500">
        <button onClick={() => setOpen(project.episodes.map(e => e.id))} className="hover:text-neutral-300">Open all</button>
        <span>-</span>
        <button onClick={() => setOpen([])} className="hover:text-neutral-300">Close all</button>
      </div>
      {project.episodes.map(ep => <EpisodeRow key={ep.id} project={project} episode={ep} onChanged={onChanged} open={openIds.includes(ep.id)} onToggle={() => setOpen(openIds.includes(ep.id) ? openIds.filter(x => x !== ep.id) : [...openIds, ep.id])} />)}
    </div>
  );
}
