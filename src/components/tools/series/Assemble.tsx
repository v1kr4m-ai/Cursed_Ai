import React from "react";
import { Scissors, Loader2, FolderOpen, CheckCircle2, Circle } from "lucide-react";
import { api, fileUrl, type Episode, type Project } from "./api";
import { SubtitlesPanel } from "./Subtitles";
import { notify, notifyError } from "../../../lib/notify";

/**
 * Stage 3. Join each episode's finished scenes into one file with ffmpeg, and show the checklist
 * of what still blocks that.
 */

function Check({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      {done ? <CheckCircle2 size={14} className="text-emerald-400 shrink-0" /> : <Circle size={14} className="text-neutral-600 shrink-0" />}
      <span className={done ? "text-neutral-400" : "text-neutral-300"}>{children}</span>
    </li>
  );
}

function EpisodeRow({ project, episode, onChanged }: { project: Project; episode: Episode; onChanged: (p: Project) => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const ordered = [...episode.scenes].sort((a, b) => a.number - b.number);
  const done = ordered.filter(s => s.status === "done" && s.clipPath);
  const ready = ordered.length > 0 && done.length === ordered.length;
  const total = done.reduce((n, s) => n + (s.durationS || 0), 0);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.get(project.id));
      await api.stitch(project.id, episode.id);
      onChanged(await api.get(project.id));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-neutral-100">{episode.number}. {episode.title}</div>
          <div className="text-[11px] text-neutral-500">
            {done.length}/{ordered.length} scenes rendered{total ? ` - ${total.toFixed(1)}s total` : ""}
          </div>
        </div>
        <button
          onClick={run}
          disabled={!ready || busy}
          className="flex items-center gap-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-40 disabled:hover:bg-emerald-600/80 px-3 py-2 text-xs font-medium text-white"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
          {episode.exportPath ? "Join again" : "Join into one file"}
        </button>
      </div>

      <ul className="space-y-1">
        <Check done={episode.refs.length > 0 && episode.refs.every(r => r.status === "done")}>
          References rendered ({episode.refs.filter(r => r.status === "done").length}/{episode.refs.length})
        </Check>
        <Check done={ready}>All scenes rendered ({done.length}/{ordered.length})</Check>
        <Check done={!!episode.exportPath}>Episode joined</Check>
      </ul>

      {error && <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 p-2 text-[11px] text-rose-200">{error}</div>}

      {episode.exportPath && (
        <div className="space-y-2">
          <video src={fileUrl(episode.exportPath)} controls className="w-full max-h-[420px] rounded bg-black" />
          <div className="flex items-center gap-2 text-[11px] text-neutral-500">
            <FolderOpen size={12} />
            <span className="truncate">{episode.exportPath}</span>
          </div>
        </div>
      )}

      {episode.exportPath && <SubtitlesPanel project={project} episode={episode} onChanged={onChanged} />}
    </div>
  );
}

/** Subtitles for every joined episode that has none yet, then burned in with the default look. */
function SubtitleAll({ project, onChanged }: { project: Project; onChanged: (p: Project) => void }) {
  const [source, setSource] = React.useState("script");
  const [step, setStep] = React.useState("");
  const todo = project.episodes.filter(e => e.exportPath && !e.subtitles?.outPath);
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

export function Assemble({ project, onChanged }: { project: Project; onChanged: (p: Project) => void }) {
  if (!project.episodes.length) {
    return <div className="grid place-items-center h-full text-sm text-neutral-500">Nothing to assemble yet.</div>;
  }
  return (
    <div className="h-full overflow-y-auto space-y-3 pr-1">
      <p className="text-xs text-neutral-500">
        Scenes are normalised to {project.settings.width}x{project.settings.height} at {project.settings.fps} fps before joining, so clips rendered at different sizes still cut together.
      </p>
      <SubtitleAll project={project} onChanged={onChanged} />
      {project.episodes.map(ep => <EpisodeRow key={ep.id} project={project} episode={ep} onChanged={onChanged} />)}
    </div>
  );
}
