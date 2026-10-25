import React from "react";
import { Scissors, Loader2, ChevronDown, Download, Film } from "lucide-react";
import { api, fileUrl, type Episode, type ExportKind, type Project } from "./api";
import { SubtitlesPanel } from "./Subtitles";
import { AudioPanel } from "./AudioPanel";
import { OutputStage, KINDS, finalOutput, listOutputs, chooseExportFolder } from "./Outputs";
import { HoverVideo } from "./DashKit";
import { markSeen, useSeen } from "./seen";
import { itemLabel } from "./groups";
import { notify, notifyError } from "../../../lib/notify";
import { postJson } from "../../comfy/types";

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
  const { isNew } = useSeen(project.id);
  const fresh = isNew(fin?.path) || isNew(episode.exportPath);
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
      <div role="button" tabIndex={0} onClick={() => { if (!open) markSeen(project.id, fin?.path, episode.exportPath, ...(episode.outputs || []).map(o => o.path)); onToggle(); }} onKeyDown={e => (e.key === "Enter" || e.key === " ") && onToggle()} className="flex cursor-pointer items-center gap-3 p-3">
        <ChevronDown size={16} className={"shrink-0 opacity-60 transition-transform " + (open ? "" : "-rotate-90")} />
        {fin ? <HoverVideo src={fileUrl(fin.path)} className="h-12 w-8 shrink-0 rounded bg-black object-cover" /> : <div className="h-12 w-8 shrink-0 rounded bg-current/10" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-sm font-medium text-neutral-100"><span className="truncate">{episode.number}. {itemLabel(project, episode) && <span className="text-amber-200/70">{itemLabel(project, episode)} - </span>}{episode.title}</span>{fresh && <span className="rounded-full bg-amber-400 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-black">New</span>}</div>
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

const EXPORT_KINDS: { kind: ExportKind; label: string; note: string }[] = [
  { kind: "joined", label: "Raw", note: "the plain joined videos" },
  { kind: "subtitled", label: "Subtitled", note: "subtitles burned in" },
  { kind: "audio", label: "Music added", note: "your audio mixed in" },
  { kind: "final", label: "Subtitles + music", note: "both" },
  { kind: "best", label: "Best version of each", note: "the pinned (or newest) one" },
];

/** At the end of the page: copy every joined episode to a folder, or cut them all into one master video. A drop-up picks the version. */
function ExportAll({ project }: { project: Project }) {
  const [menu, setMenu] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const [done, setDone] = React.useState<{ dir: string; text: string } | null>(null);
  const joined = project.episodes.filter(e => e.exportPath);
  if (!joined.length) return null;
  const have = (kind: ExportKind) => joined.filter(e => kind === "best" || kind === "joined" ? true : listOutputs(e).some(o => o.kind === kind)).length;

  async function go(master: boolean, kind: ExportKind) {
    setMenu(false);
    const dir = await chooseExportFolder();
    if (!dir) return;
    const label = EXPORT_KINDS.find(k => k.kind === kind)!.label.toLowerCase();
    setBusy(master ? "Joining the master video..." : "Copying...");
    try {
      if (master) {
        const r = await api.masterVideo(project.id, dir, kind);
        setDone({ dir: r.dir, text: `Master video (${label}) - ${r.episodes} episode${r.episodes === 1 ? "" : "s"}${r.skipped.length ? `, skipped ${r.skipped.length} without that version` : ""}` });
      } else {
        const r = await api.exportEpisodes(project.id, dir, { kind });
        setDone({ dir: r.dir, text: `Exported ${r.episodes} episode${r.episodes === 1 ? "" : "s"} (${label})${r.skipped.length ? `, skipped ${r.skipped.length} without that version` : ""}` });
      }
      notify({ message: master ? "Master video saved" : "Episodes exported", tab: "series" });
    } catch (e: any) { notifyError(e?.message || String(e), "series"); }
    finally { setBusy(""); }
  }

  const item = "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-left hover:bg-white/10";
  return (
    <div className="relative flex flex-wrap items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/30 p-3 text-xs">
      <div className="relative">
        <button onClick={() => setMenu(m => !m)} disabled={!!busy} className="flex items-center gap-2 rounded-lg bg-emerald-600/80 px-4 py-2 font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}{busy || `Export ${joined.length} joined`}<ChevronDown size={13} className={"transition-transform " + (menu ? "" : "rotate-180")} />
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
            <div className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-2xl border bg-zinc-900 p-1.5 text-white shadow-2xl">
              <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-50">Export every episode as</p>
              {EXPORT_KINDS.map(k => (
                <button key={k.kind} onClick={() => go(false, k.kind)} disabled={!have(k.kind)} className={item + " disabled:opacity-35"}>
                  <span>{k.label}<span className="block text-[10px] opacity-50">{k.note}</span></span><span className="text-[10px] opacity-60">{have(k.kind)}/{joined.length}</span>
                </button>
              ))}
              <div className="my-1 border-t border-white/10" />
              <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-50">Master video - all in one file</p>
              {EXPORT_KINDS.map(k => (
                <button key={"m" + k.kind} onClick={() => go(true, k.kind)} disabled={!have(k.kind)} className={item + " disabled:opacity-35"}>
                  <span className="flex items-center gap-2"><Film size={12} className="opacity-60" />Master - {k.label.toLowerCase()}</span><span className="text-[10px] opacity-60">{have(k.kind)}/{joined.length}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {done ? (
        <span className="flex min-w-0 items-center gap-2"><span className="opacity-70">{done.text}</span><button onClick={() => postJson("/api/series/reveal-folder", { path: done.dir }).catch(() => {})} className="truncate text-sky-400 hover:underline" title="Open the folder">{done.dir}</button></span>
      ) : <span className="opacity-55">Numbered files with an .srt beside each, plus a series.json - or one master video of the whole series.</span>}
    </div>
  );
}

export function Assemble({ project, onChanged }: { project: Project; onChanged: (p: Project) => void }) {
  // Rows start folded (the first one open when there is only a handful); the choice is remembered.
  const [openIds, setOpenIds] = React.useState<string[]>(() => readOpen() ?? (project.episodes.length <= 1 ? project.episodes.map(e => e.id) : []));
  const setOpen = (ids: string[]) => { setOpenIds(ids); try { localStorage.setItem(OPEN_KEY, JSON.stringify(ids)); } catch { /* storage blocked */ } };
  const [joining, setJoining] = React.useState("");
  if (!project.episodes.length) {
    return <div className="grid place-items-center h-full text-sm text-neutral-500">Nothing to assemble yet.</div>;
  }
  const eps = project.episodes;
  const rendered = eps.filter(e => e.scenes.length > 0 && e.scenes.every(sc => sc.status === "done" && sc.clipPath));
  const joinable = rendered.filter(e => !e.exportPath);
  const joined = eps.filter(e => !!e.exportPath);
  const joinAll = async () => {
    try {
      for (const [i, e] of joinable.entries()) { setJoining(`Joining ${i + 1} of ${joinable.length}...`); await api.stitch(project.id, e.id); }
      onChanged(await api.get(project.id));
    } catch (err: any) { notifyError(err?.message || String(err), "series"); }
    finally { setJoining(""); }
  };
  const next = rendered.length < eps.length ? `${eps.length - rendered.length} episode${eps.length - rendered.length === 1 ? " is" : "s are"} not fully rendered yet - finish them in Produce.` : joinable.length ? `${joinable.length} episode${joinable.length === 1 ? " is" : "s are"} ready to join.` : joined.length === eps.length ? "All joined. Add subtitles or music per episode, then export at the bottom." : "";
  return (
    <div className="h-full overflow-y-auto space-y-3 pr-1">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-neutral-100">{rendered.length} of {eps.length} rendered - {joined.length} joined</div>
          <div className="text-[11px] text-neutral-500">{next}</div>
        </div>
        {joinable.length > 0 && <button onClick={joinAll} disabled={!!joining} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60">{joining ? <Loader2 size={13} className="animate-spin" /> : <Scissors size={13} />}{joining || `Join ${joinable.length} ready episode${joinable.length === 1 ? "" : "s"}`}</button>}
      </div>
      <p className="text-xs text-neutral-500">
        Scenes are normalised to {project.settings.width}x{project.settings.height} at {project.settings.fps} fps before joining, so clips rendered at different sizes still cut together.
      </p>
      <SubtitleAll project={project} onChanged={onChanged} />
      <div className="flex items-center gap-2 text-[11px] text-neutral-500">
        <button onClick={() => setOpen(project.episodes.map(e => e.id))} className="hover:text-neutral-300">Open all</button>
        <span>-</span>
        <button onClick={() => setOpen([])} className="hover:text-neutral-300">Close all</button>
      </div>
      {project.episodes.map((ep, i) => (
        <React.Fragment key={ep.id}>
          {!!ep.group && ep.group !== (project.episodes[i - 1]?.group || "") && <div className="px-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300/80">{ep.group}</div>}
          <EpisodeRow project={project} episode={ep} onChanged={onChanged} open={openIds.includes(ep.id)} onToggle={() => setOpen(openIds.includes(ep.id) ? openIds.filter(x => x !== ep.id) : [...openIds, ep.id])} />
        </React.Fragment>
      ))}
      <ExportAll project={project} />
    </div>
  );
}
