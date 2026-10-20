import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Moon, Sun, ArrowUpRight, LayoutDashboard, Clapperboard, Plus, Trash2, ArrowLeft, Settings2, Loader2, CircleDot, MessagesSquare, LayoutGrid, Scissors, Film, Sparkles } from "lucide-react";
import { api, fileUrl, type Project, type ProjectSummary } from "./api";
import "./series-theme.css";
import { Ring, Tile, PageTitle } from "./DashKit";
import { Develop } from "./Develop";
import { Board } from "./Board";
import { Assemble } from "./Assemble";
import { ProjectDashboard } from "./ProjectDashboard";

/**
 * Series Studio: take an idea from a conversation to finished episodes without leaving the app.
 *
 *   Dashboard -> Develop (discuss, then plan) -> Produce (refs and scenes) -> Assemble (ffmpeg)
 *
 * Everything lives in the project folder on disk, so work continues across restarts and the files
 * can be opened by hand at any point.
 */

type Stage = "dashboard" | "develop" | "produce" | "assemble" | "settings";

const STAGES: { id: Stage; label: string; hint: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: "dashboard", label: "Dashboard", hint: "Where the series stands and what is next", icon: LayoutDashboard },
  { id: "develop", label: "Develop", hint: "Discuss the idea and turn it into a plan", icon: MessagesSquare },
  { id: "produce", label: "Produce", hint: "Render reference stills and scenes", icon: LayoutGrid },
  { id: "assemble", label: "Assemble", hint: "Join scenes into finished episodes", icon: Scissors },
  { id: "settings", label: "Settings", hint: "Workflows, size, duration", icon: Settings2 },
];

const field = "w-full bg-neutral-900/60 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-500";

/** The list of series: a poster-style board with a card per series. */
function SeriesHome({ onOpen }: { onOpen: (id: string) => void }) {
  const [projects, setProjects] = React.useState<ProjectSummary[]>([]);
  const [full, setFull] = React.useState<Record<string, Project>>({});
  const [root, setRoot] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const data = await api.list();
      setProjects(data.projects);
      setRoot(data.root);
      // The cards show scenes and stills, so fetch each project once.
      const details = await Promise.all(data.projects.map(p => api.get(p.id).catch(() => null)));
      setFull(Object.fromEntries(details.filter(Boolean).map(d => [(d as Project).id, d as Project])));
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);

  async function create() {
    if (!title.trim()) return;
    try { const p = await api.create(title.trim()); setTitle(""); onOpen(p.id); } catch (e: any) { setError(e?.message || String(e)); }
  }
  async function remove(id: string, name: string) {
    if (!confirm(`Delete "${name}" and everything rendered in it? This cannot be undone.`)) return;
    await api.remove(id);
    refresh();
  }

  const total = projects.reduce((a, p) => ({ eps: a.eps + p.episodes, scenes: a.scenes + p.scenes, done: a.done + p.scenesDone, joined: a.joined + p.exports }), { eps: 0, scenes: 0, done: 0, joined: 0 });
  const overall = total.scenes ? Math.round((total.done / total.scenes) * 100) : 0;

  return (
    <div className="h-full overflow-y-auto pr-1 pb-8">
      <PageTitle>Series</PageTitle>
      {error && <div className="mb-3 rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-xs text-rose-200">{error}</div>}

      <div className="grid gap-3 grid-cols-1 md:grid-cols-6 xl:grid-cols-12">
        <Tile tone="dark" delay={0.02} className="md:col-span-3 xl:col-span-4 min-h-[11rem]" heading="All series">
          <div className="flex items-center gap-5">
            <Ring pct={overall} size={92} stroke={6} sub="of scenes" />
            <div className="text-[11px] opacity-75 space-y-1">
              <p><span className="text-2xl font-extralight tracking-tight opacity-100">{projects.length}</span> series</p>
              <p>{total.eps} episodes · {total.done}/{total.scenes} scenes</p>
              <p>{total.joined} joined</p>
            </div>
          </div>
        </Tile>

        <Tile delay={0.06} className="md:col-span-3 xl:col-span-8 min-h-[11rem]" heading="Start a new series" aside={<Sparkles size={15} className="opacity-60" />}>
          <p className="text-[11px] opacity-60 mb-3">Name it - the next screen is a conversation about what it should be.</p>
          <div className="flex items-center gap-2 max-w-xl">
            <input className={field} placeholder="New series title" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === "Enter" && create()} />
            <motion.button whileHover={{ scale: title.trim() ? 1.03 : 1 }} whileTap={{ scale: 0.97 }} onClick={create} disabled={!title.trim()}
              className="flex shrink-0 items-center gap-2 rounded-full bg-zinc-900 text-white px-4 py-2 text-xs font-semibold shadow-lg disabled:opacity-40"><Plus size={14} /> Start a series</motion.button>
          </div>
        </Tile>

        {loading && <div className="md:col-span-6 xl:col-span-12 flex items-center gap-2 text-sm opacity-60"><Loader2 size={14} className="animate-spin" /> Loading projects...</div>}
        {!loading && !projects.length && (
          <Tile delay={0.1} className="md:col-span-6 xl:col-span-12 text-center py-12" heading="">
            <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 3.2, ease: "easeInOut" }}><Film size={30} className="mx-auto opacity-40" /></motion.div>
            <p className="mt-3 text-sm opacity-70">No series yet.</p>
          </Tile>
        )}

        {projects.map((p, i) => {
          const d = full[p.id];
          const pct = p.scenes ? Math.round((p.scenesDone / p.scenes) * 100) : 0;
          const stills = d ? d.episodes.flatMap(e => e.refs).filter(r => r.file).slice(0, 3) : [];
          return (
            <div key={p.id} className="md:col-span-3 xl:col-span-4 group relative">
              <Tile delay={0.1 + i * 0.05} className="min-h-[15rem] flex flex-col" onClick={() => onOpen(p.id)} title={`Open ${p.title}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-light tracking-tight truncate">{p.title}</p>
                    <p className="text-[11px] opacity-55 mt-0.5">{new Date(p.updatedAt).toLocaleDateString()} · {p.episodes} episodes</p>
                  </div>
                  <ArrowUpRight size={16} className="opacity-50 shrink-0" />
                </div>
                <div className="flex items-center gap-4 mt-4">
                  <Ring pct={pct} size={78} stroke={5} />
                  <div className="text-[11px] opacity-75 space-y-0.5">
                    <p>{p.scenesDone}/{p.scenes} scenes</p>
                    <p>{p.exports} joined</p>
                    <p className="opacity-60">{d?.running ? "Rendering now" : ""}</p>
                  </div>
                  <div className="flex-1 flex justify-end gap-1.5">
                    {stills.map(r => <img key={r.id} src={fileUrl(r.file!)} alt={r.name} className="w-12 h-12 rounded-xl object-cover" />)}
                  </div>
                </div>
                {d && d.episodes.length > 0 && (
                  <div className="mt-auto pt-4 space-y-1">
                    {d.episodes.slice(0, 5).map(e => (
                      <div key={e.id} className="flex gap-0.5">
                        {e.scenes.map(s => <span key={s.id} className={`h-1.5 flex-1 rounded-sm ${s.status === "done" ? "bg-emerald-500" : s.status === "failed" ? "bg-rose-500" : s.status === "queued" || s.status === "running" ? "bg-amber-500" : "bg-current/15"}`} />)}
                      </div>
                    ))}
                  </div>
                )}
              </Tile>
              <button onClick={() => remove(p.id, p.title)} className="absolute right-4 bottom-4 z-10 opacity-0 group-hover:opacity-70 hover:!opacity-100 transition" title="Delete series"><Trash2 size={14} /></button>
            </div>
          );
        })}
      </div>

      {root && <p className="mt-6 text-center text-[11px] opacity-45">Series are folders under {root}</p>}
    </div>
  );
}

function SettingsPane({ project, onChanged }: { project: Project; onChanged: (p: Project) => void }) {
  const [draft, setDraft] = React.useState(project.settings);
  const [locks, setLocks] = React.useState({ styleLock: project.styleLock, voiceLock: project.voiceLock });
  const [comfy, setComfy] = React.useState<{ comfyUp: boolean; comfyUrl: string } | null>(null);

  React.useEffect(() => { api.comfyStatus().then(setComfy).catch(() => setComfy(null)); }, []);

  const saveSettings = async (next = draft) => onChanged(await api.patch(project.id, { settings: next }));
  const saveLocks = async (next = locks) => onChanged(await api.patch(project.id, next));
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);

  return (
    <div className="h-full overflow-y-auto max-w-3xl space-y-4 pr-1">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CircleDot size={14} className={comfy?.comfyUp ? "text-emerald-400" : "text-rose-400"} />
          <span className="text-xs text-neutral-300">
            {comfy ? (comfy.comfyUp ? `ComfyUI reachable at ${comfy.comfyUrl}` : `ComfyUI not answering at ${comfy.comfyUrl}`) : "Checking ComfyUI..."}
          </span>
        </div>
        <p className="text-[11px] text-neutral-500">The address comes from the app's Engine settings, same as the Image and Video tabs.</p>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
        <h3 className="text-sm font-medium text-neutral-200">Workflows</h3>
        <label className="block text-[11px] text-neutral-500">Scene workflow (reference-to-video)</label>
        <input className={`${field} font-mono text-xs`} value={draft.videoWorkflow} placeholder="F:\\ComfyUI\\...\\workflows\\video_minimax_h3_r2v.json" onChange={e => setDraft({ ...draft, videoWorkflow: e.target.value })} onBlur={() => saveSettings()} />
        <label className="block text-[11px] text-neutral-500">Reference-still workflow (text-to-image)</label>
        <input className={`${field} font-mono text-xs`} value={draft.imageWorkflow} placeholder="F:\\ComfyUI\\...\\workflows\\Text to Image Creation by Juggernaut.json" onChange={e => setDraft({ ...draft, imageWorkflow: e.target.value })} onBlur={() => saveSettings()} />
        <p className="text-[11px] text-neutral-500">Full path to a workflow saved in ComfyUI. Size, duration and steps below are written into whichever inputs that workflow exposes.</p>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
        <h3 className="text-sm font-medium text-neutral-200">Size and duration</h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {([["width", "Width"], ["height", "Height"], ["seconds", "Seconds"], ["steps", "Steps"], ["fps", "FPS"]] as const).map(([key, label]) => (
            <div key={key}>
              <label className="block text-[11px] text-neutral-500">{label}</label>
              <input className={field} type="number" value={(draft as any)[key]} onChange={e => setDraft({ ...draft, [key]: num(e.target.value, (project.settings as any)[key]) } as any)} onBlur={() => saveSettings()} />
            </div>
          ))}
        </div>
        <p className="text-[11px] text-neutral-500">
          Frame counts snap up to the grid the model accepts, so a 7 second clip becomes 175 frames (7.29s) at 24 fps.
        </p>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
        <h3 className="text-sm font-medium text-neutral-200">Locks</h3>
        <label className="block text-[11px] text-neutral-500">Style lock - pasted into every scene prompt so the look does not drift</label>
        <textarea className={`${field} h-20 resize-none text-xs`} value={locks.styleLock} onChange={e => setLocks({ ...locks, styleLock: e.target.value })} onBlur={() => saveLocks()} />
        <label className="block text-[11px] text-neutral-500">Narrator lock - restated in every scene, or the voice changes between clips</label>
        <textarea className={`${field} h-16 resize-none text-xs`} value={locks.voiceLock} onChange={e => setLocks({ ...locks, voiceLock: e.target.value })} onBlur={() => saveLocks()} />
      </div>
    </div>
  );
}

const LAST_KEY = "cursed.series.last";
const THEME_KEY = "cursed.series.theme";
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

export function SeriesStudioView({ modelId }: { modelId?: string }) {
  // Opens straight into the series you were last in, as an immersive board; "All series" goes back to the list.
  const [projectId, setProjectId] = React.useState<string | null>(() => store.get(LAST_KEY));
  const [project, setProject] = React.useState<Project | null>(null);
  const [stage, setStage] = React.useState<Stage>("dashboard");
  const [focusEpisode, setFocusEpisode] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [theme, setTheme] = React.useState<"light" | "dark">(() => (store.get(THEME_KEY) === "dark" ? "dark" : "light"));

  const open = (id: string | null) => {
    store.set(LAST_KEY, id);
    setProjectId(id); setProject(null); setStage("dashboard"); setFocusEpisode(null); setError(null);
  };
  const toggleTheme = () => { const next = theme === "light" ? "dark" : "light"; setTheme(next); store.set(THEME_KEY, next); };

  const reload = React.useCallback(async (id: string) => {
    try { setProject(await api.get(id)); }
    catch (e: any) {
      setError(e?.message || String(e));
      if (/not found|404/i.test(String(e?.message))) { store.set(LAST_KEY, null); setProjectId(null); } // the remembered series no longer exists
    }
  }, []);

  React.useEffect(() => { if (projectId) reload(projectId); }, [projectId, reload]);

  // Live job events: the server pushes status changes as renders start, progress and finish.
  React.useEffect(() => {
    if (!projectId) return;
    const source = new EventSource(`/api/series/projects/${projectId}/events`);
    let timer: any = null;
    source.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (["started", "finished", "failed", "updated", "stitched"].includes(data.type)) {
          clearTimeout(timer);
          timer = setTimeout(() => reload(projectId), 150); // several events can land together
        } else if (data.type === "progress") {
          setProject(p => (p ? { ...p, running: p.running ? { ...p.running, progress: [data.value, data.max] } : p.running } : p));
        }
      } catch { /* heartbeat */ }
    };
    return () => { clearTimeout(timer); source.close(); };
  }, [projectId, reload]);

  const themeButton = (
    <button onClick={toggleTheme} title={theme === "light" ? "Switch to the dark look" : "Switch to the light look"} className="rounded-full sd-frost border p-2 hover:opacity-80 transition-opacity">
      {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
    </button>
  );

  return (
    <div className="flex-1 h-full p-3 overflow-hidden">
      <div className={`series-root series-${theme} relative h-full rounded-[2rem] overflow-hidden border border-white/10`}>
        <div className="series-stage" />
        <div className="relative h-full p-4 sm:p-5 flex flex-col min-h-0">
          <div className="max-w-[1600px] w-full mx-auto h-full flex flex-col min-h-0">
            {!projectId ? (
              <>
                <header className="flex items-center gap-2 mb-2">
                  <Clapperboard size={18} className="opacity-70" />
                  <span className="text-sm font-medium tracking-tight">Series Studio</span>
                  <span className="hidden sm:flex items-center gap-1 text-xs opacity-55"><Sparkles size={11} /> idea to finished episodes</span>
                  <span className="ml-auto">{themeButton}</span>
                </header>
                <div className="flex-1 min-h-0"><SeriesHome onOpen={open} /></div>
              </>
            ) : (
              <>
                <header className="flex flex-wrap items-center gap-3 mb-3">
                  <button onClick={() => open(null)} className="flex items-center gap-1.5 rounded-full sd-frost border px-3 py-1.5 text-xs hover:opacity-80">
                    <ArrowLeft size={14} /> All series
                  </button>
                  <h2 className="text-base font-medium tracking-tight truncate">{project?.title || "Loading..."}</h2>
                  <nav className="ml-auto flex items-center gap-1 rounded-full sd-frost border p-1">
                    {STAGES.map(s => {
                      const Icon = s.icon;
                      const active = stage === s.id;
                      return (
                        <button key={s.id} onClick={() => { setFocusEpisode(null); setStage(s.id); }} title={s.hint} className="relative rounded-full px-3 py-1.5 text-xs">
                          {active && (
                            <motion.span layoutId="series-stage-pill" transition={{ type: "spring", stiffness: 420, damping: 32 }}
                              className="absolute inset-0 rounded-full sd-dark" />
                          )}
                          <span className={`relative flex items-center gap-1.5 transition-opacity ${active ? "text-white" : "opacity-65 hover:opacity-100"}`}>
                            <Icon size={13} />
                            {s.id !== "settings" && s.label}
                          </span>
                        </button>
                      );
                    })}
                  </nav>
                  {themeButton}
                </header>

                {error && <div className="mb-3 rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-xs text-rose-200">{error}</div>}

                <div className="flex-1 min-h-0">
                  <AnimatePresence mode="wait">
                    <motion.div key={stage} className="h-full min-h-0"
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.18 }}>
                      {!project ? (
                        <div className="flex items-center gap-2 text-sm opacity-60"><Loader2 size={14} className="animate-spin" /> Loading...</div>
                      ) : stage === "dashboard" ? (
                        <ProjectDashboard project={project} onGo={(st, episodeId) => { setFocusEpisode(episodeId || null); setStage(st); }} />
                      ) : stage === "develop" ? (
                        <Develop project={project} modelId={modelId} onSaved={setProject} />
                      ) : stage === "produce" ? (
                        <Board project={project} onChanged={setProject} focusEpisodeId={focusEpisode} />
                      ) : stage === "assemble" ? (
                        <Assemble project={project} onChanged={setProject} />
                      ) : (
                        <SettingsPane project={project} onChanged={setProject} />
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
