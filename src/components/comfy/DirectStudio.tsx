import React from "react";
import { AlertTriangle, Minus, ListPlus, CornerUpLeft, Cpu, ExternalLink, Film, ImageIcon, Loader2, Play, Plus, Trash2, Type, X, Layers } from "lucide-react";
import { HistoryPanel, PromptItem } from "./HistoryPanel";
import { notify, notifyError } from "../../lib/notify";
import { friendlyError } from "../../services/errors";
import { PromptSource } from "./PromptSource";
import { ShareMenu } from "./ShareMenu";
import { MediaView, QueueList, QueueRow, Section, Stage, StudioFrame, fieldCls, iconBtn, isImagePath, label } from "./shared";
import { ACCENT, Kind, api, fileUrl, nativeFiles, postJson } from "./types";

const SIZES = {
  image: [
    { label: "512×512", width: 512, height: 512 },
    { label: "768×768", width: 768, height: 768 },
    { label: "1024×1024", width: 1024, height: 1024 },
    { label: "1024×576 (wide)", width: 1024, height: 576 },
  ],
  video: [
    { label: "768×512 (wide)", width: 768, height: 512 },
    { label: "512×768 (tall)", width: 512, height: 768 },
    { label: "640×640 (square)", width: 640, height: 640 },
  ],
};

interface Job {
  id: string; prompt: string; negative: string; status: "queued" | "running" | "paused" | "done" | "failed" | "cancelled";
  percent: number | null; label: string; url?: string; file?: string; error?: string;
  checkpoint: string; width: number; height: number; image: string | null;
}
interface View { url: string; file?: string; prompt?: string }
interface GalleryItem { file: string; url: string; createdAt: number }

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.onerror = reject; r.readAsDataURL(blob); });
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
});

/**
 * Cloud (Gemini / Veo) and Quick (built-in ComfyUI workflow) generation, laid out like the Workflows studio:
 * controls on the left, canvas + queue + recent results on the right. Jobs wait in a queue that runs one at a time
 * and can be paused, resumed or cancelled.
 */
export function DirectStudio({ kind, engine, modelId, toolbar, showHistory, onCloseHistory }: { kind: Kind; engine: "cloud" | "quick"; modelId?: string; toolbar: React.ReactNode; showHistory: boolean; onCloseHistory: () => void }) {
  const a = ACCENT[kind];
  const ring = `focus:ring-1 ${a.ring}`;
  const field = fieldCls(a.ring);
  const sizes = SIZES[kind];

  const [prompt, setPrompt] = React.useState("");
  const [negative, setNegative] = React.useState("");
  const [batch, setBatch] = React.useState<string[]>([]);
  const [checkpoints, setCheckpoints] = React.useState<string[]>([]);
  const [checkpoint, setCheckpoint] = React.useState("");
  const [ckptError, setCkptError] = React.useState<string | null>(null);
  const [sizeIdx, setSizeIdx] = React.useState(kind === "image" ? 2 : 0);
  const [refImage, setRefImage] = React.useState<string | null>(null);
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [count, setCount] = React.useState(1);
  const [view, setView] = React.useState<View | null>(null);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [gallery, setGallery] = React.useState<GalleryItem[]>([]);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [hasKey, setHasKey] = React.useState<boolean | null>(null);
  const controllers = React.useRef(new Map<string, AbortController>());
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);

  // --- supporting data ---
  const loadCheckpoints = React.useCallback(() => {
    setCkptError(null);
    fetch(`/api/comfyui/checkpoints?kind=${kind}`).then(r => r.json()).then(d => {
      if (d.error) throw new Error(d.error);
      setCheckpoints(d.checkpoints || []);
      // Prefer a checkpoint that suits this tab (LTX for video, a normal image model otherwise) over 3D / audio ones.
      const all: string[] = d.checkpoints || [];
      const good = kind === "video" ? all.find(n => /ltx/i.test(n)) : all.find(n => !/3d|hunyuan|ace_step|ltx|mistoline/i.test(n));
      setCheckpoint(c => c || good || all[0] || "");
    }).catch(e => setCkptError(e.message));
  }, [kind]);
  React.useEffect(() => { if (engine === "quick") { loadCheckpoints(); const t = setInterval(() => { if (!checkpoints.length) loadCheckpoints(); }, 6000); return () => clearInterval(t); } }, [engine]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (engine === "cloud") fetch("/api/gemini-key").then(r => r.json()).then(d => setHasKey(!!d.set)).catch(() => {}); }, [engine, showHistory]);
  React.useEffect(() => {
    fetch(`/api/gallery?kind=${kind}`).then(r => r.json()).then(d => setGallery(d.items || [])).catch(() => {});
  }, [kind, refreshKey]);

  // --- queue ---
  const patch = (id: string, p: Partial<Job>) => setJobs(js => js.map(j => j.id === id ? { ...j, ...p } : j));

  const execute = async (job: Job, signal: AbortSignal) => {
    const body = (extra: object) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(extra), signal });
    if (kind === "image") {
      if (engine === "cloud") {
        patch(job.id, { label: "Waiting for Gemini..." });
        const r = await fetch("/api/image/generate", body({ prompt: job.prompt }));
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Generation failed");
        return { url: d.src as string, file: d.file as string | undefined };
      }
      const token = `img-${job.id}`;
      const poll = setInterval(async () => { try { const p = await (await fetch(`/api/progress/${token}`)).json(); patch(job.id, { percent: p.percent, label: p.label }); } catch { /* busy */ } }, 700);
      try {
        const r = await fetch("/api/comfyui/image/generate", body({ token, prompt: job.prompt, negativePrompt: job.negative, checkpoint: job.checkpoint, width: job.width, height: job.height, referenceImage: job.image }));
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Generation failed");
        return { url: d.src as string, file: d.file as string | undefined };
      } finally { clearInterval(poll); }
    }
    // video: start a job on the server, then follow it until it finishes
    const start = engine === "cloud"
      ? body({ prompt: job.prompt })
      : body({ prompt: job.prompt, negativePrompt: job.negative || undefined, image: job.image, checkpoint: job.checkpoint, width: job.width, height: job.height });
    const r = await fetch(engine === "cloud" ? "/api/video/generate" : "/api/comfyui/video/generate", start);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Failed to start generation");
    const serverId = d.id as string;
    patch(job.id, { label: engine === "cloud" ? "Generating with Veo - this can take a few minutes" : "Starting..." });
    try {
      for (;;) {
        await sleep(1500, signal);
        const s = await (await fetch(`/api/video/status/${serverId}`)).json();
        if (s.status === "done") return { url: s.resultUrl as string, file: s.file as string | undefined };
        if (s.status === "error") throw new Error(s.error || "Video generation failed");
        if (s.status === "cancelled") throw new DOMException("Cancelled", "AbortError");
        if (engine === "quick") { try { const p = await (await fetch(`/api/progress/${serverId}`)).json(); patch(job.id, { percent: p.percent, label: p.label || "Generating" }); } catch { /* busy */ } }
      }
    } catch (e) {
      if ((e as any)?.name === "AbortError") fetch(`/api/video/cancel/${serverId}`, { method: "POST" }).catch(() => {});
      throw e;
    }
  };

  // Worker: when nothing is running, start the oldest waiting job.
  React.useEffect(() => {
    if (jobs.some(j => j.status === "running")) return;
    const next = [...jobs].reverse().find(j => j.status === "queued");
    if (!next) return;
    const ctl = new AbortController();
    controllers.current.set(next.id, ctl);
    patch(next.id, { status: "running", percent: null, label: "Starting..." });
    setLastError(null);
    execute(next, ctl.signal).then(res => {
      patch(next.id, { status: "done", url: res.url, file: res.file });
      // Keep the prompt with its picture in the library.
      if (res.file) fetch("/api/prompts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, mode: engine, prompt: next.prompt, negative: next.negative, galleryFile: res.file, params: engine === "quick" ? { size: `${next.width}×${next.height}`, checkpoint: next.checkpoint } : {} }) }).catch(() => {}).finally(() => setRefreshKey(k => k + 1));
      setView({ url: res.url, file: res.file, prompt: next.prompt });
      setRefreshKey(k => k + 1);
      notify({ message: `${kind === "image" ? "Image" : "Video"} ready - ${next.prompt.slice(0, 60)}`, tab: kind, thumb: kind === "image" ? res.url : undefined });
    }).catch((e: any) => {
      if (e?.name === "AbortError") { patch(next.id, { status: "cancelled" }); return; }
      const m = friendlyError(e);
      patch(next.id, { status: "failed", error: m });
      setLastError(m);
      notifyError(`${kind === "image" ? "Image" : "Video"} failed: ${m}`, kind);
    }).finally(() => controllers.current.delete(next.id));
  }, [jobs]); // eslint-disable-line react-hooks/exhaustive-deps

  const enqueue = (prompts: string[]) => {
    if (engine === "quick" && !checkpoint) { setLastError("No checkpoint selected"); notifyError("No checkpoint selected", kind); return; }
    const size = sizes[sizeIdx];
    const fresh: Job[] = prompts.filter(p => p.trim()).flatMap(p => Array(count).fill(p) as string[]).map((p, i) => ({
      id: `${Date.now()}-${i}`, prompt: p.trim(), negative, status: "queued", percent: null, label: "Waiting",
      checkpoint, width: size.width, height: size.height, image: engine === "quick" ? refImage : null,
    }));
    if (!fresh.length) return;
    setJobs(js => [...fresh.reverse(), ...js]);
    if (fresh.length > 1 || running) notify({ message: `Added ${fresh.length} job${fresh.length > 1 ? "s" : ""} to the queue`, tab: kind });
  };
  const generate = () => { if (prompt.trim()) enqueue([prompt]); };
  const runAll = () => enqueue(batch);

  const pause = (id: string) => patch(id, { status: "paused" });
  const resume = (id: string) => patch(id, { status: "queued" });
  const cancel = (id: string) => {
    const j = jobs.find(x => x.id === id);
    if (j?.status === "running") controllers.current.get(id)?.abort();
    else setJobs(js => js.filter(x => x.id !== id));
  };
  const remove = (id: string) => setJobs(js => js.filter(x => x.id !== id));

  const active = jobs.filter(j => j.status === "queued" || j.status === "running" || j.status === "paused");
  const running = jobs.find(j => j.status === "running");
  const rows: QueueRow[] = [...active].reverse().map(j => ({
    id: j.id, label: j.prompt.slice(0, 80), status: j.status, detail: j.status === "running" && j.percent !== null ? `${Math.round(j.percent)}%` : undefined,
    pausable: j.status === "queued", cancellable: j.status === "queued" || j.status === "running",
  }));

  // --- reference / starting image ---
  const takeImage = async (src: Blob | string) => {
    try { setRefImage(typeof src === "string" ? src : await toDataUrl(src)); } catch (e: any) { notifyError(e.message, kind); }
  };
  const chooseImage = async () => {
    const items = await nativeFiles();
    if (items === null) { fileRef.current?.click(); return; }
    const it = items.find(i => i.type === "image");
    if (it) takeImage(await (await fetch(fileUrl(it.path))).blob());
  };
  const useResultAsImage = async (url: string) => takeImage(await (await fetch(url)).blob());

  // --- results ---
  const stageSrc = !running ? (view?.url || gallery[0]?.url || null) : null;
  const stageFile = view ? view.file : gallery.find(g => g.url === stageSrc)?.file;
  const removeResult = async () => {
    if (!stageFile || !window.confirm("Delete this file from disk? This can't be undone.")) return;
    await fetch(`/api/gallery/${kind}/${encodeURIComponent(stageFile)}`, { method: "DELETE" });
    setView(null); setRefreshKey(k => k + 1);
  };
  const reveal = () => stageFile && postJson("/api/gallery/reveal", { kind, file: stageFile }).catch(e => notifyError(e.message, kind));

  // "Use" in the prompt library: the prompt (and negative prompt) go back into the box.
  const useEntry = (it: PromptItem) => { setPrompt(it.prompt); setNegative(it.negative || ""); onCloseHistory(); notify({ message: "Prompt restored - edit it or press Generate", tab: kind }); };

  const needsPrompt = !prompt.trim();
  const canGenerate = !needsPrompt && !(engine === "cloud" && hasKey === false);

  const controls = (
    <>
      {engine === "quick" ? (
        <Section title="Model" icon={<Cpu size={14} />} accent={a.text} badge={checkpoint ? checkpoint.split(/[\\/]/).pop() : undefined} defaultOpen>
          {ckptError ? <p className="text-[11px] text-red-400 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {ckptError}</p> : (
            <div>
              <label className={label + " !mb-1"}>{kind === "video" ? "LTX-Video checkpoint" : "Checkpoint"}</label>
              <select value={checkpoint} onChange={e => setCheckpoint(e.target.value)} className={field}>
                {checkpoints.length === 0 && <option value="">No checkpoints found</option>}
                {checkpoints.map(c => <option key={c} value={c} className="bg-zinc-900">{c}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={label + " !mb-1"}>Size</label>
            <select value={sizeIdx} onChange={e => setSizeIdx(Number(e.target.value))} className={field}>
              {sizes.map((s, i) => <option key={s.label} value={i} className="bg-zinc-900">{s.label}</option>)}
            </select>
          </div>
        </Section>
      ) : (
        <Section title="Model" icon={<Layers size={14} />} accent={a.text} badge={kind === "image" ? "Imagen 4" : "Veo 2"} defaultOpen>
          <p className="text-[11px] text-zinc-500">{kind === "image" ? "Google's Imagen 4 through your Gemini key." : "Google's Veo 2 through your Gemini key - clips take a few minutes."}</p>
          {hasKey === false && <p className="text-[11px] text-amber-400 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> No Gemini key yet - click the key icon in the top bar to add yours.</p>}
        </Section>
      )}

      <Section title="Prompt" icon={<Type size={14} />} accent={a.text} badge={batch.length > 1 ? `${batch.length} from file` : undefined} defaultOpen>
        <div onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); generate(); } }}>
          <PromptSource bare kind={kind} modelId={modelId} prompt={prompt} onPrompt={setPrompt} needsPrompt onCandidates={setBatch} />
        </div>
        {engine === "quick" && (
          <div><label className={label + " !mb-1"}>Negative prompt (optional)</label>
            <input value={negative} onChange={e => setNegative(e.target.value)} placeholder="Things to avoid..." className={field} /></div>
        )}
      </Section>

      {engine === "quick" && (
        <Section title={kind === "video" ? "Starting image" : "Reference"} icon={<ImageIcon size={14} />} accent={a.text} badge={refImage ? "set" : "optional"} defaultOpen={!!refImage}>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { if (e.target.files?.[0]) takeImage(e.target.files[0]); e.target.value = ""; }} />
          <div
            className={`flex items-center gap-3 rounded-xl transition-all ${drag ? `ring-2 ${a.border} p-2` : ""}`}
            onDragOver={e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f?.type.startsWith("image/")) takeImage(f); }}
          >
            <button onClick={chooseImage} title="Choose an image" className={`relative w-16 h-16 shrink-0 rounded-xl overflow-hidden border-2 border-dashed transition-colors flex items-center justify-center ${refImage ? "border-transparent" : "border-white/15 hover:border-white/30 text-zinc-600"}`}>
              {refImage ? <img src={refImage} alt="" className="w-full h-full object-cover" /> : <Plus size={18} />}
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-zinc-200">{kind === "video" ? "Start the clip from an image" : "Image-to-image"}</p>
              <p className="text-[11px] text-zinc-500">{refImage ? "Used for every job you add next." : "Optional - choose or drop an image."}</p>
            </div>
            {refImage && <button onClick={() => setRefImage(null)} title="Clear" className={iconBtn}><X size={13} /></button>}
          </div>
        </Section>
      )}
    </>
  );

  const actionBar = (
    <>
      <div className="flex gap-2">
        <button onClick={generate} disabled={!canGenerate} className={`flex-1 flex items-center justify-center gap-2 ${a.solid} text-white font-bold text-sm py-3 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-black/30`}>
          {running ? <ListPlus size={16} /> : <Play size={16} className="fill-current" />} {running ? "Add to queue" : "Generate"}{count > 1 ? ` ×${count}` : ""}
        </button>
        <div className="flex items-center rounded-xl bg-white/5 border border-white/[0.06] overflow-hidden" title="How many times to run it">
          <button onClick={() => setCount(c => Math.max(1, c - 1))} disabled={count <= 1} className="px-2.5 h-full text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"><Minus size={14} /></button>
          <span className="w-8 text-center text-sm font-bold text-white tabular-nums">{count}</span>
          <button onClick={() => setCount(c => Math.min(20, c + 1))} disabled={count >= 20} className="px-2.5 h-full text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"><Plus size={14} /></button>
        </div>
        {batch.length > 1 && <button onClick={runAll} disabled={engine === "cloud" && hasKey === false} title="Queue every prompt found in the file" className="px-4 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-200 font-bold text-xs disabled:opacity-40 transition-colors whitespace-nowrap">{`Run all ${batch.length}${count > 1 ? ` ×${count}` : ""}`}</button>}
      </div>
      {needsPrompt && <p className="text-[11px] text-zinc-600 text-center">Write a prompt (or open a file) to enable Generate.</p>}
      {!needsPrompt && engine === "cloud" && hasKey === false && <p className="text-[11px] text-amber-400 text-center">Add your Gemini key (key icon, top bar) to generate.</p>}
    </>
  );

  const canvas = showHistory ? (
    <>
      <HistoryPanel kind={kind} refreshKey={refreshKey} onUse={useEntry} />
      <QueueList kind={kind} rows={rows} onPause={pause} onResume={resume} onCancel={cancel} onRemove={remove} />
    </>
  ) : (
    <>
      <Stage kind={kind} busy={!!running} status={running?.label} percent={running?.percent ?? null} src={stageSrc} error={lastError} />
      {stageSrc && !running && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] text-zinc-500 truncate flex-1 min-w-[140px]" title={view?.prompt}>{view?.prompt || (stageFile ?? "")}</p>
          {view?.prompt && <button onClick={() => setPrompt(view.prompt!)} title="Reuse this prompt" className={`${iconBtn} flex items-center gap-1.5 text-[11px] font-semibold`}><CornerUpLeft size={13} /> Prompt</button>}
          {engine === "quick" && isImagePath(stageSrc) && <button onClick={() => useResultAsImage(stageSrc)} title={kind === "video" ? "Start the next clip from this image" : "Use as reference image"} className={`${iconBtn} flex items-center gap-1.5 text-[11px] font-semibold`}><ImageIcon size={13} /> {kind === "video" ? "Start frame" : "Reference"}</button>}
          <ShareMenu kind={kind} url={stageSrc} caption={view?.prompt} onReveal={stageFile ? reveal : undefined} tab={kind} />
          {stageFile && <button onClick={reveal} title="Show in folder" className={iconBtn}><ExternalLink size={14} /></button>}
          {stageFile && <button onClick={removeResult} title="Delete this result" className={`${iconBtn} hover:!text-red-400`}><Trash2 size={14} /></button>}
        </div>
      )}
      <QueueList kind={kind} rows={rows} onPause={pause} onResume={resume} onCancel={cancel} onRemove={remove} />
      {gallery.length > 0 && (
        <div>
          <p className={label}>Recent</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {gallery.slice(0, 24).map(g => (
              <button key={g.file} onClick={() => setView({ url: g.url, file: g.file })} className={`shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 transition-all ${stageSrc === g.url ? a.border : "border-transparent opacity-70 hover:opacity-100"}`}>
                {kind === "video" ? <div className="w-full h-full bg-white/5 flex items-center justify-center text-zinc-400"><Film size={18} /></div> : <img src={g.url} alt="" loading="lazy" className="w-full h-full object-cover" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );

  return <StudioFrame toolbar={toolbar} controls={controls} actionBar={actionBar} canvas={canvas} />;
}
