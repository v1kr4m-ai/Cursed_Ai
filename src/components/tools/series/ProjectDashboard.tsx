import React from "react";
import { motion } from "motion/react";
import { ArrowUpRight, CircleDot, Film, Image as ImageIcon, LayoutGrid, Loader2, MessagesSquare, Play, Scissors, Settings2, Square, Timer } from "lucide-react";
import { notify, notifyError } from "../../../lib/notify";
import { api, fileUrl, type Project, type Scene } from "./api";
import { Ring, Tile, TileBoard, HoverVideo, hours, PageTitle, type TileDef } from "./DashKit";

export type DashStage = "develop" | "produce" | "assemble" | "settings";
type Go = (stage: DashStage, episodeId?: string) => void;
/** Where each card starts on the 24-column board (rows are 12 px). */
const TILE_DEFS: TileDef[] = [
  { id: "hero", title: "Series", x: 0, y: 0, w: 6, h: 30 },
  { id: "episodes", title: "Episodes at work", x: 6, y: 0, w: 8, h: 15 },
  { id: "progress", title: "Progress", x: 14, y: 0, w: 6, h: 15 },
  { id: "queue", title: "Render queue", x: 20, y: 0, w: 4, h: 15 },
  { id: "glance", title: "Episodes at a glance", x: 6, y: 15, w: 12, h: 15 },
  { id: "pipeline", title: "Pipeline", x: 18, y: 15, w: 6, h: 15 },
  { id: "engine", title: "Render engine", x: 0, y: 30, w: 6, h: 12 },
  { id: "estimate", title: "Time left to render", x: 6, y: 30, w: 6, h: 12 },
  { id: "clips", title: "Latest clips", x: 12, y: 30, w: 12, h: 24 },
  { id: "joined", title: "Stitched episodes", x: 0, y: 42, w: 12, h: 24 },
  { id: "refs", title: "Cast & references", x: 12, y: 54, w: 12, h: 24 },
];

const SCENE_COLOR: Record<Scene["status"], string> = {
  done: "bg-emerald-500", running: "bg-sky-500 animate-pulse", queued: "bg-amber-500", failed: "bg-rose-500", pending: "bg-current/15",
};

/**
 * The board you land on when a series is open: where it stands, what is rendering, what is next - every card opens the part
 * of the studio it summarises.
 */
export function ProjectDashboard({ project, onGo }: { project: Project; onGo: Go }) {
  const [comfy, setComfy] = React.useState<{ comfyUp: boolean; comfyUrl: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    const load = () => api.comfyStatus().then(s => live && setComfy(s)).catch(() => live && setComfy(null));
    load(); const t = setInterval(load, 10000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const eps = project.episodes;
  const scenes = eps.flatMap(e => e.scenes);
  const refs = eps.flatMap(e => e.refs);
  const count = (s: Scene["status"]) => scenes.filter(x => x.status === s).length;
  const scenesDone = count("done"), queued = count("queued") + count("running"), failed = count("failed");
  const refsDone = refs.filter(r => r.status === "done" && r.file).length;
  const joined = eps.filter(e => e.exportPath).length;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const overall = pct(scenesDone, scenes.length);
  const remaining = scenes.length - scenesDone;
  const missing = remaining + (refs.length - refsDone);
  const w = project.settings.width, h = project.settings.height, secs = project.settings.seconds;
  // Measured here: ~30 min per 7 s clip at 544x928; cost scales with pixels and length.
  const perClip = 30 * ((w * h) / (544 * 928)) * (secs / 7);
  const running = project.running;
  const runPct = running?.progress ? (running.progress[0] / Math.max(1, running.progress[1])) * 100 : null;
  const working = !!running || queued > 0;

  const next: { label: string; stage: DashStage } = !eps.length ? { label: project.sources?.length || project.idea.logline || project.discussion.length ? "Build the plan" : "Start with the idea", stage: "develop" }
    : remaining > 0 ? { label: "Open the board", stage: "produce" }
    : joined < eps.length ? { label: "Join the episodes", stage: "assemble" } : { label: "Review the episodes", stage: "assemble" };

  /** Queue every reference still and scene that is not done yet, episode by episode. */
  async function renderMissing() {
    setBusy(true);
    try {
      let total = 0;
      for (const ep of eps) total += (await api.generateEpisode(project.id, ep.id, false)).queued;
      notify({ message: total ? `Queued ${total} render job${total === 1 ? "" : "s"}` : "Nothing is missing", tab: "series" });
    } catch (e: any) { notifyError(e?.message || String(e), "series"); }
    finally { setBusy(false); }
  }
  async function stop() {
    setBusy(true);
    try { await api.cancel(project.id); notify({ message: "Rendering stopped", tab: "series" }); } catch (e: any) { notifyError(e?.message || String(e), "series"); }
    finally { setBusy(false); }
  }

  const pipeline: { label: string; value: number; text: string; stage: DashStage }[] = [
    { label: "Idea", value: project.idea.logline ? 100 : project.discussion.length ? 50 : 0, text: project.idea.logline ? "set" : project.discussion.length ? "talking" : "empty", stage: "develop" },
    { label: "Story material", value: project.sources?.length ? 100 : 0, text: `${project.sources?.length || 0} attached`, stage: "develop" },
    { label: "Plan", value: eps.length ? 100 : 0, text: `${eps.length} episodes`, stage: "develop" },
    { label: "References", value: pct(refsDone, refs.length), text: `${refsDone}/${refs.length}`, stage: "produce" },
    { label: "Scenes", value: pct(scenesDone, scenes.length), text: `${scenesDone}/${scenes.length}`, stage: "produce" },
    { label: "Joined", value: pct(joined, eps.length), text: `${joined}/${eps.length}`, stage: "assemble" },
  ];
  const clips = [...eps].reverse().flatMap(e => [...e.scenes].reverse().filter(s => s.status === "done" && s.clipPath).map(s => ({ s, e }))).slice(0, 6);
  const stills = refs.filter(r => r.file).slice(0, 8);
  const joinedEps = eps.filter(e => e.exportPath);
  const maxScenes = Math.max(1, ...eps.map(e => e.scenes.length));

  return (
    <div className="h-full overflow-y-auto pr-1 pb-24">
      <PageTitle>Dashboard</PageTitle>
      <TileBoard id="dashboard" defs={TILE_DEFS}>
        {/* hero */}
        <Tile id="hero" tone="dark" delay={0.02} className="min-h-[22rem] flex flex-col" onClick={() => onGo(next.stage)} title={next.label}
          heading="Series" aside={<ArrowUpRight size={16} className="opacity-60" />}>
          <p className="text-xl font-light leading-tight tracking-tight">{project.title}</p>
          <p className="text-[11px] opacity-60 mt-1 line-clamp-3">{project.idea.logline || "No logline yet - the Develop stage turns your idea into one."}</p>
          <div className="flex-1 grid place-items-center py-4">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/35 via-white/10 to-transparent blur-2xl" />
              <div className="relative"><Ring pct={overall} size={132} stroke={8} sub="of scenes" /></div>
            </div>
          </div>
          {running && (
            <div className="mb-2 rounded-xl bg-sky-400/20 px-3 py-2 text-[11px] text-sky-100">
              <p className="flex items-center gap-1.5"><CircleDot size={11} className="animate-pulse" /> Rendering now</p>
              <p className="truncate opacity-80">{running.label}{runPct !== null ? ` · ${Math.round(runPct)}%` : ""}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2" onClick={e => e.stopPropagation()}>
            {working ? (
              <span role="button" tabIndex={0} onClick={stop} className="inline-flex items-center gap-2 rounded-full bg-rose-500 hover:bg-rose-400 px-3.5 py-1.5 text-[11px] font-semibold text-white cursor-pointer">
                {busy ? <Loader2 size={11} className="animate-spin" /> : <Square size={10} className="fill-current" />} Stop rendering
              </span>
            ) : eps.length > 0 && missing > 0 ? (
              <span role="button" tabIndex={0} onClick={renderMissing} className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-[11px] font-semibold text-zinc-900 cursor-pointer hover:bg-zinc-100">
                {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} className="fill-current" />} Render what's missing
              </span>
            ) : null}
            <span role="button" tabIndex={0} onClick={() => onGo(next.stage)} className="inline-flex items-center gap-2 rounded-full bg-white/15 hover:bg-white/25 px-3.5 py-1.5 text-[11px] font-semibold cursor-pointer">{next.label}</span>
          </div>
        </Tile>

        {/* episodes bars */}
        <Tile id="episodes" delay={0.06} className="min-h-[11rem]" heading="Episodes at work" aside={<span className="text-2xl font-extralight tracking-tight">{scenesDone}<span className="text-xs opacity-50"> / {scenes.length} scenes</span></span>}>
          {eps.length === 0 ? <p className="text-xs opacity-50">No episodes yet.</p> : (
            <div className="flex items-end justify-between gap-1.5 h-24">
              {eps.map(e => {
                const done = e.scenes.filter(s => s.status === "done").length;
                const frac = e.scenes.length ? done / e.scenes.length : 0;
                return (
                  <button key={e.id} onClick={ev => { ev.stopPropagation(); onGo("produce", e.id); }} title={`Episode ${e.number}: ${e.title} - ${done}/${e.scenes.length} scenes`} className="group flex-1 h-full flex flex-col items-center justify-end gap-1.5">
                    <div className="relative w-1.5 flex-1 rounded-full bg-current/10 overflow-hidden" style={{ minHeight: 8 }}>
                      <motion.div className="absolute bottom-0 inset-x-0 rounded-full bg-current" initial={{ height: 0 }} animate={{ height: `${Math.max(frac * 100, e.scenes.length ? 6 : 0)}%` }} transition={{ duration: 0.8 }} />
                    </div>
                    <span className="text-[10px] opacity-55 group-hover:opacity-100">{e.number}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Tile>

        {/* rings */}
        <Tile id="progress" delay={0.1} className="min-h-[11rem]" heading="Progress" onClick={() => onGo("produce")} title="Open the production board">
          <div className="flex items-center justify-between gap-2">
            <Ring pct={overall} size={74} stroke={5} sub="scenes" />
            <Ring pct={pct(refsDone, refs.length)} size={74} stroke={5} sub="refs" />
            <Ring pct={pct(joined, eps.length)} size={74} stroke={5} sub="joined" />
          </div>
        </Tile>

        {/* queue */}
        <Tile id="queue" tone="dark" delay={0.14} className="min-h-[11rem]" heading="Render queue" onClick={() => onGo("produce")} title="Open the production board">
          <div className="space-y-2">
            {[["Queued", queued, "bg-amber-400"], ["Failed", failed, "bg-rose-400"], ["Left", remaining, "bg-white/60"]].map(([l, n, c]) => (
              <div key={l as string} className="flex items-center justify-between rounded-full bg-black/30 px-3 py-1.5 text-xs"><span className="flex items-center gap-2 opacity-80"><span className={`w-1.5 h-1.5 rounded-full ${c}`} />{l}</span><span className="font-light text-base">{n}</span></div>
            ))}
          </div>
        </Tile>

        {/* timeline */}
        <Tile id="glance" delay={0.18} className="" heading="Episodes at a glance" aside={<div className="flex gap-2 text-[10px] opacity-60">{(["done", "queued", "failed", "pending"] as const).map(s => <span key={s} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-sm ${SCENE_COLOR[s].split(" ")[0]}`} />{s}</span>)}</div>}>
          {eps.length === 0 ? <p className="text-xs opacity-50">Build a plan in Develop and every episode shows up here, scene by scene.</p> : (
            <div className="space-y-1.5">
              {eps.map(e => (
                <div key={e.id} className="flex items-center gap-3">
                  <button onClick={() => onGo("produce", e.id)} className="w-36 shrink-0 truncate text-left text-[11px] opacity-65 hover:opacity-100" title={e.title}>{e.number}. {e.title}</button>
                  <div className="flex-1 flex gap-0.5" style={{ maxWidth: `${(e.scenes.length / maxScenes) * 100}%` }}>
                    {e.scenes.map(s => <button key={s.id} onClick={() => onGo("produce", e.id)} title={`Scene ${s.number}: ${s.status}${s.vo ? " - " + s.vo.slice(0, 60) : ""}`} className={`h-3.5 flex-1 rounded-[3px] transition-transform hover:scale-y-150 ${SCENE_COLOR[s.status]}`} />)}
                  </div>
                  {e.exportPath && <Scissors size={11} className="text-emerald-500 shrink-0" />}
                </div>
              ))}
            </div>
          )}
        </Tile>

        {/* pipeline */}
        <Tile id="pipeline" tone="dark" delay={0.22} className="" heading="Pipeline">
          <div className="space-y-2.5">
            {pipeline.map(p => (
              <button key={p.label} onClick={() => onGo(p.stage)} className="block w-full text-left group">
                <div className="flex items-center justify-between text-[11px]"><span className="opacity-80 group-hover:opacity-100">{p.label}</span><span className="opacity-50">{p.text}</span></div>
                <div className="mt-1 h-1 rounded-full bg-white/15 overflow-hidden"><motion.div className="h-full rounded-full bg-white" initial={{ width: 0 }} animate={{ width: `${p.value}%` }} transition={{ duration: 0.8 }} /></div>
              </button>
            ))}
          </div>
        </Tile>

        {/* engine */}
        <Tile id="engine" delay={0.26} className="" heading="Render engine" onClick={() => onGo("settings")} title="Open the settings" aside={<Settings2 size={15} className="opacity-60" />}>
          <p className="flex items-center gap-2 text-sm"><CircleDot size={13} className={comfy?.comfyUp ? "text-emerald-500" : "text-rose-500"} />{comfy ? (comfy.comfyUp ? "ComfyUI is running" : "ComfyUI is not answering") : "Checking..."}</p>
          <p className="hidden @[14rem]:block text-[11px] opacity-50 mt-1 truncate">{comfy?.comfyUrl}</p>
          <p className="text-[11px] opacity-70 mt-2">{w}×{h} · {secs} s · {project.settings.steps} steps · {project.settings.fps} fps</p>
          <p className="hidden @[14rem]:block text-[11px] opacity-45 mt-1 truncate">{project.settings.videoWorkflow ? project.settings.videoWorkflow.split(/[\\/]/).pop() : "No scene workflow set"}</p>
        </Tile>

        {/* estimate */}
        <Tile id="estimate" tone="dark" delay={0.3} className="" heading="Time left to render" onClick={() => onGo("settings")} title="Measured on this PC; a bigger size or longer clip costs more. Open the settings to change them." aside={<Timer size={15} className="opacity-60" />}>
          <div className="flex flex-wrap items-center gap-3">
            <Ring pct={overall} size={64} stroke={5} label={remaining ? hours(remaining * perClip) : "Done"} sub={remaining ? "estimate" : ""} />
            <div className="text-[11px] opacity-70 space-y-0.5 min-w-[7rem] flex-1">
              <p>{remaining} scene{remaining === 1 ? "" : "s"} left</p>
              <p>≈ {hours(perClip)} per clip at {w}×{h}</p>
            </div>
          </div>
        </Tile>

        {/* recent clips */}
        <Tile id="clips" delay={0.34} className="" heading="Latest clips" aside={<Film size={15} className="opacity-60" />}>
          {clips.length === 0 ? <p className="text-xs opacity-50">Rendered scenes appear here.</p> : (
            <div className="grid grid-cols-3 gap-2">
              {clips.map(({ s, e }) => (
                <button key={s.id} onClick={() => onGo("produce", e.id)} title={`Episode ${e.number}, scene ${s.number}`} className="relative aspect-[9/14] rounded-xl overflow-hidden bg-black/40 group">
                  <HoverVideo src={fileUrl(s.clipPath!)} className="w-full h-full object-cover" />
                  <span className="absolute left-1.5 bottom-1 text-[10px] font-semibold text-white drop-shadow">E{e.number}·{s.number}</span>
                  <span className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                </button>
              ))}
            </div>
          )}
        </Tile>

        {/* joined episodes */}
        <Tile id="joined" delay={0.36} className="min-h-[11rem]" heading="Stitched episodes" aside={<span className="text-2xl font-extralight tracking-tight">{joined}<span className="text-xs opacity-50"> / {eps.length}</span></span>}>
          {joinedEps.length === 0 ? <p className="text-xs opacity-50">Episodes you join into one file appear here - hover one to preview it.</p> : (
            <div className="grid grid-cols-3 gap-2">
              {joinedEps.map(e => (
                <button key={e.id} onClick={() => onGo("assemble", e.id)} title={`Episode ${e.number}: ${e.title}`} className="relative aspect-[9/14] rounded-xl overflow-hidden bg-black/40 group">
                  <HoverVideo src={fileUrl(e.exportPath!)} className="w-full h-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pt-4 pb-1 text-[10px] font-semibold text-white truncate">E{e.number} {e.title}</span>
                </button>
              ))}
            </div>
          )}
        </Tile>

        {/* references */}
        <Tile id="refs" delay={0.38} className="" heading="Cast & references" aside={<ImageIcon size={15} className="opacity-60" />} onClick={() => onGo("produce")} title="Open the production board">
          {stills.length === 0 ? <p className="text-xs opacity-50">Reference stills appear here once they are rendered or dropped in.</p> : (
            <div className="grid grid-cols-4 gap-2">
              {stills.map(r => (
                <div key={r.id} className="relative aspect-square rounded-xl overflow-hidden bg-black/30" title={r.name}>
                  <img src={fileUrl(r.file!)} alt={r.name} loading="lazy" className="w-full h-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pt-3 pb-1 text-[9px] text-white truncate">{r.name}</span>
                </div>
              ))}
            </div>
          )}
        </Tile>
      </TileBoard>

      {/* floating shortcuts, like a dock */}
      <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 z-30">
        <div className="pointer-events-auto sd-dark flex items-center gap-1 rounded-full border p-1.5 shadow-2xl">
          {([["develop", "Develop", MessagesSquare], ["produce", "Produce", LayoutGrid], ["assemble", "Assemble", Scissors], ["settings", "Settings", Settings2]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => onGo(id)} className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs opacity-80 hover:opacity-100 hover:bg-white/10 transition-colors"><Icon size={13} /> {label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

