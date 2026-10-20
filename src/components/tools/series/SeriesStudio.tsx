import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { LayoutDashboard, Clapperboard, Plus, Trash2, ArrowLeft, Settings2, Loader2, CircleDot, MessagesSquare, LayoutGrid, Scissors, Film, Sparkles } from "lucide-react";
import { api, type Project, type ProjectSummary } from "./api";
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

function Dashboard({ onOpen }: { onOpen: (id: string) => void }) {
  const [projects, setProjects] = React.useState<ProjectSummary[]>([]);
  const [root, setRoot] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const data = await api.list();
      setProjects(data.projects);
      setRoot(data.root);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);

  async function create() {
    if (!title.trim()) return;
    try {
      const p = await api.create(title.trim());
      setTitle("");
      onOpen(p.id);
    } catch (e: any) { setError(e?.message || String(e)); }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete "${name}" and everything rendered in it? This cannot be undone.`)) return;
    await api.remove(id);
    refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center gap-2 mb-4">
        <input className={`${field} max-w-sm`} placeholder="New series title" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === "Enter" && create()} />
        <motion.button whileHover={{ scale: title.trim() ? 1.03 : 1 }} whileTap={{ scale: 0.97 }}
          onClick={create} disabled={!title.trim()}
          className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-950/40 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40">
          <Plus size={16} /> Start a series
        </motion.button>
      </div>

      {error && <div className="mb-3 rounded-lg border border-rose-900/60 bg-rose-950/40 p-3 text-xs text-rose-200">{error}</div>}
      {loading && <div className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 size={14} className="animate-spin" /> Loading projects...</div>}

      {!loading && !projects.length && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-dashed border-neutral-800 p-10 text-center">
          <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 3.2, ease: "easeInOut" }}>
            <Film size={30} className="mx-auto text-neutral-600" />
          </motion.div>
          <p className="mt-3 text-sm text-neutral-400">No series yet.</p>
          <p className="mt-1 text-xs text-neutral-600">Name one above - the next screen is a conversation about what it should be.</p>
        </motion.div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {projects.map(p => {
          const pct = p.scenes ? Math.round((p.scenesDone / p.scenes) * 100) : 0;
          return (
            <motion.div key={p.id} layout
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 300, damping: 24 }}
              className="group rounded-xl border border-neutral-800 bg-gradient-to-b from-neutral-900/60 to-neutral-900/20 p-4 hover:border-neutral-700">
              <button className="w-full text-left" onClick={() => onOpen(p.id)}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-medium text-neutral-100 truncate">{p.title}</h3>
                  <span className="text-[11px] text-neutral-500 shrink-0">{new Date(p.updatedAt).toLocaleDateString()}</span>
                </div>
                <div className="mt-3 flex items-center gap-3 text-[11px] text-neutral-400">
                  <span>{p.episodes} episodes</span>
                  <span>{p.scenesDone}/{p.scenes} scenes</span>
                  <span>{p.exports} joined</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-neutral-800">
                  <motion.div className="h-full rounded bg-gradient-to-r from-emerald-500 to-teal-400"
                    initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                    transition={{ type: "spring", stiffness: 110, damping: 20 }} />
                </div>
              </button>
              <div className="mt-3 flex items-center justify-between">
                <span className="truncate text-[10px] text-neutral-600" title={p.dir}>{p.dir}</span>
                <button onClick={() => remove(p.id, p.title)} className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-rose-400 transition" title="Delete project">
                  <Trash2 size={14} />
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>

      {root && <p className="mt-6 text-[11px] text-neutral-600">Projects are folders under {root}</p>}
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

export function SeriesStudioView({ modelId }: { modelId?: string }) {
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [project, setProject] = React.useState<Project | null>(null);
  const [stage, setStage] = React.useState<Stage>("dashboard");
  const [focusEpisode, setFocusEpisode] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async (id: string) => {
    try { setProject(await api.get(id)); } catch (e: any) { setError(e?.message || String(e)); }
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

  if (!projectId) {
    return (
      <div className="flex-1 p-4 h-full overflow-hidden">
        <div className="max-w-[1600px] mx-auto h-full flex flex-col">
          <header className="flex items-center gap-2 mb-4">
            <motion.span animate={{ rotate: [0, -10, 10, 0] }} transition={{ repeat: Infinity, repeatDelay: 5, duration: 1.2 }}>
              <Clapperboard className="text-violet-400" size={24} />
            </motion.span>
            <h2 className="bg-gradient-to-r from-violet-200 to-neutral-300 bg-clip-text text-lg font-medium text-transparent">Series Studio</h2>
            <span className="flex items-center gap-1 text-xs text-neutral-500"><Sparkles size={11} className="text-violet-400" /> idea to finished episodes</span>
          </header>
          <div className="flex-1 min-h-0"><Dashboard onOpen={setProjectId} /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 h-full overflow-hidden">
      <div className="max-w-[1600px] mx-auto h-full flex flex-col min-h-0">
        <header className="flex flex-wrap items-center gap-3 mb-3">
          <button onClick={() => { setProjectId(null); setProject(null); }} className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800">
            <ArrowLeft size={14} /> All series
          </button>
          <h2 className="text-base font-medium text-neutral-100 truncate">{project?.title || "Loading..."}</h2>
          <nav className="ml-auto flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900/50 p-1">
            {STAGES.map(s => {
              const Icon = s.icon;
              const active = stage === s.id;
              return (
                <button key={s.id} onClick={() => setStage(s.id)} title={s.hint} className="relative rounded-md px-3 py-1.5 text-xs">
                  {active && (
                    <motion.span layoutId="series-stage-pill" transition={{ type: "spring", stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-md bg-neutral-700 shadow" />
                  )}
                  <span className={`relative flex items-center gap-1.5 transition-colors ${active ? "text-white" : "text-neutral-400 hover:text-neutral-200"}`}>
                    <Icon size={13} />
                    {s.id !== "settings" && s.label}
                  </span>
                </button>
              );
            })}
          </nav>
        </header>

        {error && <div className="mb-3 rounded-lg border border-rose-900/60 bg-rose-950/40 p-3 text-xs text-rose-200">{error}</div>}

        <div className="flex-1 min-h-0">
          <AnimatePresence mode="wait">
            <motion.div key={stage} className="h-full min-h-0"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}>
          {!project ? (
            <div className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 size={14} className="animate-spin" /> Loading...</div>
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
      </div>
    </div>
  );
}
