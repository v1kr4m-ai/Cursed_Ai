import React from "react";
import { motion } from "motion/react";
import { ArrowUpRight, CircleDot, Film, Image as ImageIcon, LayoutGrid, MessagesSquare, Play, Scissors, Settings2, Timer } from "lucide-react";
import { api, fileUrl, type Project, type Scene } from "./api";

export type DashStage = "develop" | "produce" | "assemble" | "settings";
type Go = (stage: DashStage, episodeId?: string) => void;

const SCENE_COLOR: Record<Scene["status"], string> = {
  done: "bg-emerald-400", running: "bg-sky-400 animate-pulse", queued: "bg-amber-400", failed: "bg-rose-400", pending: "bg-white/15",
};

/** A circular progress ring with the value in the middle. */
function Ring({ pct, size = 84, stroke = 6, label, sub }: { pct: number; size?: number; stroke?: number; label?: string; sub?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - Math.min(1, pct / 100)) }} transition={{ duration: 0.9, ease: "easeOut" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-light tracking-tight" style={{ fontSize: size * 0.26 }}>{label ?? `${Math.round(pct)}%`}</span>
        {sub && <span className="text-[9px] opacity-50 mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

/** One card of the board. Dark or frosted, clickable when it has an onClick. */
function Tile({ className = "", tone = "frost", onClick, title, heading, aside, children, delay = 0 }: { className?: string; tone?: "dark" | "frost"; onClick?: () => void; title?: string; heading?: string; aside?: React.ReactNode; children: React.ReactNode; delay?: number }) {
  const base = tone === "dark" ? "bg-neutral-800/85 text-neutral-100 border-white/5" : "bg-white/[0.07] backdrop-blur-xl text-neutral-100 border-white/10";
  const body = (
    <>
      {(heading || aside) && (
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-[13px] font-medium tracking-tight text-neutral-200">{heading}</p>
          {aside}
        </div>
      )}
      {children}
    </>
  );
  const common = `${className} ${base} relative rounded-[1.6rem] border p-5 text-left overflow-hidden transition-colors`;
  if (!onClick) return <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }} className={common}>{body}</motion.div>;
  return (
    <motion.button initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }}
      onClick={onClick} title={title} className={`${common} cursor-pointer hover:border-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 block w-full`}>
      {body}
    </motion.button>
  );
}

const hours = (min: number) => (min >= 90 ? `${Math.round(min / 60)} h` : `${Math.max(1, Math.round(min))} min`);

/**
 * The board you land on when a series is open: where it stands, what is rendering, what is next - every card opens the part
 * of the studio it summarises.
 */
export function ProjectDashboard({ project, onGo }: { project: Project; onGo: Go }) {
  const [comfy, setComfy] = React.useState<{ comfyUp: boolean; comfyUrl: string } | null>(null);
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
  const w = project.settings.width, h = project.settings.height, secs = project.settings.seconds;
  // Measured here: ~30 min per 7 s clip at 544x928; cost scales with pixels and length.
  const perClip = 30 * ((w * h) / (544 * 928)) * (secs / 7);
  const running = project.running;
  const runPct = running?.progress ? (running.progress[0] / Math.max(1, running.progress[1])) * 100 : null;

  const next: { label: string; stage: DashStage } = !eps.length ? { label: project.sources?.length || project.idea.logline || project.discussion.length ? "Build the plan" : "Start with the idea", stage: "develop" }
    : remaining > 0 ? { label: `Render ${remaining} scene${remaining === 1 ? "" : "s"}`, stage: "produce" }
    : joined < eps.length ? { label: "Join the episodes", stage: "assemble" } : { label: "Review the finished episodes", stage: "assemble" };

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
  const maxScenes = Math.max(1, ...eps.map(e => e.scenes.length));

  return (
    <div className="h-full overflow-y-auto pr-1 pb-24">
      <div className="relative rounded-[2rem] p-3 sm:p-4">
        <div className="pointer-events-none absolute inset-0 rounded-[2rem] bg-gradient-to-br from-white/[0.06] via-transparent to-white/[0.02]" />
        <h1 className="relative text-center font-extralight tracking-tight text-neutral-100 text-4xl sm:text-6xl mb-5 select-none">Dashboard</h1>

        <div className="relative grid gap-3 grid-cols-1 md:grid-cols-6 xl:grid-cols-12">
          {/* hero */}
          <Tile tone="dark" delay={0.02} className="md:col-span-3 xl:col-span-3 xl:row-span-2 min-h-[22rem] flex flex-col" onClick={() => onGo(next.stage)} title={next.label}
            heading="Series" aside={<ArrowUpRight size={16} className="text-neutral-400" />}>
            <p className="text-xl font-light leading-tight tracking-tight">{project.title}</p>
            <p className="text-[11px] text-neutral-400 mt-1 line-clamp-3">{project.idea.logline || "No logline yet - the Develop stage turns your idea into one."}</p>
            <div className="flex-1 grid place-items-center py-4">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-neutral-200/40 via-neutral-500/20 to-transparent blur-2xl" />
                <div className="relative text-neutral-100"><Ring pct={overall} size={132} stroke={8} sub="of scenes" /></div>
              </div>
            </div>
            {running && (
              <div className="mb-2 rounded-xl bg-sky-500/15 px-3 py-2 text-[11px] text-sky-200">
                <p className="flex items-center gap-1.5"><CircleDot size={11} className="animate-pulse" /> Rendering now</p>
                <p className="truncate opacity-80">{running.label}{runPct !== null ? ` · ${Math.round(runPct)}%` : ""}</p>
              </div>
            )}
            <span className="inline-flex items-center gap-2 self-start rounded-full bg-white/90 px-3.5 py-1.5 text-[11px] font-semibold text-neutral-900"><Play size={11} className="fill-current" /> {next.label}</span>
          </Tile>

          {/* episodes bars */}
          <Tile delay={0.06} className="md:col-span-3 xl:col-span-4 min-h-[11rem]" heading="Episodes at work" aside={<span className="text-2xl font-extralight tracking-tight">{scenesDone}<span className="text-xs text-neutral-500"> / {scenes.length} scenes</span></span>}>
            {eps.length === 0 ? <p className="text-xs text-neutral-500">No episodes yet.</p> : (
              <div className="flex items-end justify-between gap-1.5 h-24">
                {eps.map(e => {
                  const done = e.scenes.filter(s => s.status === "done").length;
                  const frac = e.scenes.length ? done / e.scenes.length : 0;
                  return (
                    <button key={e.id} onClick={ev => { ev.stopPropagation(); onGo("produce", e.id); }} title={`Episode ${e.number}: ${e.title} - ${done}/${e.scenes.length} scenes`} className="group flex-1 h-full flex flex-col items-center justify-end gap-1.5">
                      <div className="relative w-1.5 flex-1 rounded-full bg-white/10 overflow-hidden" style={{ minHeight: 8 }}>
                        <motion.div className="absolute bottom-0 inset-x-0 rounded-full bg-neutral-100 group-hover:bg-white" initial={{ height: 0 }} animate={{ height: `${Math.max(frac * 100, e.scenes.length ? 6 : 0)}%` }} transition={{ duration: 0.8 }} />
                      </div>
                      <span className="text-[10px] text-neutral-400 group-hover:text-white">{e.number}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Tile>

          {/* rings */}
          <Tile delay={0.1} className="md:col-span-3 xl:col-span-3 min-h-[11rem]" heading="Progress" onClick={() => onGo("produce")} title="Open the production board">
            <div className="flex items-center justify-between gap-2 text-neutral-100">
              <Ring pct={overall} size={74} stroke={5} sub="scenes" />
              <Ring pct={pct(refsDone, refs.length)} size={74} stroke={5} sub="refs" />
              <Ring pct={pct(joined, eps.length)} size={74} stroke={5} sub="joined" />
            </div>
          </Tile>

          {/* analytics pills + engine */}
          <Tile tone="dark" delay={0.14} className="md:col-span-3 xl:col-span-2 min-h-[11rem]" heading="Render queue" onClick={() => onGo("produce")} title="Open the production board">
            <div className="space-y-2">
              {[["Queued", queued, "bg-amber-400"], ["Failed", failed, "bg-rose-400"], ["Left", remaining, "bg-white/50"]].map(([l, n, c]) => (
                <div key={l as string} className="flex items-center justify-between rounded-full bg-black/40 px-3 py-1.5 text-xs"><span className="flex items-center gap-2 text-neutral-300"><span className={`w-1.5 h-1.5 rounded-full ${c}`} />{l}</span><span className="font-light text-base">{n}</span></div>
              ))}
            </div>
          </Tile>

          {/* timeline */}
          <Tile delay={0.18} className="md:col-span-6 xl:col-span-6 xl:row-span-1" heading="Episodes at a glance" aside={<div className="flex gap-2 text-[10px] text-neutral-500">{(["done", "queued", "failed", "pending"] as const).map(s => <span key={s} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-sm ${SCENE_COLOR[s].split(" ")[0]}`} />{s}</span>)}</div>}>
            {eps.length === 0 ? <p className="text-xs text-neutral-500">Build a plan in Develop and every episode shows up here, scene by scene.</p> : (
              <div className="space-y-1.5">
                {eps.map(e => (
                  <div key={e.id} className="flex items-center gap-3">
                    <button onClick={() => onGo("produce", e.id)} className="w-36 shrink-0 truncate text-left text-[11px] text-neutral-400 hover:text-white" title={e.title}>{e.number}. {e.title}</button>
                    <div className="flex-1 flex gap-0.5" style={{ maxWidth: `${(e.scenes.length / maxScenes) * 100}%` }}>
                      {e.scenes.map(s => <button key={s.id} onClick={() => onGo("produce", e.id)} title={`Scene ${s.number}: ${s.status}${s.vo ? " - " + s.vo.slice(0, 60) : ""}`} className={`h-3.5 flex-1 rounded-[3px] transition-transform hover:scale-y-150 ${SCENE_COLOR[s.status]}`} />)}
                    </div>
                    {e.exportPath && <Scissors size={11} className="text-emerald-400 shrink-0" />}
                  </div>
                ))}
              </div>
            )}
          </Tile>

          {/* pipeline */}
          <Tile tone="dark" delay={0.22} className="md:col-span-3 xl:col-span-3" heading="Pipeline">
            <div className="space-y-2.5">
              {pipeline.map(p => (
                <button key={p.label} onClick={() => onGo(p.stage)} className="block w-full text-left group">
                  <div className="flex items-center justify-between text-[11px]"><span className="text-neutral-300 group-hover:text-white">{p.label}</span><span className="text-neutral-500">{p.text}</span></div>
                  <div className="mt-1 h-1 rounded-full bg-white/10 overflow-hidden"><motion.div className="h-full rounded-full bg-white" initial={{ width: 0 }} animate={{ width: `${p.value}%` }} transition={{ duration: 0.8 }} /></div>
                </button>
              ))}
            </div>
          </Tile>

          {/* engine */}
          <Tile delay={0.26} className="md:col-span-3 xl:col-span-3" heading="Render engine" onClick={() => onGo("settings")} title="Open the settings" aside={<Settings2 size={15} className="text-neutral-400" />}>
            <p className="flex items-center gap-2 text-sm"><CircleDot size={13} className={comfy?.comfyUp ? "text-emerald-400" : "text-rose-400"} />{comfy ? (comfy.comfyUp ? "ComfyUI is running" : "ComfyUI is not answering") : "Checking..."}</p>
            <p className="text-[11px] text-neutral-500 mt-1 truncate">{comfy?.comfyUrl}</p>
            <p className="text-[11px] text-neutral-400 mt-3">{w}×{h} · {secs} s · {project.settings.steps} steps · {project.settings.fps} fps</p>
            <p className="text-[11px] text-neutral-600 mt-1 truncate">{project.settings.videoWorkflow ? project.settings.videoWorkflow.split(/[\\/]/).pop() : "No scene workflow set"}</p>
          </Tile>

          {/* estimate */}
          <Tile tone="dark" delay={0.3} className="md:col-span-3 xl:col-span-4" heading="Time left to render" onClick={() => onGo("settings")} title="Size and length change the estimate" aside={<Timer size={15} className="text-neutral-400" />}>
            <div className="flex items-center gap-5">
              <div className="text-neutral-100"><Ring pct={overall} size={96} stroke={6} label={remaining ? hours(remaining * perClip) : "Done"} sub={remaining ? "estimate" : ""} /></div>
              <div className="text-[11px] text-neutral-400 space-y-1">
                <p>{remaining} scene{remaining === 1 ? "" : "s"} left</p>
                <p>≈ {hours(perClip)} per clip at {w}×{h}</p>
                <p className="text-neutral-600">Measured on this PC; a bigger size or longer clip costs more.</p>
              </div>
            </div>
          </Tile>

          {/* recent clips */}
          <Tile delay={0.34} className="md:col-span-3 xl:col-span-4" heading="Latest clips" aside={<Film size={15} className="text-neutral-400" />}>
            {clips.length === 0 ? <p className="text-xs text-neutral-500">Rendered scenes appear here.</p> : (
              <div className="grid grid-cols-3 gap-2">
                {clips.map(({ s, e }) => (
                  <button key={s.id} onClick={() => onGo("produce", e.id)} title={`Episode ${e.number}, scene ${s.number}`} className="relative aspect-[9/14] rounded-xl overflow-hidden bg-black/40 group">
                    <video src={`${fileUrl(s.clipPath!)}#t=0.4`} muted preload="metadata" className="w-full h-full object-cover" />
                    <span className="absolute left-1.5 bottom-1 text-[10px] font-semibold text-white drop-shadow">E{e.number}·{s.number}</span>
                    <span className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                  </button>
                ))}
              </div>
            )}
          </Tile>

          {/* references */}
          <Tile delay={0.38} className="md:col-span-6 xl:col-span-4" heading="Cast & references" aside={<ImageIcon size={15} className="text-neutral-400" />} onClick={() => onGo("produce")} title="Open the production board">
            {stills.length === 0 ? <p className="text-xs text-neutral-500">Reference stills appear here once they are rendered or dropped in.</p> : (
              <div className="grid grid-cols-4 gap-2">
                {stills.map(r => (
                  <div key={r.id} className="relative aspect-square rounded-xl overflow-hidden bg-black/40" title={r.name}>
                    <img src={fileUrl(r.file!)} alt={r.name} loading="lazy" className="w-full h-full object-cover" />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pt-3 pb-1 text-[9px] text-white truncate">{r.name}</span>
                  </div>
                ))}
              </div>
            )}
          </Tile>
        </div>
      </div>

      {/* floating shortcuts, like a dock */}
      <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 z-30">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-neutral-900/80 backdrop-blur-xl p-1.5 shadow-2xl shadow-black/50">
          {([["develop", "Develop", MessagesSquare], ["produce", "Produce", LayoutGrid], ["assemble", "Assemble", Scissors], ["settings", "Settings", Settings2]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => onGo(id)} className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs text-neutral-300 hover:bg-white/10 hover:text-white transition-colors"><Icon size={13} /> {label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
