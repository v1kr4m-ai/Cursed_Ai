import React from "react";
import { WorkflowPicker, WorkflowCheck } from "./WorkflowPicker";
import { ComfyStatus } from "../ComfyStatus";
import { motion, AnimatePresence } from "motion/react";
import { Moon, Sun, ArrowUpRight, LayoutDashboard, Clapperboard, Plus, Trash2, ArrowLeft, Settings2, Loader2, CircleDot, MessagesSquare, LayoutGrid, Scissors, Film, Sparkles, Archive, ArchiveRestore, Download, Pencil, GitMerge } from "lucide-react";
import { api, fileUrl, type Project, type ProjectSummary, type SeriesTemplate } from "./api";
import "./series-theme.css";
import { Ring, Tile, TileBoard, PageTitle, type TileDef } from "./DashKit";
import { Develop } from "./Develop";
import { Board } from "./Board";
import { Assemble } from "./Assemble";
import { ProjectDashboard } from "./ProjectDashboard";
import { onSeriesEvent } from "./seriesEvents";
import { baselineSeen } from "./seen";
import { nativeFolder } from "../../comfy/types";
import { notify } from "../../../lib/notify";
import type { AIModel } from "../../../types";

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
  const [showArchived, setShowArchived] = React.useState(false);

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
  const archivedCount = projects.filter(p => full[p.id]?.archived).length;
  const shown = projects.filter(p => !!full[p.id]?.archived === showArchived);

  const [templates, setTemplates] = React.useState<SeriesTemplate[]>([]);
  const [templateId, setTemplateId] = React.useState("");
  React.useEffect(() => { api.templates().then(d => setTemplates(d.templates)).catch(() => {}); }, []);

  async function create() {
    if (!title.trim()) return;
    try {
      let p = await api.create(title.trim());
      // A template only sets how the series is made; the story, episodes and pictures start empty.
      const t = templates.find(x => x.id === templateId);
      if (t) p = await api.patch(p.id, t.patch);
      setTitle(""); onOpen(p.id);
    } catch (e: any) { setError(e?.message || String(e)); }
  }
  /** Zips a series into a folder you pick. */
  async function backUp(p: ProjectSummary) {
    const withClips = confirm(`Back up "${p.title}".

OK: include the rendered clips and exports (bigger file).
Cancel: story, plan and pictures only (small; clips can be rendered again).`);
    const dest = await nativeFolder();
    if (!dest) return;
    try {
      const r = await api.backup(p.id, dest, withClips);
      notify({ message: `Backup saved: ${r.file} (${(r.bytes / 1048576).toFixed(1)} MB)`, tab: "series" });
    } catch (e: any) { setError(e?.message || String(e)); }
  }
  /** Brings a backup zip back as a new series. */
  async function importOne() {
    try {
      const { path } = await api.pickBackup();
      if (!path) return;
      const r = await api.importBackup(path);
      notify({ message: `Imported "${r.title}" (${r.episodes} episodes)`, tab: "series" });
      refresh(); onOpen(r.id);
    } catch (e: any) { setError(e?.message || String(e)); }
  }
  /** Archived series leave the list (nothing is deleted) and come back from "Archived". */
  async function archive(p: ProjectSummary, on: boolean) {
    try { await api.patch(p.id, { archived: on }); notify({ message: on ? `"${p.title}" archived - find it under Archived` : `"${p.title}" is back in your series`, tab: "series" }); refresh(); }
    catch (e: any) { setError(e?.message || String(e)); }
  }
  async function remove(id: string, name: string) {
    if (!confirm(`Delete "${name}" and everything rendered in it? This cannot be undone.`)) return;
    await api.remove(id);
    refresh();
  }

  const homeDefs: TileDef[] = [
    { id: "summary", title: "All series", x: 0, y: 0, w: 8, h: 17 },
    { id: "new", title: "Start a new series", x: 8, y: 0, w: 16, h: 17 },
    ...shown.map((p, i): TileDef => ({ id: "p:" + p.id, title: p.title, x: (i % 3) * 8, y: 17 + Math.floor(i / 3) * 21, w: 8, h: 21 })),
  ];
  const total = projects.reduce((a, p) => ({ eps: a.eps + p.episodes, scenes: a.scenes + p.scenes, done: a.done + p.scenesDone, joined: a.joined + p.exports }), { eps: 0, scenes: 0, done: 0, joined: 0 });
  const overall = total.scenes ? Math.round((total.done / total.scenes) * 100) : 0;

  return (
    <div className="h-full overflow-y-auto pr-1 pb-8">
      <PageTitle>Series</PageTitle>
      {error && <div className="mb-3 rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-xs text-rose-200">{error}</div>}

      <TileBoard id="series-home" defs={homeDefs}>
        <Tile id="summary" tone="dark" delay={0.02} className="min-h-[11rem]" heading="All series">
          <div className="flex items-center gap-5">
            <Ring pct={overall} size={92} stroke={6} sub="of scenes" />
            <div className="text-[11px] opacity-75 space-y-1">
              <p><span className="text-2xl font-extralight tracking-tight opacity-100">{projects.length}</span> series</p>
              <p>{total.eps} episodes · {total.done}/{total.scenes} scenes</p>
              <p>{total.joined} joined</p>
            </div>
          </div>
        </Tile>

        <Tile id="new" delay={0.06} className="min-h-[11rem]" heading="Start a new series" aside={<Sparkles size={15} className="opacity-60" />}>
          <p className="text-[11px] opacity-60 mb-3">Name it - the next screen is a conversation about what it should be.</p>
          <div className="flex items-center gap-2 max-w-xl">
            <input className={field} placeholder="New series title" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === "Enter" && create()} />
            {templates.length > 0 && (
              <select value={templateId} onChange={e => setTemplateId(e.target.value)} title="Start from a saved way of making a series: style, voice, workflows and size" className="shrink-0 rounded-lg border border-current/20 bg-transparent px-2 py-2 text-xs focus:outline-none [&_*]:bg-white [&_*]:text-black">
                <option value="">Blank series</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.builtin ? "" : " (mine)"}</option>)}
              </select>
            )}
            <motion.button whileHover={{ scale: title.trim() ? 1.03 : 1 }} whileTap={{ scale: 0.97 }} onClick={create} disabled={!title.trim()}
              className="flex shrink-0 items-center gap-2 rounded-full bg-zinc-900 text-white px-4 py-2 text-xs font-semibold shadow-lg disabled:opacity-40"><Plus size={14} /> Start a series</motion.button>
          </div>
          <button onClick={importOne} className="mt-3 text-[11px] underline opacity-60 hover:opacity-100" title="Pick a series backup (.zip) made on this or another PC">Import a series backup...</button>
        </Tile>


        {shown.map((p, i) => {
          const d = full[p.id];
          const pct = p.scenes ? Math.round((p.scenesDone / p.scenes) * 100) : 0;
          const stills = d ? d.episodes.flatMap(e => e.refs).filter(r => r.file).slice(0, 3) : [];
          return (
            <React.Fragment key={p.id}>
              <Tile id={"p:" + p.id} delay={0.1 + i * 0.05} className="min-h-[15rem] flex flex-col group" onClick={() => onOpen(p.id)} title={`Open ${p.title}`}>
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
                <span role="button" tabIndex={0} data-split onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); remove(p.id, p.title); }} className="absolute right-4 bottom-4 z-10 cursor-pointer opacity-0 group-hover:opacity-70 hover:!opacity-100 transition" title="Delete series"><Trash2 size={14} /></span>
                <span role="button" tabIndex={0} data-split onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); backUp(p); }} className="absolute right-10 bottom-4 z-10 cursor-pointer opacity-0 group-hover:opacity-70 hover:!opacity-100 transition" title="Export: back up this series to a zip"><Download size={14} /></span>
                <span role="button" tabIndex={0} data-split onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); archive(p, !full[p.id]?.archived); }} className="absolute right-16 bottom-4 z-10 cursor-pointer opacity-0 group-hover:opacity-70 hover:!opacity-100 transition" title={full[p.id]?.archived ? "Bring this series back to the list" : "Archive: hide this series from the list (nothing is deleted)"}>{full[p.id]?.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}</span>
              </Tile>
            </React.Fragment>
          );
        })}
      </TileBoard>
        {loading && <div className="mt-3 flex items-center gap-2 text-sm opacity-60"><Loader2 size={14} className="animate-spin" /> Loading projects...</div>}
        {!loading && !projects.length && (
          <Tile delay={0.1} className="mt-3 text-center py-12" heading="">
            <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 3.2, ease: "easeInOut" }}><Film size={30} className="mx-auto opacity-40" /></motion.div>
            <p className="mt-3 text-sm opacity-70">No series yet.</p>
          </Tile>
        )}

      {(archivedCount > 0 || showArchived) && (
        <div className="mt-4 text-center">
          <button onClick={() => setShowArchived(a => !a)} className="inline-flex items-center gap-1.5 rounded-full sd-frost border px-3 py-1.5 text-xs opacity-75 hover:opacity-100">
            {showArchived ? <><ArrowLeft size={12} /> Back to your series</> : <><Archive size={12} /> Archived ({archivedCount})</>}
          </button>
        </div>
      )}
      {root && <p className="mt-6 text-center text-[11px] opacity-45">Series are folders under {root}</p>}
    </div>
  );
}

function TemplateBox({ project }: { project: Project }) {
  const [list, setList] = React.useState<SeriesTemplate[]>([]);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const load = React.useCallback(() => api.templates().then(d => setList(d.templates)).catch(() => {}), []);
  React.useEffect(() => { load(); }, [load]);
  const save = async () => {
    setBusy(true); setError("");
    try { await api.saveTemplate(project.id, name); setName(""); await load(); } catch (e: any) { setError(e?.message || String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className={`${field} text-xs`} value={name} onChange={e => setName(e.target.value)} placeholder="Template name, e.g. My UGC setup" onKeyDown={e => e.key === "Enter" && name.trim() && save()} />
        <button onClick={save} disabled={busy || !name.trim()} className="shrink-0 rounded-lg bg-neutral-700 px-3 py-2 text-xs text-white hover:bg-neutral-600 disabled:opacity-40">Save as template</button>
      </div>
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
      <div className="space-y-1">
        {list.map(t => (
          <div key={t.id} className="flex items-center gap-2 rounded-lg bg-neutral-900/60 px-2.5 py-1.5 text-xs text-neutral-300">
            <span className="min-w-0 flex-1 truncate">{t.name}{t.builtin ? " (built in)" : ""}<span className="ml-2 text-[10px] text-neutral-500">{t.format}{t.voice !== "auto" ? `, voice ${t.voice}` : ""}</span></span>
            {!t.builtin && <button onClick={async () => { if (confirm(`Remove the template "${t.name}"?`)) { await api.deleteTemplate(t.id); load(); } }} className="text-[10px] text-neutral-500 hover:text-rose-300">remove</button>}
          </div>
        ))}
      </div>
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
        <WorkflowPicker project={project} kind="video" label="Clip workflow (reference pictures to video)" value={draft.videoWorkflow} onChange={path => { const next = { ...draft, videoWorkflow: path }; setDraft(next); saveSettings(next); }} />
        <WorkflowPicker project={project} kind="image" label="Still workflow (a photo to new stills, or text to image)" value={draft.imageWorkflow} onChange={path => { const next = { ...draft, imageWorkflow: path }; setDraft(next); saveSettings(next); }} />
        <p className="text-[11px] text-neutral-500">Workflows come from the same folder as the Image and Video tabs. Each one is checked against this series: it must run, and take the reference photos and pictures your scenes use. Size, duration and steps below are written into whichever inputs the workflow exposes.</p>
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
        <h3 className="text-sm font-medium text-neutral-200">Templates</h3>
        <p className="text-[11px] text-neutral-500">Save how this series is made (video style, voice, look, workflows, size and length) so a new series can start from it. Nothing from the story, episodes, pictures or people is saved.</p>
        <TemplateBox project={project} />
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
        <h3 className="text-sm font-medium text-neutral-200">Locks</h3>
        <label className="block text-[11px] text-neutral-500">Style lock - pasted into every scene prompt so the look does not drift</label>
        <textarea className={`${field} h-20 resize-none text-xs`} value={locks.styleLock} onChange={e => setLocks({ ...locks, styleLock: e.target.value })} onBlur={() => saveLocks()} />
        <label className="block text-[11px] text-neutral-500">Voice lock - who speaks or sings, restated in every scene (for on-camera styles, describe the person's voice; the style default is used while this is still the narrator)</label>
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

export function SeriesStudioView({ modelId, models, look }: { modelId?: string; models?: AIModel[]; look?: "light" | "dark" }) {
  // Opens straight into the series you were last in, as an immersive board; "All series" goes back to the list.
  const [projectId, setProjectId] = React.useState<string | null>(() => store.get(LAST_KEY));
  const [project, setProject] = React.useState<Project | null>(null);
  const [stage, setStage] = React.useState<Stage>("dashboard");
  const [addFocus, setAddFocus] = React.useState(false);
  const [focusEpisode, setFocusEpisode] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [theme, setTheme] = React.useState<"light" | "dark">(() => (store.get(THEME_KEY) === "dark" ? "dark" : store.get(THEME_KEY) === "light" ? "light" : look || "light"));

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
  React.useEffect(() => { if (project) baselineSeen(project); }, [project?.id]);

  const [renaming, setRenaming] = React.useState(false);
  const [joining, setJoining] = React.useState(false);
  const [others, setOthers] = React.useState<ProjectSummary[]>([]);
  const rename = async (title: string) => {
    setRenaming(false);
    const t = title.trim();
    if (!project || !t || t === project.title) return;
    try { setProject(await api.patch(project.id, { title: t })); } catch (e: any) { setError(e?.message || String(e)); }
  };
  const openJoin = async () => { try { setOthers((await api.list()).projects.filter(p => p.id !== projectId)); setJoining(j => !j); } catch (e: any) { setError(e?.message || String(e)); } };
  const joinWith = async (other: ProjectSummary) => {
    if (!project || !confirm(`Add every episode of "${other.title}" to the end of "${project.title}"?\n\nTheir pictures and clips are copied into this series. "${other.title}" stays as it is.`)) return;
    try { const r = await api.merge(project.id, other.id); setProject(await api.get(project.id)); setJoining(false); notify({ message: `Joined "${other.title}": ${r.episodes} episodes added`, tab: "series" }); } catch (e: any) { setError(e?.message || String(e)); }
  };

  // Live job events: the server pushes status changes as renders start, progress and finish.
  React.useEffect(() => {
    if (!projectId) return;
    let timer: any = null;
    const stop = onSeriesEvent(data => {
      if (data.projectId !== projectId) return;
      {
        if (["started", "finished", "failed", "updated", "stitched"].includes(data.type)) {
          clearTimeout(timer);
          timer = setTimeout(() => reload(projectId), 150); // several events can land together
        } else if (data.type === "progress") {
          setProject(p => (p ? { ...p, running: p.running ? { ...p.running, progress: [data.value, data.max] } : p.running } : p));
        }
      }
    });
    return () => { clearTimeout(timer); stop(); };
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
                  <span className="ml-auto flex items-center gap-3"><span className="rounded-full sd-frost border px-3 py-1"><ComfyStatus compact /></span>{themeButton}</span>
                </header>
                <div className="flex-1 min-h-0"><SeriesHome onOpen={open} /></div>
              </>
            ) : (
              <>
                <header className="flex flex-wrap items-center gap-3 mb-3">
                  <button onClick={() => open(null)} className="flex items-center gap-1.5 rounded-full sd-frost border px-3 py-1.5 text-xs hover:opacity-80">
                    <ArrowLeft size={14} /> All series
                  </button>
                  {renaming && project ? (
                    <input autoFocus defaultValue={project.title} onBlur={e => rename(e.target.value)} onKeyDown={e => { if (e.key === "Enter") rename((e.target as HTMLInputElement).value); if (e.key === "Escape") setRenaming(false); }} className="min-w-0 rounded-lg border border-current/30 bg-transparent px-2 py-1 text-base font-medium tracking-tight focus:outline-none" />
                  ) : (
                    <h2 className="group flex min-w-0 items-center gap-1.5 text-base font-medium tracking-tight">
                      <span className="truncate" onDoubleClick={() => project && setRenaming(true)} title="Double-click to rename">{project?.title || "Loading..."}</span>
                      {project && <button onClick={() => setRenaming(true)} title="Rename this series" className="opacity-40 transition hover:opacity-100"><Pencil size={13} /></button>}
                    </h2>
                  )}
                  <div className="relative">
                    <button onClick={openJoin} title="Add another series' episodes to this one" className="flex items-center gap-1 rounded-full sd-frost border px-2.5 py-1 text-[11px] opacity-70 hover:opacity-100"><GitMerge size={12} /> Join a series</button>
                    {joining && (
                      <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-xl border bg-zinc-900 p-1.5 text-white shadow-2xl">
                        <p className="px-2 pb-1 pt-1 text-[10px] uppercase tracking-wider opacity-50">Add the episodes of...</p>
                        {others.length === 0 && <p className="px-2 py-2 text-xs opacity-60">There is no other series.</p>}
                        {others.map(o => <button key={o.id} onClick={() => joinWith(o)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white/10"><span className="truncate">{o.title}</span><span className="shrink-0 text-[10px] opacity-50">{o.episodes} ep</span></button>)}
                      </div>
                    )}
                  </div>
                  <nav className="ml-auto flex items-center gap-1 rounded-full sd-frost border p-1">
                    {STAGES.map(s => {
                      const Icon = s.icon;
                      const active = stage === s.id;
                      return (
                        <button key={s.id} onClick={() => { setFocusEpisode(null); setAddFocus(false); setStage(s.id); }} title={s.hint} className="relative rounded-full px-3 py-1.5 text-xs">
                          {active && (
                            <motion.span layoutId="series-stage-pill" transition={{ type: "spring", stiffness: 420, damping: 32 }}
                              className="absolute inset-0 rounded-full sd-dark" />
                          )}
                          <span className={`relative flex items-center gap-1.5 transition-opacity ${active ? "text-white" : "opacity-65 hover:opacity-100"}`}>
                            <Icon size={13} />
                            {s.id === "dashboard" && project ? <span className="max-w-[10rem] truncate">{project.title}</span> : s.id !== "settings" && s.label}
                          </span>
                        </button>
                      );
                    })}
                  </nav>
                  <span className="rounded-full sd-frost border px-3 py-1"><ComfyStatus compact /></span>
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
                        <ProjectDashboard project={project} onChanged={setProject} onGo={(st, episodeId) => { setFocusEpisode(episodeId || null); setStage(st); }} />
                      ) : stage === "develop" ? (
                        <Develop project={project} modelId={modelId} models={models} onSaved={setProject} focusAdd={addFocus} />
                      ) : stage === "produce" ? (
                        <Board project={project} onChanged={setProject} onOpenSettings={() => setStage("settings")} focusEpisodeId={focusEpisode} onAddEpisode={() => { setAddFocus(true); setStage("develop"); }} />
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
