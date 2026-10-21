import React from "react";
import { ReorderGroup } from "../ui/Reorder";
import { Bookmark, CornerUpLeft, Pause, RotateCw, FolderOpen, Play, Square, Loader2, RefreshCw, AlertTriangle, ChevronDown, Trash2, ExternalLink, Dices, X, ImageIcon, Film, Layers, Type, SlidersHorizontal, Plus, Save, Wand2, Ruler, ArrowLeftRight, ListPlus, Minus } from "lucide-react";
import { FolderPickerDialog } from "../tools/FolderPickerDialog";
import { ProgressBar } from "../layout/ProgressBar";
import { notify, notifyError } from "../../lib/notify";
import { PromptSource } from "./PromptSource";
import { takePending } from "../../lib/studioBridge";
import type { StudioRequest } from "../../services/studioIntent";
import { PreviousResults } from "./PreviousResults";
import { ShareMenu } from "./ShareMenu";
import { Converter } from "./Converter";
import { QueueList } from "./shared";
import { SortMenu } from "./SortMenu";
import { HistoryPanel, PromptItem } from "./HistoryPanel";
import { ACCENT, HistoryItem, WorkflowField, Kind, MediaItem, RunRow, WorkflowInfo, api, fileUrl, nativeFiles, nativeFolder, postJson } from "./types";

const label = "text-[10px] text-zinc-600 font-bold uppercase tracking-widest mb-2 block";
const input = "w-full bg-white/5 border-none rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-1 placeholder:text-zinc-700";
const isVideo = (p: string) => /\.(mp4|webm|mov|mkv)$/i.test(p);
const isImage = (p: string) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(p);

const MAX_INSTANCES = 20;
const SIZE_PRESETS: Record<Kind, [number, number, string?][]> = {
  image: [[512, 512, "SD 1.5"], [768, 768], [1024, 1024, "SDXL / Flux"], [1152, 896], [896, 1152], [1344, 768, "16:9"], [768, 1344, "9:16"], [1536, 1024, "3:2"]],
  video: [[512, 512], [768, 512, "LTX"], [512, 768], [704, 480], [832, 480, "Wan"], [480, 832], [1024, 576, "16:9"], [1280, 720, "HD"], [720, 1280, "9:16"]],
};
interface ToolState { workflowFolder: string; refFolder: string; destination: string; defaultDestination: string; outputFilename: string; lastWorkflow: string; comfyReachable: boolean }

function Media({ path, className }: { path: string; className?: string }) {
  if (isVideo(path)) return <video src={fileUrl(path)} controls loop muted className={className} />;
  if (isImage(path)) return <img src={fileUrl(path)} alt="" className={className} />;
  return <audio src={fileUrl(path)} controls className="w-full" />;
}

/**
 * Runs saved ComfyUI workflows for one tab (images or video). Workflows come from a folder of .json files; the prompt,
 * reference slots and main settings are worked out from each graph, so nothing has to be wired by hand.
 */
export function WorkflowRunner({ kind, modelId, toolbar, showHistory, onCloseHistory }: { kind: Kind; modelId?: string; toolbar?: React.ReactNode; showHistory?: boolean; onCloseHistory?: () => void }) {
  const a = ACCENT[kind];
  const ring = `focus:ring-1 ${a.ring}`;
  const [st, setSt] = React.useState<ToolState | null>(null);
  const [folder, setFolder] = React.useState("");
  const [workflows, setWorkflows] = React.useState<WorkflowInfo[]>([]);
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState("");
  const [filter, setFilter] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [fieldValues, setFieldValues] = React.useState<Record<string, any>>({});
  const [randomSeed, setRandomSeed] = React.useState(true);
  const [dest, setDest] = React.useState("");
  const [fileName, setFileName] = React.useState("");
  const [picker, setPicker] = React.useState<null | "workflows" | "refs" | "dest">(null);

  const [refFolder, setRefFolder] = React.useState("");
  const [media, setMedia] = React.useState<MediaItem[]>([]);
  // One entry per reference slot, per media type; "" = slot skipped for this run.
  const [slots, setSlots] = React.useState<Record<"image" | "video" | "audio", string[]>>({ image: [], video: [], audio: [] });

  const [runId, setRunId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState("");
  const [progress, setProgress] = React.useState<[number, number] | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [queueNote, setQueueNote] = React.useState("");
  const [result, setResult] = React.useState<string | null>(null);
  const [runError, setRunError] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<HistoryItem[]>([]);
  const [active, setActive] = React.useState<RunRow[]>([]);
  const esRef = React.useRef<EventSource | null>(null);
  const pausedRef = React.useRef<string | null>(null);
  const [viewPath, setViewPath] = React.useState<string | null>(null);
  const [activeSetup, setActiveSetup] = React.useState<string | null>(null);
  // Saved setups: a named snapshot of workflow + prompt + settings + references + destination. Kept in this browser.
  interface Setup { name: string; workflow: string; prompt: string; fieldValues: Record<string, any>; randomSeed: boolean; dest: string; fileName: string; slots?: Record<"image" | "video" | "audio", string[]> }
  const setupKey = `cursed.comfySetups.${kind}`;
  const [setups, setSetups] = React.useState<Setup[]>(() => { try { return JSON.parse(localStorage.getItem(setupKey) || "[]"); } catch { return []; } });
  const [pendingSetup, setPendingSetup] = React.useState<Setup | null>(null);
  const persistSetups = (list: Setup[]) => { setSetups(list); try { localStorage.setItem(setupKey, JSON.stringify(list)); } catch { /* private window */ } };
  const [batch, setBatch] = React.useState<string[]>([]);
  const [queuing, setQueuing] = React.useState(false);

  const wf = workflows.find(w => w.path === selected) || null;
  const busy = !!runId;

  const loadHistory = React.useCallback(() => api<{ history: HistoryItem[] }>(`/api/tool/history?kind=${kind}`).then(d => setHistory(d.history)).catch(() => {}), [kind]);

  const loadWorkflows = React.useCallback(async (dir: string, keep?: string) => {
    setLoading(true); setLoadError(null);
    try {
      const d = await api<{ workflows: WorkflowInfo[]; counts: Record<string, number>; folder: string }>(`/api/tool/workflows?kind=${kind}&folder=${encodeURIComponent(dir)}`);
      setWorkflows(d.workflows); setCounts(d.counts); setFolder(d.folder);
      const pick = d.workflows.find(w => w.path === keep) || d.workflows.find(w => w.isRunnable) || d.workflows[0];
      setSelected(pick?.path || "");
    } catch (e: any) { setLoadError(e.message); setWorkflows([]); }
    finally { setLoading(false); }
  }, [kind]);

  // First load: remembered folder, destination, last workflow.
  React.useEffect(() => {
    let live = true;
    api<ToolState>(`/api/tool/state?kind=${kind}`).then(s => {
      if (!live) return;
      setSt(s); setDest(s.destination); setFileName(s.outputFilename); setRefFolder(s.refFolder);
      if (s.workflowFolder) loadWorkflows(s.workflowFolder, s.lastWorkflow);
      if (s.refFolder) api<{ items: MediaItem[] }>(`/api/tool/ref-media?folder=${encodeURIComponent(s.refFolder)}`).then(d => live && setMedia(d.items)).catch(() => {});
    }).catch(e => setLoadError(e.message));
    loadHistory();
    return () => { live = false; };
  }, [kind, loadWorkflows, loadHistory]);

  // Reset per-workflow inputs when the workflow changes.
  React.useEffect(() => {
    if (!wf) return;
    setFieldValues({});
    setSlots({ image: Array(wf.refImageCount).fill(""), video: Array(wf.refVideoCount).fill(""), audio: Array(wf.refAudioCount).fill("") });
    setSkip({ image: wf.refImageBypassable.map(Boolean), video: wf.refVideoBypassable.map(Boolean), audio: wf.refAudioBypassable.map(Boolean) });
    postJson("/api/tool/state", { kind, lastWorkflow: wf.path }).catch(() => {});
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // A setup picked from the list: switch workflow first (which resets the inputs), then fill them in.
  React.useEffect(() => {
    if (!pendingSetup || selected !== pendingSetup.workflow) return;
    setPrompt(pendingSetup.prompt); setFieldValues(pendingSetup.fieldValues); setRandomSeed(pendingSetup.randomSeed);
    setDest(pendingSetup.dest); setFileName(pendingSetup.fileName); if (pendingSetup.slots) setSlots(pendingSetup.slots);
    setPendingSetup(null);
  }, [pendingSetup, selected, wf]);

  // Jobs waiting / running in ComfyUI (also ones from a previous page load); a popup for every one that finishes or fails.
  const seenFinished = React.useRef<Set<string> | null>(null);
  React.useEffect(() => {
    const poll = () => api<{ active: RunRow[]; finished: RunRow[] }>(`/api/tool/runs?kind=${kind}`).then(d => {
      setActive(d.active);
      if (seenFinished.current === null) { seenFinished.current = new Set(d.finished.map(r => r.runId)); return; }
      for (const r of d.finished) {
        if (seenFinished.current.has(r.runId)) continue;
        seenFinished.current.add(r.runId);
        if (notified.current.has(r.runId)) continue;
        notified.current.add(r.runId);
        if (r.status === "done") notify({ message: `${kind === "image" ? "Image" : "Video"} ready - ${r.workflow}`, tab: kind, thumb: r.result && isImage(r.result) ? fileUrl(r.result) : undefined });
        else if (r.status === "failed") notifyError(`${r.workflow} failed: ${r.error || "unknown error"}`, kind);
      }
    }).catch(() => {});
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [kind]);

  const activeCount = active.length;
  React.useEffect(() => { loadHistory(); }, [activeCount, loadHistory]);

  React.useEffect(() => () => esRef.current?.close(), []);

  const saveRoles = async (promptNodeId: string, outputNodeId: string) => {
    if (!wf) return;
    try {
      const updated = await postJson("/api/tool/workflow-roles", { path: wf.path, promptNodeId, outputNodeId });
      setWorkflows(ws => ws.map(w => w.path === wf.path ? updated : w));
    } catch (e: any) { notifyError(e.message, kind); }
  };

  const loadRefs = async (dir: string) => {
    try {
      const d = await api<{ items: MediaItem[] }>(`/api/tool/ref-media?folder=${encodeURIComponent(dir)}`);
      setMedia(d.items); setRefFolder(dir);
    } catch (e: any) { notifyError(e.message, kind); }
  };

  // Files dropped on the reference card are saved into the reference folder and fill the first free slot of their type.
  const [refDrag, setRefDrag] = React.useState(false);
  const dropRefs = async (files: File[]) => {
    for (const f of files) {
      try {
        const d = await api<{ folder: string; item: MediaItem }>(`/api/tool/ref-upload?name=${encodeURIComponent(f.name)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: f });
        setRefFolder(d.folder);
        setMedia(m => [...m.filter(x => x.path !== d.item.path), d.item].sort((x, y) => x.name.localeCompare(y.name)));
        setSlots(s => {
          const i = s[d.item.type].findIndex(v => !v);
          return i < 0 ? s : { ...s, [d.item.type]: s[d.item.type].map((v, j) => j === i ? d.item.path : v) };
        });
      } catch (e: any) { notifyError(`${f.name}: ${e.message}`, kind); }
    }
  };

  // Windows' own dialogs first; the in-app folder browser only if that is unavailable (non-Windows).
  const chooseFolder = async (which: "workflows" | "refs" | "dest") => {
    const initial = which === "workflows" ? folder : which === "refs" ? refFolder : dest;
    const p = await nativeFolder(initial);
    if (p === undefined) { setPicker(which); return; }
    if (p === null) return;
    if (which === "workflows") loadWorkflows(p); else if (which === "refs") loadRefs(p); else setDest(p);
  };
  const chooseRefFiles = async () => {
    const items = await nativeFiles(refFolder);
    if (items === null) { fileInputRef.current?.click(); return; }
    addRefItems(items);
  };
  const addRefItems = (items: MediaItem[]) => {
    if (!items.length) return;
    setMedia(m => [...m.filter(x => !items.some(i => i.path === x.path)), ...items]);
    setSlots(s => {
      const next = { image: [...s.image], video: [...s.video], audio: [...s.audio] };
      for (const it of items) { const i = next[it.type].findIndex(v => !v); if (i >= 0) next[it.type][i] = it.path; }
      return next;
    });
  };
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const setSlot = (type: "image" | "video" | "audio", i: number, p: string) => setSlots(s => ({ ...s, [type]: s[type].map((v, j) => j === i ? p : v) }));

  // Bypass flags for the optional reference slots (checked = the slot is skipped for the run).
  const [skip, setSkip] = React.useState<Record<"image" | "video" | "audio", boolean[]>>({ image: [], video: [], audio: [] });
  const [count, setCount] = React.useState(1);
  const toggleSkip = (t: "image" | "video" | "audio", i: number, on: boolean) => {
    setSkip(s => ({ ...s, [t]: s[t].map((v, j) => j === i ? on : v) }));
    if (on) setSlot(t, i, "");
  };
  // Choosing a file un-bypasses its slot.
  React.useEffect(() => {
    setSkip(s => {
      const next = { image: [...s.image], video: [...s.video], audio: [...s.audio] };
      let changed = false;
      for (const t of ["image", "video", "audio"] as const) slots[t].forEach((p, i) => { if (p && next[t][i]) { next[t][i] = false; changed = true; } });
      return changed ? next : s;
    });
  }, [slots]);
  const effSlots = { image: slots.image.map((p, i) => skip.image[i] ? "" : p), video: slots.video.map((p, i) => skip.video[i] ? "" : p), audio: slots.audio.map((p, i) => skip.audio[i] ? "" : p) };

  // Size & duration: the width / height / length / fps inputs the workflow exposes.
  const val = (f: WorkflowField) => (f.id in fieldValues ? fieldValues[f.id] : f.value);
  const setField = (id: string, x: any) => setFieldValues(s => ({ ...s, [id]: x }));
  const roleOf = (r: string) => (wf ? wf.fields.filter(f => f.role === r) : []);
  const setRole = (r: string, x: any) => setFieldValues(s => { const n = { ...s }; for (const f of roleOf(r)) n[f.id] = x; return n; });
  const sizeW = roleOf("width")[0], sizeH = roleOf("height")[0], lengthF = roleOf("length")[0], fpsF = roleOf("fps")[0];
  const roleFields = roleOf("size");
  const otherFields = wf ? wf.fields.filter(f => !f.role) : [];
  const setSize = (w: number, h: number) => { if (w > 0) setRole("width", w); if (h > 0) setRole("height", h); };
  const sizePresets = SIZE_PRESETS[kind];
  const curW = sizeW ? Number(val(sizeW)) : 0, curH = sizeH ? Number(val(sizeH)) : 0;
  const presetKey = sizePresets.some(([w, h]) => w === curW && h === curH) ? `${curW}x${curH}` : "custom";
  const fps = (fpsF ? Number(val(fpsF)) : 0) || 24;
  const frames = lengthF ? Number(val(lengthF)) || 0 : 0;
  const seconds = frames / fps;
  const setSeconds = (sec: number) => {
    if (!lengthF || !(sec > 0)) return;
    let n = Math.max(1, Math.round(sec * fps));
    if (lengthF.snap) n = Math.max(1, Math.round((n - 1) / lengthF.snap)) * lengthF.snap + 1;
    setRole("length", n);
  };

  // Sorting / searching the workflow list (the arrows icon next to the list).
  const sortKey0 = (() => { try { return localStorage.getItem(`cursed.comfySort.${kind}`) || "name"; } catch { return "name"; } })();
  const [sort, setSortState] = React.useState(sortKey0);
  const setSort = (k: string) => { setSortState(k); try { localStorage.setItem(`cursed.comfySort.${kind}`, k); } catch { /* private window */ } };
  const recentKey = `cursed.comfyRecent.${kind}`;
  const readRecent = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(recentKey) || "{}"); } catch { return {}; } };
  const markUsed = (path: string) => { const r = readRecent(); r[path] = Date.now(); try { localStorage.setItem(recentKey, JSON.stringify(r)); } catch { /* private window */ } };

  // Run the prompt(s) `count` times each. The first goes on screen when nothing is running; everything else just joins the queue.
  const notified = React.useRef(new Set<string>());
  const submit = async (texts: string[]) => {
    if (!wf || !canRunBase) return;
    const list = texts.filter(t => t.trim() || !wf.needsPrompt);
    if (!list.length) return;
    const jobs = list.flatMap(t => Array(count).fill(t) as string[]);
    const many = jobs.length > 1;
    setQueuing(true); setRunError(null);
    try {
      let first = !busy;
      for (const t of jobs) {
        const { runId: id } = await postJson("/api/tool/run", {
          kind, workflowPath: wf.path, promptText: t, fieldValues, randomizeSeed: randomSeed || many,
          refImagePaths: effSlots.image, refVideoPaths: effSlots.video, refAudioPaths: effSlots.audio,
          outputFolder: dest, outputFilename: many ? "" : fileName,
        });
        if (first) { setResult(null); setProgress(null); setPreview(null); setStatus("Starting"); setRunId(id); watch(id); first = false; }
      }
      markUsed(wf.path);
      postJson("/api/tool/state", { kind, destination: dest, outputFilename: fileName }).catch(() => {});
      if (many || busy) notify({ message: `Added ${jobs.length} job${jobs.length > 1 ? "s" : ""} to the queue`, tab: kind });
    } catch (e: any) { setRunError(e.message); notifyError(e.message, kind); }
    finally { setQueuing(false); }
  };


  const missingRefs = wf ? (["image", "video", "audio"] as const).flatMap(t => slots[t].map((p, i) => ({ t, i, p, bypass: !!wf[`ref${t[0].toUpperCase()}${t.slice(1)}Bypassable` as "refImageBypassable"][i] })).filter(r => !r.p && (!r.bypass || !skip[t][r.i]))) : [];
  const canRunBase = !!wf && wf.isRunnable && missingRefs.length === 0 && wf.needsAssignment.length === 0;
  const canRun = canRunBase && !queuing && (!wf!.needsPrompt || prompt.trim().length > 0);

  const watch = (id: string) => {
    esRef.current?.close();
    const es = new EventSource(`/api/tool/progress/${id}`);
    esRef.current = es;
    const finish = () => { es.close(); esRef.current = null; setRunId(null); setPreview(null); setQueueNote(""); loadHistory(); };
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      switch (e.type) {
        case "submitted": setStatus("Queued in ComfyUI"); break;
        case "status": setStatus(/^submitted/i.test(e.message) ? "Waiting for ComfyUI" : e.message); break;
        case "queue": setQueueNote(e.remaining > 1 ? `${e.remaining - 1} job(s) ahead` : ""); break;
        case "progress": setStatus("Generating"); setProgress([e.value, e.max]); setQueueNote(""); break;
        case "preview": setPreview(`data:image/jpeg;base64,${e.image_b64}`); break;
        case "log": break;
        case "done": notified.current.add(id); setResult(e.path); setViewPath(e.path); setProgress(null); notify({ message: `${kind === "image" ? "Image" : "Video"} ready - ${wf?.name || "workflow"}`, tab: kind, thumb: isImage(e.path) ? fileUrl(e.path) : undefined }); finish(); break;
        case "failed": notified.current.add(id); setRunError(e.message); notifyError(`${wf?.name || "Workflow"} failed: ${e.message}`, kind); finish(); break;
        case "cancelled": setStatus("Cancelled"); setRunError(pausedRef.current === id ? "Paused - resume it under Jobs." : "Cancelled"); finish(); break;
      }
    };
    es.onerror = () => { /* EventSource retries by itself with Last-Event-ID; the server closes cleanly when the run ends */ if (es.readyState === EventSource.CLOSED) finish(); };
  };

  // "Use" in the prompt library: restore the prompt and, when the workflow is in this folder, select it with its settings.
  const useEntry = (it: PromptItem) => {
    const w = workflows.find(x => x.path.split("\\").join("/").endsWith(`/${it.workflow}.json`)) || workflows.find(x => x.name === it.workflow);
    if (w && w.path !== selected) setPendingSetup({ name: "", workflow: w.path, prompt: it.prompt, fieldValues: it.params?.fieldValues || {}, randomSeed: true, dest, fileName: "" });
    else { setPrompt(it.prompt); if (it.params?.fieldValues) setFieldValues(it.params.fieldValues); }
    onCloseHistory?.();
    notify({ message: w ? "Prompt and settings restored" : "Prompt restored (its workflow is not in this folder)", tab: kind });
  };


  // The voice assistant (or anything else) can hand this studio a prompt and ask it to start.
  const [autoGen, setAutoGen] = React.useState(0);
  React.useEffect(() => {
    const apply = (r: StudioRequest) => { if (r.kind !== kind) return; if (r.prompt) setPrompt(r.prompt); if (r.generate) setAutoGen(n => n + 1); };
    const waiting = takePending(kind);
    if (waiting) apply(waiting);
    const onReq = (e: Event) => { apply((e as CustomEvent<StudioRequest>).detail); takePending(kind); };
    window.addEventListener("cursed:studio", onReq);
    return () => window.removeEventListener("cursed:studio", onReq);
  }, [kind]);
  React.useEffect(() => { if (autoGen > 0) submit([prompt]); }, [autoGen]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveSetup = () => {
    if (!wf) return;
    let name: string | undefined;
    try { name = window.prompt("Name this setup", wf.name)?.trim(); } catch { name = wf.name; }
    if (!name) return;
    const snap: Setup = { name, workflow: wf.path, prompt, fieldValues, randomSeed, dest, fileName, slots };
    persistSetups([snap, ...setups.filter(x => x.name !== name)]);
    setActiveSetup(name);
    notify({ message: `Saved setup "${name}"`, tab: kind });
  };
  const loadSetup = (name: string) => {
    const x = setups.find(v => v.name === name);
    if (!x) return;
    setActiveSetup(name);
    if (!workflows.some(w => w.path === x.workflow)) { notifyError("That setup's workflow is not in the current folder.", kind); return; }
    if (x.workflow === selected) { setPrompt(x.prompt); setFieldValues(x.fieldValues); setRandomSeed(x.randomSeed); setDest(x.dest); setFileName(x.fileName); if (x.slots) setSlots(x.slots); }
    else { setPendingSetup(x); setSelected(x.workflow); }
  };
  const deleteSetup = (name: string) => persistSetups(setups.filter(x => x.name !== name));

  const cancel = async () => { if (runId) await postJson(`/api/tool/cancel/${runId}`, {}).catch(() => {}); };
  const refreshJobs = () => api<{ active: RunRow[] }>(`/api/tool/runs?kind=${kind}`).then(d => setActive(d.active)).catch(() => {});
  const cancelOther = (id: string) => postJson(`/api/tool/cancel/${id}`, {}).then(refreshJobs).catch(() => {});
  const pauseJob = (id: string) => { pausedRef.current = id; postJson(`/api/tool/pause/${id}`, {}).then(refreshJobs).catch((e) => notifyError(e.message, kind)); };
  const resumeJob = (id: string) => postJson(`/api/tool/resume/${id}`, {}).then(refreshJobs).catch((e) => notifyError(e.message, kind));
  const dropJob = (id: string) => api(`/api/tool/runs/${id}`, { method: "DELETE" }).then(refreshJobs).catch(() => {});

  const removeResult = async (p: string) => {
    await postJson("/api/tool/delete-output", { path: p }).catch((e) => notifyError(e.message, kind));
    if (result === p) setResult(null);
    loadHistory();
  };
  // Reuse a past result: its prompt goes back in the box; an image can also become the next reference.
  const reusePrompt = (h: HistoryItem) => { setPrompt(h.prompt); notify({ message: "Prompt restored", tab: kind }); };
  const useAsReference = (p: string) => {
    const i = slots.image.findIndex(v => !v);
    if (i < 0) { notifyError("No free reference image slot in this workflow.", kind); return; }
    setSlot("image", i, p);
    notify({ message: "Added as reference image", tab: kind });
  };
  const reveal = (p: string) => postJson("/api/tool/reveal", { path: p }).catch((e) => notifyError(e.message, kind));

  // A converted copy in a sub-folder (e.g. API_FORMAT/x) is hidden when the original x is listed too - they run the same.
  const names = new Set(workflows.map(w => w.name));
  const refTotal = (w: WorkflowInfo) => w.refImageCount + w.refVideoCount + w.refAudioCount;
  const recentUse = readRecent();
  const shown = workflows.filter(w => !(w.name.includes("/") && names.has(w.name.slice(w.name.lastIndexOf("/") + 1))))
    .filter(w => !filter || w.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((x, y) => (sort === "name-desc" ? y.name.localeCompare(x.name)
      : sort === "recent" ? (recentUse[y.path] || 0) - (recentUse[x.path] || 0)
      : sort === "ready" ? Number(y.isRunnable) - Number(x.isRunnable)
      : sort === "refs" ? refTotal(x) - refTotal(y) : 0) || x.name.localeCompare(y.name));
  const pct = progress ? (progress[0] / Math.max(1, progress[1])) * 100 : null;

  // What the stage shows: the live job, else the picked / newest result.
  const stagePath = !busy ? (viewPath || result || history[0]?.path || null) : null;
  const stageItem = stagePath ? history.find(h => h.path === stagePath) : undefined;
  const refCount = wf ? wf.refImageCount + wf.refVideoCount + wf.refAudioCount : 0;
  const refFilled = (["image", "video", "audio"] as const).reduce((n, t) => n + slots[t].filter(Boolean).length, 0);
  const iconBtn = "p-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors disabled:opacity-40";
  const field = `w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2 text-[13px] text-white focus:outline-none ${ring} placeholder:text-zinc-700`;

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      {toolbar}

      <div className="flex-1 min-h-0 grid gap-4 lg:grid-cols-[minmax(340px,420px)_1fr] overflow-y-auto lg:overflow-hidden">
        {/* ───────── Controls ───────── */}
        <ReorderGroup id={`studio-${kind}-workflows`}>
        <div className="glass rounded-3xl border-white/5 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
            {/* Workflow */}
            <Section title="Workflow" icon={<Layers size={14} />} accent={a.text} badge={wf ? wf.name : undefined} defaultOpen>
              <div className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                  <select value={selected} onChange={e => setSelected(e.target.value)} disabled={!workflows.length} className={`${field} appearance-none pr-8 cursor-pointer truncate`}>
                    {!workflows.length && <option value="">{loading ? "Loading..." : "No workflows"}</option>}
                    {shown.map(w => <option key={w.path} value={w.path} className="bg-zinc-900">{w.name}{w.isRunnable ? "" : "  (cannot run)"}</option>)}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                </div>
                {workflows.length > 1 && <SortMenu options={[{ key: "name", label: "Name A → Z" }, { key: "name-desc", label: "Name Z → A" }, { key: "recent", label: "Recently used" }, { key: "ready", label: "Ready to run first" }, { key: "refs", label: "Fewest references first" }]} sort={sort} onSort={setSort} search={filter} onSearch={setFilter} />}
                {folder && <button onClick={() => loadWorkflows(folder, selected)} disabled={loading} title="Reload the folder" className={iconBtn}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>}
                <button onClick={() => chooseFolder("workflows")} title={folder ? `Change folder (${folder})` : "Choose the workflow folder"} className={iconBtn}><FolderOpen size={14} /></button>
              </div>
              {!folder && <p className="text-[11px] text-zinc-500">Pick the folder where your ComfyUI workflows are saved.</p>}
              {folder && !loading && workflows.length === 0 && !loadError && <p className="text-[11px] text-zinc-500">No {kind} workflows here.{counts.image || counts.video ? ` This folder has ${counts.image || 0} image / ${counts.video || 0} video workflows.` : ""}</p>}
              {loadError && <p className="text-[11px] text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {loadError}</p>}
              {st && !st.comfyReachable && <p className="text-[11px] text-amber-400 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> ComfyUI is not reachable - start it before running.</p>}
              {wf && !wf.isRunnable && <p className="text-[11px] text-red-400 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> <span>Cannot run: {wf.missing.join("; ")}</span></p>}
              {wf?.warnings.map((w, i) => <p key={i} className="text-[11px] text-amber-400 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> <span>{w}</span></p>)}
              {wf && (wf.needsAssignment.length > 0 || !wf.promptNodeId && wf.needsPrompt || !wf.outputNodeId) && (
                <div className="grid grid-cols-2 gap-2">
                  {wf.promptCandidates.length > 0 && (
                    <div><label className={label}>Prompt goes into</label>
                      <select value={wf.promptNodeId || ""} onChange={e => saveRoles(e.target.value, wf.outputNodeId || "")} className={field}>
                        {!wf.promptNodeId && <option value="" className="bg-zinc-900">Choose...</option>}
                        {wf.promptCandidates.map(c => <option key={c.id} value={c.id} className="bg-zinc-900">{c.label}</option>)}
                      </select></div>
                  )}
                  {wf.outputCandidates.length > 0 && (
                    <div><label className={label}>Result from</label>
                      <select value={wf.outputNodeId || ""} onChange={e => saveRoles(wf.promptNodeId || "", e.target.value)} className={field}>
                        {!wf.outputNodeId && <option value="" className="bg-zinc-900">Choose...</option>}
                        {wf.outputCandidates.map(c => <option key={c.id} value={c.id} className="bg-zinc-900">{c.label}</option>)}
                      </select></div>
                  )}
                </div>
              )}
              {workflows.length > 0 && (
                <div className="flex items-center gap-2">
                  <Bookmark size={13} className={a.text} />
                  <select value="" onChange={e => e.target.value && loadSetup(e.target.value)} className={`${field} !py-1.5 flex-1 cursor-pointer`}>
                    <option value="" className="bg-zinc-900">{activeSetup ? `Setup: ${activeSetup}` : setups.length ? "Load a saved setup..." : "No saved setups yet"}</option>
                    {setups.map(x => <option key={x.name} value={x.name} className="bg-zinc-900">{x.name}</option>)}
                  </select>
                  <button onClick={saveSetup} disabled={!wf} title="Save the current workflow, prompt and settings as a setup" className={iconBtn}><Save size={14} /></button>
                  {activeSetup && <button onClick={() => { deleteSetup(activeSetup); setActiveSetup(null); }} title={`Delete setup "${activeSetup}"`} className={`${iconBtn} hover:!text-red-400`}><Trash2 size={14} /></button>}
                </div>
              )}
            </Section>

            {wf && wf.isRunnable && (
              <>
                {/* Prompt */}
                <Section title="Prompt" icon={<Type size={14} />} accent={a.text} badge={batch.length > 1 ? `${batch.length} from file` : undefined} defaultOpen>
                  <PromptSource bare kind={kind} modelId={modelId} prompt={prompt} onPrompt={setPrompt} needsPrompt={wf.needsPrompt} onCandidates={setBatch} usageKey={history.length} />
                </Section>

                {/* References */}
                {refCount > 0 && (
                  <Section title="References" icon={<ImageIcon size={14} />} accent={a.text} badge={`${refFilled}/${refCount}`} defaultOpen>
                    <div
                      className={`space-y-3 rounded-xl transition-all ${refDrag ? `ring-2 ${a.border} p-2` : ""}`}
                      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setRefDrag(true); } }}
                      onDragLeave={() => setRefDrag(false)}
                      onDrop={(e) => { e.preventDefault(); setRefDrag(false); dropRefs([...e.dataTransfer.files]); }}
                    >
                      <input ref={fileInputRef} type="file" multiple hidden accept="image/*,video/*,audio/*" onChange={(e) => { dropRefs([...(e.target.files || [])]); e.target.value = ""; }} />
                      {(["image", "video", "audio"] as const).map(t => {
                        const labels = wf[`ref${t[0].toUpperCase()}${t.slice(1)}Labels` as "refImageLabels"];
                        const bypass = wf[`ref${t[0].toUpperCase()}${t.slice(1)}Bypassable` as "refImageBypassable"];
                        return slots[t].map((p, i) => {
                          const skipped = !!bypass[i] && !!skip[t][i];
                          const required = !bypass[i];
                          return (
                            <div key={t + i} className={`flex items-center gap-3 rounded-xl p-2 -mx-2 ${required && !p ? "bg-amber-500/[0.06]" : ""}`}>
                              <button onClick={chooseRefFiles} disabled={skipped} title={skipped ? "Bypassed - untick Bypass to choose a file" : "Choose a file"} className={`relative w-16 h-16 shrink-0 rounded-xl overflow-hidden border-2 border-dashed transition-colors flex items-center justify-center ${skipped ? "opacity-30 border-white/10" : p ? "border-transparent" : "border-white/15 hover:border-white/30 text-zinc-600"}`}>
                                {p && !skipped ? (t === "image" ? <img src={fileUrl(p)} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-white/5 flex items-center justify-center text-zinc-400">{t === "video" ? <Film size={20} /> : <ImageIcon size={20} />}</div>) : <Plus size={18} />}
                              </button>
                              <div className="min-w-0 flex-1">
                                <p className="text-[12px] font-semibold text-zinc-200 truncate">{labels[i] || `${t} ${i + 1}`}{required ? <span className="ml-1.5 text-[9px] font-black uppercase tracking-widest text-amber-400">required</span> : <span className="ml-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-500">optional</span>}</p>
                                <p className={`text-[11px] truncate ${required && !p ? "text-amber-400" : "text-zinc-500"}`}>{skipped ? "Bypassed for this run" : p ? p.split(/[\\/]/).pop() : required ? "Choose or drop a file" : "No file chosen"}</p>
                                {!required && (
                                  <label className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer select-none">
                                    <input type="checkbox" checked={skipped} onChange={e => toggleSkip(t, i, e.target.checked)} /> Bypass (skip this reference)
                                  </label>
                                )}
                              </div>
                              {p && !skipped && <button onClick={() => setSlot(t, i, "")} title="Clear" className={iconBtn}><X size={13} /></button>}
                            </div>
                          );
                        });
                      })}
                      {media.length > 0 && (
                        <div>
                          <p className={label}>Library <button onClick={() => chooseFolder("refs")} className="ml-1 normal-case tracking-normal text-zinc-500 hover:text-zinc-300 font-medium">change folder</button></p>
                          <div className="flex gap-1.5 overflow-x-auto pb-1">
                            {media.map(m => (
                              <button key={m.path} onClick={() => addRefItems([m])} title={`${m.name} - click to use`} className="shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-white/5 opacity-70 hover:opacity-100 transition-opacity">
                                {m.type === "image" ? <img src={fileUrl(m.path)} alt={m.name} loading="lazy" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-zinc-500">{m.type === "video" ? <Film size={16} /> : <ImageIcon size={16} />}</div>}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {!media.length && <button onClick={() => chooseFolder("refs")} className="text-[11px] text-zinc-500 hover:text-zinc-300">Choose a library folder for quick picking...</button>}
                    </div>
                  </Section>
                )}

                {/* Size & duration */}
                {(sizeW || sizeH || lengthF || roleFields.length > 0) && (
                  <Section title={lengthF ? "Size & duration" : "Size"} icon={<Ruler size={14} />} accent={a.text} badge={sizeW && sizeH ? `${val(sizeW)}×${val(sizeH)}${lengthF ? ` · ${seconds.toFixed(1)}s` : ""}` : undefined} defaultOpen>
                    {sizeW && sizeH && (
                      <div className="space-y-2">
                        <label className={label + " !mb-1"}>Picture size</label>
                        <select value={presetKey} onChange={e => { if (e.target.value !== "custom") { const [w, h] = e.target.value.split("x").map(Number); setSize(w, h); } }} className={field}>
                          {sizePresets.map(([w, h, n]) => <option key={`${w}x${h}`} value={`${w}x${h}`} className="bg-zinc-900">{w} × {h}{n ? `  (${n})` : ""}</option>)}
                          {presetKey === "custom" && <option value="custom" className="bg-zinc-900">Custom</option>}
                        </select>
                        <div className="flex items-center gap-2">
                          <input type="number" min={64} step={8} value={val(sizeW) ?? ""} onChange={e => setSize(Number(e.target.value), Number(val(sizeH)))} className={field} aria-label="Width" />
                          <button onClick={() => setSize(Number(val(sizeH)), Number(val(sizeW)))} title="Swap width and height" className={iconBtn}><ArrowLeftRight size={14} /></button>
                          <input type="number" min={64} step={8} value={val(sizeH) ?? ""} onChange={e => setSize(Number(val(sizeW)), Number(e.target.value))} className={field} aria-label="Height" />
                        </div>
                      </div>
                    )}
                    {roleFields.map(f => (
                      <div key={f.id}>
                        <label className={label + " !mb-1"}>{f.label}</label>
                        {f.kind === "select" && f.options
                          ? <select value={String(val(f))} onChange={e => setField(f.id, e.target.value)} className={field}>{f.options.map(o => <option key={o} value={o} className="bg-zinc-900">{o}</option>)}</select>
                          : <input type="number" step="any" value={val(f) ?? ""} onChange={e => setField(f.id, e.target.value === "" ? "" : Number(e.target.value))} className={field} />}
                      </div>
                    ))}
                    {lengthF && (
                      <div className="space-y-2">
                        <label className={label + " !mb-1"}>Duration</label>
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1"><input type="number" min={0.5} step={0.5} value={Number(seconds.toFixed(2))} onChange={e => setSeconds(Number(e.target.value))} className={`${field} pr-8`} aria-label="Seconds" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-zinc-500">s</span></div>
                          <div className="relative flex-1"><input type="number" min={1} step={lengthF.snap || 1} value={val(lengthF) ?? ""} onChange={e => setField(lengthF.id, Number(e.target.value))} className={`${field} pr-14`} aria-label="Frames" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-zinc-500">frames</span></div>
                          {fpsF && <div className="relative w-24"><input type="number" min={1} value={val(fpsF) ?? ""} onChange={e => setField(fpsF.id, Number(e.target.value))} className={`${field} pr-9`} aria-label="Frames per second" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-zinc-500">fps</span></div>}
                        </div>
                        <p className="text-[11px] text-zinc-600">{lengthF.snap ? `This model needs frames in steps of ${lengthF.snap} + 1 (it rounds for you). ` : ""}Longer clips need more memory and time.</p>
                      </div>
                    )}
                  </Section>
                )}

                {/* Settings */}
                {otherFields.length > 0 && (
                  <Section title="Settings" icon={<SlidersHorizontal size={14} />} accent={a.text} badge={`${otherFields.length}`}>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                      {otherFields.map(f => {
                        const v = val(f);
                        const set = (x: any) => setField(f.id, x);
                        return (
                          <div key={f.id} className={f.kind === "text" || (f.kind === "select" && String(v).length > 22) ? "col-span-2" : ""}>
                            <label className={label + " !mb-1"}>{f.label}</label>
                            {f.kind === "select" && f.options ? (
                              <select value={String(v)} onChange={e => set(e.target.value)} className={field}>{f.options.map(o => <option key={o} value={o} className="bg-zinc-900">{o}</option>)}</select>
                            ) : f.kind === "bool" ? (
                              <label className="flex items-center gap-2 text-[13px] text-zinc-300 py-1.5"><input type="checkbox" checked={!!v} onChange={e => set(e.target.checked)} /> {v ? "On" : "Off"}</label>
                            ) : f.kind === "int" || f.kind === "float" ? (
                              <input type="number" value={v ?? ""} step={f.kind === "int" ? 1 : "any"} onChange={e => set(e.target.value === "" ? "" : Number(e.target.value))} className={field} />
                            ) : f.kind === "text" ? (
                              <textarea value={v ?? ""} rows={2} onChange={e => set(e.target.value)} className={`${field} resize-y`} />
                            ) : (
                              <input value={v ?? ""} onChange={e => set(e.target.value)} className={field} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer pt-1"><input type="checkbox" checked={randomSeed || count > 1} disabled={count > 1} onChange={e => setRandomSeed(e.target.checked)} /> <Dices size={14} /> New random seed every run{count > 1 ? " (always on for several instances)" : ""}</label>
                  </Section>
                )}
                {otherFields.length === 0 && (
                  <div className="px-4 py-3"><label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer"><input type="checkbox" checked={randomSeed || count > 1} disabled={count > 1} onChange={e => setRandomSeed(e.target.checked)} /> <Dices size={14} /> New random seed every run</label></div>
                )}

                {/* Output */}
                <Section title="Output" icon={<FolderOpen size={14} />} accent={a.text} badge={fileName || undefined}>
                  <div><label className={label + " !mb-1"}>Save to</label>
                    <div className="flex gap-2">
                      <input value={dest} onChange={e => setDest(e.target.value)} placeholder={st?.defaultDestination || "outputs"} className={field} />
                      <button onClick={() => chooseFolder("dest")} className={iconBtn} title="Browse"><FolderOpen size={14} /></button>
                    </div></div>
                  <div><label className={label + " !mb-1"}>File name (optional)</label>
                    <input value={fileName} onChange={e => setFileName(e.target.value)} placeholder="Automatic" className={field} /></div>
                </Section>
              </>
            )}

            {folder && (
              <Section title="Tools" icon={<Wand2 size={14} />} accent={a.text}>
                <Converter bare kind={kind} source={folder} />
              </Section>
            )}
          </div>

          {/* Action bar */}
          <div className="shrink-0 border-t border-white/5 p-4 space-y-2 bg-black/20">
            <div className="flex gap-2">
              <button onClick={() => submit([prompt])} disabled={!canRun} className={`flex-1 flex items-center justify-center gap-2 ${a.solid} text-white font-bold text-sm py-3 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-black/30`}>
                {busy ? <ListPlus size={16} /> : <Play size={16} className="fill-current" />} {busy ? "Add to queue" : "Generate"}{count > 1 ? ` ×${count}` : ""}
              </button>
              <div className="flex items-center rounded-xl bg-white/5 border border-white/[0.06] overflow-hidden" title="How many times to run it (each with a new seed)">
                <button onClick={() => setCount(c => Math.max(1, c - 1))} disabled={count <= 1} className="px-2.5 h-full text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"><Minus size={14} /></button>
                <span className="w-8 text-center text-sm font-bold text-white tabular-nums">{count}</span>
                <button onClick={() => setCount(c => Math.min(MAX_INSTANCES, c + 1))} disabled={count >= MAX_INSTANCES} className="px-2.5 h-full text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"><Plus size={14} /></button>
              </div>
              {busy && <button onClick={cancel} title="Cancel the running job" className="px-3.5 rounded-xl bg-red-600/80 hover:bg-red-500 text-white transition-colors"><Square size={14} className="fill-current" /></button>}
            </div>
            {batch.length > 1 && <button onClick={() => submit(batch)} disabled={!canRunBase || queuing} title="Queue every prompt found in the file" className="w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-200 font-bold text-xs disabled:opacity-40 transition-colors">{queuing ? "Queuing..." : `Run all ${batch.length} prompts${count > 1 ? ` ×${count}` : ""}`}</button>}
            {wf?.isRunnable && (wf.needsPrompt && !prompt.trim() ? <p className="text-[11px] text-zinc-600 text-center">Write a prompt to enable Generate.</p> : missingRefs.length > 0 ? <p className="text-[11px] text-amber-400 text-center">Choose the required reference file{missingRefs.length > 1 ? "s" : ""} (or bypass optional ones).</p> : null)}
          </div>
        </div>
        </ReorderGroup>

        {/* ───────── Canvas ───────── */}
        <div className="flex flex-col gap-3 min-h-0 lg:overflow-y-auto pr-0.5">
          {showHistory ? (
            <>
            <HistoryPanel kind={kind} refreshKey={history.length} onUse={useEntry} />
            <QueueList kind={kind} rows={active.map(r => ({ id: r.runId, label: r.workflow, status: r.status, detail: r.progress ? `${r.progress[0]}/${r.progress[1]}` : undefined, pausable: !!r.pausable, cancellable: r.cancellable }))} onPause={pauseJob} onResume={resumeJob} onCancel={cancelOther} onRemove={dropJob} />
            </>
          ) : (<>
          <div className="relative min-h-[300px] lg:min-h-0 lg:flex-1 rounded-3xl border border-white/5 bg-black/30 overflow-hidden flex items-center justify-center">
            <div className="absolute inset-0 opacity-[0.07] pointer-events-none" style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
            {busy ? (
              <div className="relative w-full h-full flex flex-col items-center justify-center p-6 gap-5">
                {preview ? <img src={preview} alt="Live preview" className="max-h-[70%] max-w-full rounded-xl border border-white/10 shadow-2xl shadow-black/60" /> : <div className="flex flex-col items-center gap-3 text-zinc-500"><Loader2 size={34} className={`animate-spin ${a.text}`} /></div>}
                <div className="w-full max-w-md space-y-1.5">
                  <ProgressBar value={pct} label={status || "Working"} color={a.bar} />
                  {queueNote && <p className="text-[11px] text-zinc-500 text-center">{queueNote}</p>}
                </div>
              </div>
            ) : stagePath ? (
              <Media path={stagePath} className="relative max-w-full max-h-full object-contain" />
            ) : (
              <div className="relative text-center space-y-2 p-8">
                <div className={`mx-auto w-14 h-14 rounded-2xl ${a.soft} border flex items-center justify-center`}>{kind === "video" ? <Film size={24} className={a.text} /> : <ImageIcon size={24} className={a.text} />}</div>
                <p className="text-sm font-bold text-zinc-300">Your {kind} appears here</p>
                <p className="text-xs text-zinc-600 max-w-xs">Choose a workflow, write a prompt and press Generate. Live previews show while it renders.</p>
              </div>
            )}
            {runError && !busy && <div className="absolute inset-x-4 bottom-4 text-[12px] text-red-300 bg-red-950/70 border border-red-500/30 rounded-xl px-4 py-2.5 flex items-start gap-2 backdrop-blur"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> <span>{runError}</span></div>}
          </div>

          {/* Result actions */}
          {stagePath && !busy && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] text-zinc-500 truncate flex-1 min-w-[140px]" title={stageItem?.prompt}>{stageItem ? `${stageItem.workflow} · ${stageItem.prompt || "no prompt"}` : stagePath.split(/[\\/]/).pop()}</p>
              {stageItem?.prompt && <button onClick={() => reusePrompt(stageItem)} title="Reuse this prompt" className={`${iconBtn} flex items-center gap-1.5 text-[11px] font-semibold`}><CornerUpLeft size={13} /> Prompt</button>}
              {isImage(stagePath) && wf && wf.refImageCount > 0 && <button onClick={() => useAsReference(stagePath)} title="Use as reference image" className={`${iconBtn} flex items-center gap-1.5 text-[11px] font-semibold`}><ImageIcon size={13} /> Reference</button>}
              <ShareMenu kind={kind} url={(stagePath.startsWith("data:") || stagePath.startsWith("blob:") || stagePath.startsWith("/api/")) ? stagePath : fileUrl(stagePath)} caption={stageItem?.prompt} onReveal={() => reveal(stagePath)} tab={kind} />
              <button onClick={() => reveal(stagePath)} title="Show in folder" className={iconBtn}><ExternalLink size={14} /></button>
              <button onClick={() => removeResult(stagePath)} title="Delete this result" className={`${iconBtn} hover:!text-red-400`}><Trash2 size={14} /></button>
            </div>
          )}

          <PreviousResults kind={kind} prompt={prompt} refreshKey={history.length} activeUrl={stagePath} onShow={it => setViewPath(it.file)} />

          {/* Job queue - always visible */}
          <QueueList
            kind={kind}
            rows={active.map(r => ({ id: r.runId, label: r.workflow + (r.ahead !== null ? ` (${r.ahead} ahead)` : ""), status: r.status, detail: r.progress ? `${r.progress[0]}/${r.progress[1]}` : undefined, pausable: !!r.pausable, cancellable: r.cancellable }))}
            onPause={pauseJob} onResume={resumeJob} onCancel={cancelOther} onRemove={dropJob}
          />

          {/* Filmstrip */}
          {history.length > 0 && (
            <div>
              <p className={label}>Recent</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {history.slice(0, 24).map(h => (
                  <button key={h.path} onClick={() => setViewPath(h.path)} title={h.prompt || h.workflow} className={`shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 transition-all ${stagePath === h.path ? a.border : "border-transparent opacity-70 hover:opacity-100"}`}>
                    {isVideo(h.path) ? <div className="w-full h-full bg-white/5 flex items-center justify-center text-zinc-400"><Film size={18} /></div> : <img src={fileUrl(h.path)} alt="" loading="lazy" className="w-full h-full object-cover" />}
                  </button>
                ))}
              </div>
            </div>
          )}
          </>)}
        </div>
      </div>

      <FolderPickerDialog
        open={picker !== null}
        onOpenChange={(o) => !o && setPicker(null)}
        title={picker === "workflows" ? "Choose workflow folder" : picker === "refs" ? "Choose reference media folder" : "Choose save folder"}
        initialPath={picker === "workflows" ? folder : picker === "refs" ? refFolder : dest}
        onSelect={(p) => {
          const which = picker; setPicker(null);
          if (which === "workflows") loadWorkflows(p);
          else if (which === "refs") loadRefs(p);
          else if (which === "dest") setDest(p);
        }}
      />
    </div>
  );
}

/** One collapsible block of the control panel: icon + title on the left, a short summary on the right. */
function Section({ title, icon, accent, badge, defaultOpen = false, children }: { title: string; icon: React.ReactNode; accent: string; badge?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left">
        <span className={accent}>{icon}</span>
        <span className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-300">{title}</span>
        {badge && <span className="ml-auto max-w-[55%] truncate text-[11px] text-zinc-500 font-medium">{badge}</span>}
        <ChevronDown size={14} className={`text-zinc-600 transition-transform shrink-0 ${badge ? "" : "ml-auto"} ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </section>
  );
}
