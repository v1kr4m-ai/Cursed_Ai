import React from "react";
import { ArrowRight, Camera, Check, ExternalLink, ImagePlus, Loader2, Palette, Pencil, Play, Settings2, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { notify, notifyError } from "../../lib/notify";
import { api, fmtBytes, imgUrl, useJob, useTrainStatus } from "./trainApi";
import { GuideButton, LoraGuide } from "./Guide";
import { Badge, btn, btnDanger, btnPrimary, Card, Check as CheckBox, Field, FolderField, inputCls, JobConsole, NumberField, SelectField, Tabs, TextField, TrainProgress } from "./ui";

type Tab = "dataset" | "train";
const KEY = "cursed.trainlora";
const load = <T,>(d: T): T => { try { return { ...d, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return d; } };

interface Form {
  trigger: string; datasetDir: string; outputDir: string; baseModelPath: string;
  prompt: string; count: number; sketchRes: number;
  vramPreset: string; resolution: number; batchSize: number; epochs: number; numRepeats: number; networkDim: number; networkAlpha: number; learningRate: string; seed: number;
  captioner: string; redo: boolean;
}
const DEFAULTS: Form = {
  trigger: "", datasetDir: "", outputDir: "", baseModelPath: "", prompt: "", count: 4, sketchRes: 1024,
  vramPreset: "8G", resolution: 768, batchSize: 1, epochs: 16, numRepeats: 10, networkDim: 16, networkAlpha: 16, learningRate: "8e-4", seed: 42, captioner: "florence", redo: false,
};

interface Img { name: string; path: string; caption: string }

/** Train a character LoRA for Flux: build the image dataset, caption it, train it. Drives FluxGym's kohya sd-scripts. */
export function TrainLoraView() {
  const [guide, setGuide] = React.useState(false);
  const [status, reload] = useTrainStatus();
  const [tab, setTab] = React.useState<Tab>("dataset");
  const [f, setF] = React.useState<Form>(() => load(DEFAULTS));
  // Series sends a person here: their dataset and trigger word are filled in and the Train tab opens.
  React.useEffect(() => {
    const onPerson = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      setF(prev => { const n = { ...prev, trigger: String(d.trigger || prev.trigger).replace(/[^\w-]/g, ""), datasetDir: String(d.datasetDir || prev.datasetDir) }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* storage blocked */ } return n; });
      setTab("train");
      setTimeout(() => reload(), 300);
    };
    window.addEventListener("cursed:train-lora", onPerson);
    return () => window.removeEventListener("cursed:train-lora", onPerson);
  }, [reload]);
  const set = (patch: Partial<Form>) => setF(prev => { const n = { ...prev, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* storage blocked */ } return n; });
  const [images, setImages] = React.useState<Img[]>([]);
  const [newName, setNewName] = React.useState("");
  const [setupOpen, setSetupOpen] = React.useState(false);
  const [paths, setPaths] = React.useState({ fluxgymRoot: "", trainRoot: "" });
  const [files, setFiles] = React.useState<{ name: string; path: string; bytes: number }[]>([]);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [busyUpload, setBusyUpload] = React.useState(false);
  const [consoleKind, setConsoleKind] = React.useState<"lora" | "sketch" | "caption">("sketch");
  const lora = useJob("lora"), sketch = useJob("sketch"), caption = useJob("caption");
  const jobs = { lora, sketch, caption };
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { if (status) setPaths({ fluxgymRoot: status.paths.fluxgymRoot, trainRoot: status.paths.trainRoot }); }, [status?.paths.fluxgymRoot, status?.paths.trainRoot]); // eslint-disable-line react-hooks/exhaustive-deps
  // Defaults that depend on what is installed.
  React.useEffect(() => {
    if (!status) return;
    if (!f.baseModelPath && status.lora.baseModels[0]) set({ baseModelPath: status.lora.baseModels[0].path });
    if (!f.datasetDir && status.lora.datasets[0]) set({ datasetDir: status.lora.datasets[0].path });
  }, [status?.lora.baseModels.length, status?.lora.datasets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshImages = React.useCallback(async () => {
    if (!f.datasetDir) { setImages([]); return; }
    try { setImages((await api<{ images: Img[] }>(`/api/train/images?dir=${encodeURIComponent(f.datasetDir)}`)).images); } catch { setImages([]); }
  }, [f.datasetDir]);
  React.useEffect(() => { refreshImages(); }, [refreshImages]);
  // New pictures appear as a job writes them.
  React.useEffect(() => { if (sketch.running || caption.running) { const t = setInterval(refreshImages, 4000); return () => clearInterval(t); } refreshImages(); }, [sketch.running, caption.running]); // eslint-disable-line react-hooks/exhaustive-deps
  const outDir = f.outputDir || (status && f.trigger ? `${status.lora.outputDir}\\${f.trigger}` : "");
  const refreshFiles = React.useCallback(async () => { if (outDir) setFiles((await api<{ files: any[] }>(`/api/train/lora/files?dir=${encodeURIComponent(outDir)}`).catch(() => ({ files: [] }))).files); }, [outDir]);
  React.useEffect(() => { refreshFiles(); }, [refreshFiles, lora.running]);

  const guard = async (fn: () => Promise<any>) => { try { return await fn(); } catch (e: any) { notifyError(e?.message || String(e), "trainlora"); } };
  const start = (kind: "lora" | "sketch" | "caption", url: string, body: unknown) => guard(async () => { setConsoleKind(kind); await api(url, body); reload(); });

  const createDataset = () => guard(async () => { const r = await api<{ path: string }>("/api/train/dataset/create", { name: newName }); set({ datasetDir: r.path }); setNewName(""); reload(); });
  const upload = async (list: FileList | null) => {
    if (!list?.length || !f.datasetDir) { if (!f.datasetDir) notifyError("Choose or create a dataset folder first.", "trainlora"); return; }
    setBusyUpload(true);
    try {
      for (const file of Array.from(list)) {
        const res = await fetch(`/api/train/images/upload?dir=${encodeURIComponent(f.datasetDir)}&name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Could not add ${file.name}`);
      }
      notify({ message: `Added ${list.length} image${list.length === 1 ? "" : "s"}`, tab: "trainlora" });
      refreshImages(); reload();
    } catch (e: any) { notifyError(e.message, "trainlora"); }
    finally { setBusyUpload(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const saveCaption = (img: Img) => guard(async () => { await api("/api/train/caption", { path: img.path, caption: draft }, "PUT"); setEditing(null); refreshImages(); });
  const removeImage = (img: Img) => { if (window.confirm(`Delete ${img.name} (and its caption) from the dataset?`)) guard(async () => { await api(`/api/train/image?path=${encodeURIComponent(img.path)}`, undefined, "DELETE"); refreshImages(); reload(); }); };
  const startComfy = () => guard(async () => { await api("/api/comfyui/start", {}); reload(); });
  const install = (file: string) => guard(async () => { const r = await api<{ to: string }>("/api/train/lora/install", { file }); notify({ message: `Copied to ${r.to}`, tab: "trainlora" }); });
  const savePaths = () => guard(async () => { await api("/api/train/paths", paths); setSetupOpen(false); reload(); notify({ message: "Paths saved", tab: "trainlora" }); });

  const ready = status?.lora.ready;
  const trainReason = !f.trigger ? "Give the character a trigger word." : !f.datasetDir ? "Choose a dataset folder." : !images.length ? "The dataset folder has no images yet." : !ready ? "FluxGym is not fully set up (see Setup)." : "";
  const captioners = [{ value: "florence", label: "Florence-2 (FluxGym's environment)" }, ...(status?.ollama.vision || []).map(m => ({ value: m, label: `${m} (Ollama vision)` }))];
  const uncaptioned = images.filter(i => !i.caption).length;
  const busy = lora.running || sketch.running || caption.running;

  if (!status) return <div className="glass flex h-full flex-1 items-center justify-center rounded-[2.5rem] text-sm text-zinc-500"><Loader2 size={16} className="mr-2 animate-spin" />Loading...</div>;

  return (
    <div className="glass flex h-full flex-1 flex-col overflow-hidden rounded-[2.5rem]">
      {guide && <LoraGuide onClose={() => setGuide(false)} />}
      <div className="flex h-20 shrink-0 items-center justify-between gap-4 border-b border-white/5 px-8">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5"><Palette size={22} className="text-violet-400" /></div>
          <div className="min-w-0"><h1 className="text-lg font-bold leading-none tracking-tight text-white">Train LoRA</h1><p className="mt-1 truncate text-[11px] text-zinc-500">Character LoRA for Flux - from pictures to a trained .safetensors</p></div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <GuideButton onClick={() => setGuide(true)} />
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "dataset", label: "1  Dataset", busy: sketch.running || caption.running }, { id: "train", label: "2  Train", busy: lora.running }]} />
          <Badge ok={ready ?? null} title={ready ? "FluxGym, kohya and the Flux files were found" : "Missing: " + status.lora.missing.join(", ")}>{ready ? "FluxGym ready" : "FluxGym missing"}</Badge>
          <Badge ok={status.comfy.running} title="Used for the character sketch">ComfyUI {status.comfy.running ? "on" : "off"}</Badge>
          <button onClick={() => setSetupOpen(v => !v)} title="Folders" className={`p-2 transition-colors ${setupOpen ? "text-violet-400" : "text-zinc-500 hover:text-white"}`}><Settings2 size={18} /></button>
        </div>
      </div>

      <TrainProgress jobs={[{ title: "Train LoRA", job: lora }, { title: "Sketch", job: sketch }, { title: "Captions", job: caption }]} />

      {setupOpen && (
        <div className="grid shrink-0 gap-3 border-b border-white/5 bg-white/[0.02] px-8 py-4 md:grid-cols-3">
          <FolderField label="FluxGym folder" value={paths.fluxgymRoot} onChange={v => setPaths({ ...paths, fluxgymRoot: v })} hint="Holds kohya sd-scripts, its Python environment and the Flux files." />
          <FolderField label="Training folder" value={paths.trainRoot} onChange={v => setPaths({ ...paths, trainRoot: v })} hint="The folder with llm_finetune (used by FineTune LLM)." />
          <div className="flex items-end"><button onClick={savePaths} className={btnPrimary}><Check size={14} />Save</button></div>
          {!ready && <p className="text-[11px] text-amber-400 md:col-span-3">Missing: {status.lora.missing.join(", ")}</p>}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-6xl space-y-4">
          {tab === "dataset" ? (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Dataset folder" icon={<ImagePlus size={15} />} note="Pictures of the character, each with a .txt caption beside it. Everything on this page works on this folder.">
                  <SelectField label="Existing datasets" value={status.lora.datasets.find(d => d.path === f.datasetDir)?.path || ""} onChange={v => set({ datasetDir: v })} options={status.lora.datasets.map(d => ({ value: d.path, label: `${d.name} (${d.images} images)` }))} empty="No datasets yet" />
                  <FolderField label="Or any folder" value={f.datasetDir} onChange={v => set({ datasetDir: v })} placeholder="C:\\path\\to\\pictures" />
                  <div className="flex items-end gap-2"><div className="flex-1"><TextField label="New dataset" value={newName} onChange={setNewName} placeholder="e.g. richie" /></div><button onClick={createDataset} disabled={!newName.trim()} className={btn}>Create</button></div>
                  <TextField label="Character / trigger word" value={f.trigger} onChange={v => set({ trigger: v.replace(/[^\w-]/g, "") })} placeholder="e.g. richie01" hint="A made-up word that will call this character up in prompts." />
                </Card>

                <Card title="Character sketch (ComfyUI)" icon={<Sparkles size={15} />} note="A quick Flux text-to-image pass straight into the dataset, captions filled in. For the full multi-view character sheet, open ComfyUI with your own workflow and add its pictures below.">
                  <Field label="Prompt (the trigger word is added for you)"><textarea value={f.prompt} onChange={e => set({ prompt: e.target.value })} rows={3} placeholder="young woman, long dark hair, red saree, studio portrait, white background" className={inputCls + " resize-none"} /></Field>
                  <div className="grid grid-cols-2 gap-3"><NumberField label="Images" value={f.count} onChange={v => set({ count: v })} min={1} max={40} /><NumberField label="Size" value={f.sketchRes} onChange={v => set({ sketchRes: v })} min={512} max={1536} step={64} /></div>
                  <div className="flex flex-wrap gap-2">
                    {status.comfy.running
                      ? <button onClick={() => start("sketch", "/api/train/sketch/start", { triggerWord: f.trigger, prompt: f.prompt, count: f.count, resolution: f.sketchRes, datasetDir: f.datasetDir })} disabled={sketch.running || !f.trigger || !f.prompt.trim() || !f.datasetDir} className={btnPrimary}>{sketch.running ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}Generate into the dataset</button>
                      : <button onClick={startComfy} className={btnPrimary}><Play size={14} />Start ComfyUI</button>}
                    <button onClick={() => window.open(status.comfy.url, "_blank")} className={btn}><ExternalLink size={14} />Open ComfyUI</button>
                  </div>
                </Card>

                <Card title="Add pictures" icon={<Upload size={15} />} note="Drop in photos or renders (png, jpg, webp). 15-40 varied pictures of one character work best.">
                  <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp" hidden onChange={e => upload(e.target.files)} />
                  <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); upload(e.dataTransfer.files); }} className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/15 px-4 py-8 text-center">
                    <Camera size={22} className="text-zinc-600" />
                    <p className="text-xs text-zinc-500">Drag pictures here, or</p>
                    <button onClick={() => fileRef.current?.click()} disabled={busyUpload} className={btn}>{busyUpload ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}Choose pictures</button>
                  </div>
                </Card>

                <Card title="Captions" icon={<Pencil size={15} />} note="Each picture needs a short description of what is in it. Auto-captioning writes them for every picture that has none; click a caption in the grid to fix it by hand.">
                  <SelectField label="Captioning with" value={f.captioner} onChange={v => set({ captioner: v })} options={captioners} />
                  <CheckBox label="Redo captions that already exist" checked={f.redo} onChange={v => set({ redo: v })} />
                  <div className="flex items-center gap-3">
                    <button onClick={() => start("caption", "/api/train/caption/start", { datasetDir: f.datasetDir, triggerWord: f.trigger, overwrite: f.redo, model: f.captioner === "florence" ? "" : f.captioner })} disabled={caption.running || !f.datasetDir || !images.length} className={btnPrimary}>{caption.running ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}Auto-caption</button>
                    <span className="text-[11px] text-zinc-500">{uncaptioned ? `${uncaptioned} of ${images.length} without a caption` : images.length ? "All captioned" : ""}</span>
                  </div>
                </Card>
              </div>

              <Card title={`Dataset preview (${images.length})`} icon={<ImagePlus size={15} />} right={<button onClick={refreshImages} className="text-[11px] text-zinc-500 hover:text-white">Refresh</button>}>
                {!images.length ? <p className="text-xs text-zinc-600">{f.datasetDir ? "No pictures in this folder yet." : "Choose a dataset folder."}</p> : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                    {images.map(img => (
                      <div key={img.path} className="group overflow-hidden rounded-xl border border-white/5 bg-black/20">
                        <div className="relative aspect-square">
                          <img src={imgUrl(img.path)} alt={img.name} loading="lazy" className="h-full w-full object-cover" />
                          <button onClick={() => removeImage(img)} title="Delete" className="absolute right-1.5 top-1.5 hidden rounded-full bg-black/60 p-1.5 text-zinc-300 hover:text-rose-400 group-hover:block"><Trash2 size={12} /></button>
                        </div>
                        {editing === img.path ? (
                          <div className="space-y-1 p-2"><textarea value={draft} onChange={e => setDraft(e.target.value)} rows={4} className={inputCls + " resize-none text-[11px]"} /><div className="flex gap-1.5"><button onClick={() => saveCaption(img)} className={btnPrimary + " !px-2.5 !py-1"}>Save</button><button onClick={() => setEditing(null)} className={btn + " !px-2.5 !py-1"}>Cancel</button></div></div>
                        ) : (
                          <button onClick={() => { setEditing(img.path); setDraft(img.caption); }} title={img.caption || "Click to write a caption"} className="block w-full p-2 text-left text-[10px] leading-snug text-zinc-500 hover:text-zinc-300"><span className="line-clamp-3">{img.caption || <em className="text-amber-500/80">no caption - click to write one</em>}</span></button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="What to train" icon={<Palette size={15} />}>
                  <TextField label="Character / trigger word" value={f.trigger} onChange={v => set({ trigger: v.replace(/[^\w-]/g, "") })} placeholder="e.g. richie01" />
                  <SelectField label="Dataset" value={status.lora.datasets.find(d => d.path === f.datasetDir)?.path || ""} onChange={v => set({ datasetDir: v })} options={status.lora.datasets.map(d => ({ value: d.path, label: `${d.name} (${d.images} images)` }))} hint={f.datasetDir ? `${images.length} pictures, ${uncaptioned} without a caption` : undefined} />
                  <SelectField label="Base model (the checkpoint the LoRA is trained on)" value={f.baseModelPath} onChange={v => set({ baseModelPath: v })} options={status.lora.baseModels.map(m => ({ value: m.path, label: `${m.name} (${fmtBytes(m.bytes)})` }))} empty="No Flux checkpoint found" hint="Add another .sft / .safetensors to FluxGym's models/unet folder and it shows up here." />
                  <FolderField label="Save the LoRA to" value={f.outputDir} onChange={v => set({ outputDir: v })} placeholder={outDir || "defaults to FluxGym's outputs folder"} />
                </Card>
                <Card title="Settings" icon={<Settings2 size={15} />} note="The defaults suit an 8 GB card: fp8 weights with transformer blocks swapped through system RAM. Close other heavy programs while it runs.">
                  <SelectField label="GPU memory" value={f.vramPreset} onChange={v => set({ vramPreset: v })} options={[{ value: "8G", label: "8 GB (fp8 + block swap)" }, { value: "12G", label: "12 GB (fp8 + light swap)" }, { value: "16G", label: "16 GB (fp8)" }, { value: "20G", label: "20 GB or more (full precision)" }]} />
                  <div className="grid grid-cols-3 gap-3">
                    <SelectField label="Resolution" value={String(f.resolution)} onChange={v => set({ resolution: Number(v) })} options={["512", "768", "1024"].map(v => ({ value: v, label: v }))} />
                    <NumberField label="Batch" value={f.batchSize} onChange={v => set({ batchSize: v })} min={1} max={8} />
                    <NumberField label="Epochs" value={f.epochs} onChange={v => set({ epochs: v })} min={1} max={500} />
                    <NumberField label="Repeats / image" value={f.numRepeats} onChange={v => set({ numRepeats: v })} min={1} max={100} />
                    <NumberField label="Rank (dim)" value={f.networkDim} onChange={v => set({ networkDim: v })} min={1} max={256} />
                    <NumberField label="Alpha" value={f.networkAlpha} onChange={v => set({ networkAlpha: v })} min={1} max={256} />
                    <TextField label="Learning rate" value={f.learningRate} onChange={v => set({ learningRate: v })} />
                    <NumberField label="Seed" value={f.seed} onChange={v => set({ seed: v })} min={0} />
                  </div>
                </Card>
              </div>

              <Card title="Trained LoRAs" icon={<Check size={15} />} note={outDir ? `In ${outDir}. One file is saved per epoch.` : "Set a trigger word to see where they are saved."} right={<button onClick={refreshFiles} className="text-[11px] text-zinc-500 hover:text-white">Refresh</button>}>
                {!files.length ? <p className="text-xs text-zinc-600">Nothing trained here yet.</p> : (
                  <div className="space-y-1.5">{files.map(file => (
                    <div key={file.path} className="flex items-center gap-3 rounded-xl border border-white/5 px-3 py-2 text-xs">
                      <span className="min-w-0 flex-1 truncate font-mono text-zinc-300">{file.name}</span><span className="text-zinc-600">{fmtBytes(file.bytes)}</span>
                      <button onClick={() => install(file.path)} disabled={!status.comfyRoot} title={status.comfyRoot ? "Copy into ComfyUI's loras folder" : "Set ComfyUI's folder on the Image page first"} className={btn + " !py-1"}>Copy to ComfyUI</button>
                    </div>
                  ))}</div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-white/5 p-4">
        <div className="mx-auto max-w-6xl">
        {tab === "dataset" && (
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <button onClick={() => setTab("train")} className={btnPrimary}>Next: Train<ArrowRight size={14} /></button>
            <span className="text-[11px] text-zinc-500">When the pictures and captions look right, go to the Train tab and press Start.</span>
          </div>
        )}
          {tab === "train" && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button onClick={() => start("lora", "/api/train/lora/start", { triggerWord: f.trigger, datasetDir: f.datasetDir, outputDir: f.outputDir, baseModelPath: f.baseModelPath, resolution: f.resolution, batchSize: f.batchSize, numRepeats: f.numRepeats, networkDim: f.networkDim, networkAlpha: f.networkAlpha, learningRate: f.learningRate, epochs: f.epochs, vramPreset: f.vramPreset, seed: f.seed })} disabled={!!trainReason || busy} title={trainReason} className={btnPrimary}>{lora.running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}Start LoRA training</button>
          {lora.running && <button onClick={lora.stop} className={btnDanger}>Stop</button>}
          {trainReason && <span className="text-[11px] text-amber-400">{trainReason}</span>}
          {!trainReason && <span className="text-[11px] text-zinc-500">ComfyUI's and Ollama's models are unloaded first so training has the GPU to itself.</span>}
        </div>
          )}
          <div className="mb-2 flex items-center gap-1.5">{([["sketch", "Sketch"], ["caption", "Captions"], ["lora", "Training"]] as const).map(([k, l]) => <button key={k} onClick={() => setConsoleKind(k)} className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${consoleKind === k ? "bg-white/10 text-white" : "text-zinc-600 hover:text-zinc-300"}`}>{l}{jobs[k].running ? " ..." : ""}</button>)}</div>
          <div className="h-48"><JobConsole job={jobs[consoleKind]} title={consoleKind === "lora" ? "Training" : consoleKind === "sketch" ? "Character sketch" : "Captioning"} /></div>
        </div>
      </div>
    </div>
  );
}
