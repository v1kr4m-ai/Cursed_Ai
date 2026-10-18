import React from "react";
import { Bookmark, CornerUpLeft, FolderOpen, Play, Square, Loader2, RefreshCw, AlertTriangle, ChevronDown, Trash2, ExternalLink, Dices, X, ImageIcon, Film } from "lucide-react";
import { FolderPickerDialog } from "../tools/FolderPickerDialog";
import { ProgressBar } from "../layout/ProgressBar";
import { notify, notifyError } from "../../lib/notify";
import { PromptSource } from "./PromptSource";
import { Converter } from "./Converter";
import { ACCENT, HistoryItem, Kind, MediaItem, RunRow, WorkflowInfo, api, fileUrl, nativeFiles, nativeFolder, postJson } from "./types";

const label = "text-[10px] text-zinc-600 font-bold uppercase tracking-widest mb-2 block";
const input = "w-full bg-white/5 border-none rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-1 placeholder:text-zinc-700";
const isVideo = (p: string) => /\.(mp4|webm|mov|mkv)$/i.test(p);
const isImage = (p: string) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(p);

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
export function WorkflowRunner({ kind }: { kind: Kind }) {
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
  // Saved setups: a named snapshot of workflow + prompt + settings + references + destination. Kept in this browser.
  interface Setup { name: string; workflow: string; prompt: string; fieldValues: Record<string, any>; randomSeed: boolean; dest: string; fileName: string; slots: Record<"image" | "video" | "audio", string[]> }
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
    postJson("/api/tool/state", { kind, lastWorkflow: wf.path }).catch(() => {});
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // A setup picked from the list: switch workflow first (which resets the inputs), then fill them in.
  React.useEffect(() => {
    if (!pendingSetup || selected !== pendingSetup.workflow) return;
    setPrompt(pendingSetup.prompt); setFieldValues(pendingSetup.fieldValues); setRandomSeed(pendingSetup.randomSeed);
    setDest(pendingSetup.dest); setFileName(pendingSetup.fileName); setSlots(pendingSetup.slots);
    setPendingSetup(null);
  }, [pendingSetup, selected, wf]);

  // Other jobs (also ones from a previous page load) waiting in ComfyUI.
  React.useEffect(() => {
    const t = setInterval(() => api<{ active: RunRow[] }>(`/api/tool/runs?kind=${kind}`).then(d => setActive(d.active)).catch(() => {}), 3000);
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

  const missingRefs = wf ? (["image", "video", "audio"] as const).flatMap(t => slots[t].map((p, i) => ({ t, i, p, ok: wf[`ref${t[0].toUpperCase()}${t.slice(1)}Bypassable` as "refImageBypassable"][i] })).filter(s => !s.p && !s.ok)) : [];
  const canRunBase = !!wf && wf.isRunnable && missingRefs.length === 0 && wf.needsAssignment.length === 0;
  const canRun = !!wf && wf.isRunnable && !busy && (!wf.needsPrompt || prompt.trim().length > 0) && missingRefs.length === 0 && wf.needsAssignment.length === 0;

  const watch = (id: string) => {
    esRef.current?.close();
    const es = new EventSource(`/api/tool/progress/${id}`);
    esRef.current = es;
    const finish = () => { es.close(); esRef.current = null; setRunId(null); setPreview(null); setQueueNote(""); loadHistory(); };
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      switch (e.type) {
        case "submitted": setStatus("Queued in ComfyUI"); break;
        case "status": setStatus(e.message); break;
        case "queue": setQueueNote(e.remaining > 1 ? `${e.remaining - 1} job(s) ahead` : ""); break;
        case "progress": setStatus("Generating"); setProgress([e.value, e.max]); setQueueNote(""); break;
        case "preview": setPreview(`data:image/jpeg;base64,${e.image_b64}`); break;
        case "log": break;
        case "done": setResult(e.path); setProgress(null); notify({ message: "Workflow finished", tab: kind }); finish(); break;
        case "failed": setRunError(e.message); notifyError(e.message, kind); finish(); break;
        case "cancelled": setStatus("Cancelled"); setRunError("Cancelled"); finish(); break;
      }
    };
    es.onerror = () => { /* EventSource retries by itself with Last-Event-ID; the server closes cleanly when the run ends */ if (es.readyState === EventSource.CLOSED) finish(); };
  };

  const run = async () => {
    if (!wf) return;
    setRunError(null); setResult(null); setProgress(null); setPreview(null); setStatus("Starting");
    try {
      const body = {
        kind, workflowPath: wf.path, promptText: prompt, fieldValues, randomizeSeed: randomSeed,
        refImagePaths: slots.image, refVideoPaths: slots.video, refAudioPaths: slots.audio,
        outputFolder: dest, outputFilename: fileName,
      };
      const { runId: id } = await postJson("/api/tool/run", body);
      setRunId(id); watch(id);
      postJson("/api/tool/state", { kind, destination: dest, outputFilename: fileName }).catch(() => {});
    } catch (e: any) { setRunError(e.message); notifyError(e.message, kind); setStatus(""); }
  };

  // Queue every prompt found in the file. ComfyUI runs them one after another; they show up under "Running jobs" and in the results.
  const runAll = async () => {
    if (!wf || batch.length < 2) return;
    setQueuing(true); setRunError(null);
    try {
      for (const text of batch) {
        await postJson("/api/tool/run", {
          kind, workflowPath: wf.path, promptText: text, fieldValues, randomizeSeed: true,
          refImagePaths: slots.image, refVideoPaths: slots.video, refAudioPaths: slots.audio,
          outputFolder: dest, outputFilename: "",
        });
      }
      notify({ message: `Queued ${batch.length} prompts`, tab: kind });
    } catch (e: any) { setRunError(e.message); notifyError(e.message, kind); }
    finally { setQueuing(false); }
  };

  const saveSetup = () => {
    if (!wf) return;
    let name: string | undefined;
    try { name = window.prompt("Name this setup", wf.name)?.trim(); } catch { name = wf.name; }
    if (!name) return;
    const snap: Setup = { name, workflow: wf.path, prompt, fieldValues, randomSeed, dest, fileName, slots };
    persistSetups([snap, ...setups.filter(x => x.name !== name)]);
    notify({ message: `Saved setup "${name}"`, tab: kind });
  };
  const loadSetup = (name: string) => {
    const x = setups.find(v => v.name === name);
    if (!x) return;
    if (!workflows.some(w => w.path === x.workflow)) { notifyError("That setup's workflow is not in the current folder.", kind); return; }
    if (x.workflow === selected) { setPrompt(x.prompt); setFieldValues(x.fieldValues); setRandomSeed(x.randomSeed); setDest(x.dest); setFileName(x.fileName); setSlots(x.slots); }
    else { setPendingSetup(x); setSelected(x.workflow); }
  };
  const deleteSetup = (name: string) => persistSetups(setups.filter(x => x.name !== name));

  const cancel = async () => { if (runId) await postJson(`/api/tool/cancel/${runId}`, {}).catch(() => {}); };
  const cancelOther = (id: string) => postJson(`/api/tool/cancel/${id}`, {}).catch(() => {});

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

  const shown = workflows.filter(w => !filter || w.name.toLowerCase().includes(filter.toLowerCase()));
  const pct = progress ? (progress[0] / Math.max(1, progress[1])) * 100 : null;

  return (
    <div className="space-y-5">
      {/* Workflow folder + picker */}
      <div className="glass p-5 rounded-[1.75rem] border-white/5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-white">Workflow</p>
            <p className="text-[11px] text-zinc-500">{folder ? `${workflows.length} ${kind} workflows in this folder` : "Pick the folder where your ComfyUI workflows are saved."}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            {folder && <button onClick={() => loadWorkflows(folder, selected)} disabled={loading} title="Reload" className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 transition-colors"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>}
            <button onClick={() => chooseFolder("workflows")} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold px-3.5 py-2 rounded-xl transition-colors"><FolderOpen size={14} /> {folder ? "Change folder" : "Choose folder"}</button>
          </div>
        </div>
        {folder && <p className="text-[11px] text-zinc-600 truncate" title={folder}>{folder}</p>}
        {loadError && <p className="text-[11px] text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {loadError}</p>}
        {st && !st.comfyReachable && <p className="text-[11px] text-amber-400 flex items-center gap-1.5"><AlertTriangle size={12} /> ComfyUI is not reachable - start it before running. Workflows saved in UI format can only be converted while it runs.</p>}

        {workflows.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {workflows.length > 8 && <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter..." className={`${input} ${ring} sm:w-40`} />}
            <div className="relative flex-1 min-w-[220px]">
              <select value={selected} onChange={e => setSelected(e.target.value)} className={`${input} ${ring} appearance-none pr-9 cursor-pointer`}>
                {shown.map(w => <option key={w.path} value={w.path} className="bg-zinc-900">{w.name}{w.isRunnable ? "" : "  (cannot run)"}</option>)}
              </select>
              <ChevronDown size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
            </div>
          </div>
        )}
        {workflows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Bookmark size={13} className={a.text} />
            <select value="" onChange={e => e.target.value && loadSetup(e.target.value)} className={`bg-white/5 border-none rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none ${ring} cursor-pointer`}>
              <option value="" className="bg-zinc-900">{setups.length ? "Saved setups..." : "No saved setups yet"}</option>
              {setups.map(x => <option key={x.name} value={x.name} className="bg-zinc-900">{x.name}</option>)}
            </select>
            <button onClick={saveSetup} disabled={!wf} className="text-xs font-bold text-zinc-300 bg-white/5 hover:bg-white/10 px-3 py-2 rounded-xl disabled:opacity-40 transition-colors">Save current</button>
            {setups.length > 0 && <select value="" onChange={e => e.target.value && deleteSetup(e.target.value)} className="bg-white/5 border-none rounded-xl px-3 py-2 text-xs text-zinc-500 focus:outline-none cursor-pointer"><option value="" className="bg-zinc-900">Delete...</option>{setups.map(x => <option key={x.name} value={x.name} className="bg-zinc-900">{x.name}</option>)}</select>}
          </div>
        )}
        {folder && !loading && workflows.length === 0 && !loadError && (
          <p className="text-[11px] text-zinc-500">No {kind} workflows here.{counts.image || counts.video ? ` This folder has ${counts.image || 0} image / ${counts.video || 0} video workflows.` : ""}</p>
        )}

        {wf && (
          <div className="space-y-3">
            {!wf.isRunnable && <p className="text-[11px] text-red-400 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> <span>Cannot run: {wf.missing.join("; ")}</span></p>}
            {wf.warnings.map((w, i) => <p key={i} className="text-[11px] text-amber-400 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> <span>{w}</span></p>)}
            {(wf.needsAssignment.length > 0 || wf.promptCandidates.length > 1 || wf.outputCandidates.length > 1) && (
              <div className="grid sm:grid-cols-2 gap-3">
                {wf.promptCandidates.length > 0 && (
                  <div>
                    <label className={label}>Prompt goes into</label>
                    <select value={wf.promptNodeId || ""} onChange={e => saveRoles(e.target.value, wf.outputNodeId || "")} className={`${input} ${ring}`}>
                      {!wf.promptNodeId && <option value="" className="bg-zinc-900">Choose a node...</option>}
                      {wf.promptCandidates.map(c => <option key={c.id} value={c.id} className="bg-zinc-900">{c.label}</option>)}
                    </select>
                  </div>
                )}
                {wf.outputCandidates.length > 0 && (
                  <div>
                    <label className={label}>Result comes from</label>
                    <select value={wf.outputNodeId || ""} onChange={e => saveRoles(wf.promptNodeId || "", e.target.value)} className={`${input} ${ring}`}>
                      {!wf.outputNodeId && <option value="" className="bg-zinc-900">Choose a node...</option>}
                      {wf.outputCandidates.map(c => <option key={c.id} value={c.id} className="bg-zinc-900">{c.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {wf && wf.isRunnable && (
        <>
          <PromptSource kind={kind} prompt={prompt} onPrompt={setPrompt} needsPrompt={wf.needsPrompt} onCandidates={setBatch} />

          {/* Reference slots */}
          {(wf.refImageCount > 0 || wf.refVideoCount > 0 || wf.refAudioCount > 0) && (
            <div
              className={`glass p-5 rounded-[1.75rem] border-white/5 space-y-4 transition-all ${refDrag ? `ring-2 ${a.border}` : ""}`}
              onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setRefDrag(true); } }}
              onDragLeave={() => setRefDrag(false)}
              onDrop={(e) => { e.preventDefault(); setRefDrag(false); dropRefs([...e.dataTransfer.files]); }}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-white">Reference media</p>
                  <p className="text-[11px] text-zinc-500">{refFolder ? refFolder : "Pick a folder, or drop files here."}{refFolder ? " - drop files here to add" : ""}</p>
                </div>
                <div className="flex gap-2 shrink-0"><input ref={fileInputRef} type="file" multiple hidden accept="image/*,video/*,audio/*" onChange={(e) => { dropRefs([...(e.target.files || [])]); e.target.value = ""; }} /><button onClick={chooseRefFiles} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold px-3.5 py-2 rounded-xl transition-colors"><ImageIcon size={14} /> Choose files</button><button onClick={() => chooseFolder("refs")} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold px-3.5 py-2 rounded-xl transition-colors shrink-0"><FolderOpen size={14} /> {refFolder ? "Library folder" : "Choose folder"}</button></div>
              </div>
              {(["image", "video", "audio"] as const).map(t => {
                const labels = wf[`ref${t[0].toUpperCase()}${t.slice(1)}Labels` as "refImageLabels"];
                const bypass = wf[`ref${t[0].toUpperCase()}${t.slice(1)}Bypassable` as "refImageBypassable"];
                const pool = media.filter(m => m.type === t);
                return slots[t].map((p, i) => (
                  <div key={t + i} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className={label + " !mb-0"}>{labels[i] || `${t} ${i + 1}`}{bypass[i] ? " (optional)" : ""}</label>
                      {p && <button onClick={() => setSlot(t, i, "")} className="text-[11px] text-zinc-500 hover:text-white flex items-center gap-1"><X size={11} /> clear</button>}
                    </div>
                    {p && !pool.some(m => m.path === p) && (
                      <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                        {t === "image" && <img src={fileUrl(p)} alt="" className={`w-12 h-12 rounded-lg object-cover border-2 ${a.border}`} />}
                        <span className="truncate">{p.split(/[\\/]/).pop()}</span>
                      </div>
                    )}
                    {pool.length === 0 ? (
                      <p className="text-[11px] text-zinc-600">{media.length ? `No ${t}s in that folder.` : "Choose a folder above."}</p>
                    ) : (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {pool.map(m => (
                          <button key={m.path} onClick={() => setSlot(t, i, m.path)} title={m.name} className={`relative shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 transition-all ${p === m.path ? a.border + " scale-95" : "border-transparent opacity-70 hover:opacity-100"}`}>
                            {t === "image" ? <img src={fileUrl(m.path)} alt={m.name} loading="lazy" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-white/5 flex items-center justify-center text-zinc-500">{t === "video" ? <Film size={18} /> : <ImageIcon size={18} />}</div>}
                          </button>
                        ))}
                      </div>
                    )}
                    {!p && !bypass[i] && <p className="text-[11px] text-amber-400">Required - pick one.</p>}
                  </div>
                ));
              })}
            </div>
          )}

          {/* Settings */}
          {wf.fields.length > 0 && (
            <div className="glass p-5 rounded-[1.75rem] border-white/5 space-y-4">
              <p className="text-sm font-bold text-white">Settings</p>
              <div className="grid sm:grid-cols-2 gap-3">
                {wf.fields.map(f => {
                  const v = f.id in fieldValues ? fieldValues[f.id] : f.value;
                  const set = (x: any) => setFieldValues(s => ({ ...s, [f.id]: x }));
                  return (
                    <div key={f.id} className={f.kind === "text" ? "sm:col-span-2" : ""}>
                      <label className={label}>{f.label}</label>
                      {f.kind === "select" && f.options ? (
                        <select value={String(v)} onChange={e => set(e.target.value)} className={`${input} ${ring}`}>{f.options.map(o => <option key={o} value={o} className="bg-zinc-900">{o}</option>)}</select>
                      ) : f.kind === "bool" ? (
                        <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={!!v} onChange={e => set(e.target.checked)} /> {v ? "On" : "Off"}</label>
                      ) : f.kind === "int" || f.kind === "float" ? (
                        <input type="number" value={v ?? ""} step={f.kind === "int" ? 1 : "any"} onChange={e => set(e.target.value === "" ? "" : Number(e.target.value))} className={`${input} ${ring}`} />
                      ) : f.kind === "text" ? (
                        <textarea value={v ?? ""} rows={2} onChange={e => set(e.target.value)} className={`${input} ${ring} resize-y`} />
                      ) : (
                        <input value={v ?? ""} onChange={e => set(e.target.value)} className={`${input} ${ring}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer"><input type="checkbox" checked={randomSeed} onChange={e => setRandomSeed(e.target.checked)} /> <Dices size={14} /> New random seed every run</label>
            </div>
          )}

          {/* Output + run */}
          <div className="glass p-5 rounded-[1.75rem] border-white/5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={label}>Save to</label>
                <div className="flex gap-2">
                  <input value={dest} onChange={e => setDest(e.target.value)} placeholder={st?.defaultDestination || "outputs"} className={`${input} ${ring}`} />
                  <button onClick={() => chooseFolder("dest")} className="px-3 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 transition-colors" title="Browse"><FolderOpen size={14} /></button>
                </div>
              </div>
              <div>
                <label className={label}>File name (optional)</label>
                <input value={fileName} onChange={e => setFileName(e.target.value)} placeholder="Automatic" className={`${input} ${ring}`} />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={run} disabled={!canRun} className={`flex-1 flex items-center justify-center gap-2 ${a.solid} text-white font-bold text-sm py-3 rounded-2xl transition-all disabled:opacity-40 disabled:cursor-not-allowed`}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} {busy ? "Running..." : "Generate"}
              </button>
              {batch.length > 1 && !busy && <button onClick={runAll} disabled={!canRunBase || queuing} title="Queue every prompt found in the file" className="px-5 rounded-2xl bg-white/5 hover:bg-white/10 text-zinc-200 font-bold text-sm disabled:opacity-40 transition-colors">{queuing ? "Queuing..." : `Run all ${batch.length}`}</button>}
              {busy && <button onClick={cancel} className="px-5 rounded-2xl bg-red-600/80 hover:bg-red-500 text-white font-bold text-sm flex items-center gap-2 transition-colors"><Square size={14} /> Cancel</button>}
            </div>
            {wf.needsPrompt && !prompt.trim() && !busy && <p className="text-[11px] text-zinc-600">Enter a prompt to enable Generate.</p>}
            {busy && (
              <div className="space-y-3">
                <ProgressBar value={pct} label={status || "Working"} color={a.bar} />
                {queueNote && <p className="text-[11px] text-zinc-500">{queueNote}</p>}
                {preview && <img src={preview} alt="Live preview" className="max-h-64 rounded-xl border border-white/10" />}
              </div>
            )}
            {runError && !busy && <p className="text-[11px] text-red-400 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> <span>{runError}</span></p>}
            {result && !busy && (
              <div className="space-y-2">
                <Media path={result} className="max-h-96 rounded-xl border border-white/10" />
                <div className="flex gap-3 text-[11px]">
                  <button onClick={() => reveal(result)} className={`${a.text} hover:underline flex items-center gap-1`}><ExternalLink size={11} /> Show in folder</button>
                  <button onClick={() => removeResult(result)} className="text-zinc-500 hover:text-red-400 flex items-center gap-1"><Trash2 size={11} /> Delete</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Jobs from elsewhere */}
      {active.filter(r => r.runId !== runId).length > 0 && (
        <div className="glass p-5 rounded-[1.75rem] border-white/5 space-y-2">
          <p className="text-sm font-bold text-white">Running jobs</p>
          {active.filter(r => r.runId !== runId).map(r => (
            <div key={r.runId} className="flex items-center justify-between gap-3 text-xs text-zinc-400">
              <span className="truncate">{r.workflow} - {r.status}{r.ahead !== null ? ` (${r.ahead} ahead)` : ""}{r.progress ? ` ${r.progress[0]}/${r.progress[1]}` : ""}</span>
              {r.cancellable && <button onClick={() => cancelOther(r.runId)} className="text-red-400 hover:text-red-300 shrink-0">Cancel</button>}
            </div>
          ))}
        </div>
      )}

      {/* Recent results */}
      {history.length > 0 && (
        <div className="glass p-5 rounded-[1.75rem] border-white/5 space-y-3">
          <p className="text-sm font-bold text-white">Recent workflow results</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {history.slice(0, 12).map(h => (
              <div key={h.path} className="group relative rounded-xl overflow-hidden bg-white/5">
                <Media path={h.path} className="w-full aspect-square object-cover" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-[10px] font-bold text-white truncate">{h.workflow}</p>
                  <p className="text-[10px] text-zinc-400 truncate">{h.prompt}</p>
                  <div className="flex gap-3 mt-1">
                    {h.prompt && <button onClick={() => reusePrompt(h)} title="Reuse prompt" className="text-zinc-300 hover:text-white"><CornerUpLeft size={12} /></button>}
                    {isImage(h.path) && wf && wf.refImageCount > 0 && <button onClick={() => useAsReference(h.path)} title="Use as reference image" className="text-zinc-300 hover:text-white"><ImageIcon size={12} /></button>}
                    <button onClick={() => reveal(h.path)} title="Show in folder" className="text-zinc-300 hover:text-white"><ExternalLink size={12} /></button>
                    <button onClick={() => removeResult(h.path)} title="Delete" className="text-zinc-300 hover:text-red-400"><Trash2 size={12} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {folder && <Converter kind={kind} source={folder} />}

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
