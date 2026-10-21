import React from "react";
import { BookOpen, Check, Cloud, Download, FileText, GraduationCap, Globe, ImagePlus, Link2, Loader2, Play, Plus, Settings2, Sparkles, Trash2, Upload } from "lucide-react";
import { notify, notifyError } from "../../lib/notify";
import { api, fmtBytes, useJob, useTrainStatus } from "./trainApi";
import { Badge, btn, btnDanger, btnPrimary, Card, Check as CheckBox, Field, FolderField, inputCls, JobConsole, NumberField, SelectField, Tabs, TextField } from "./ui";

type Tab = "dataset" | "train";
interface Example { instruction: string; input: string; output: string }
interface Source { type: "pdf" | "docx" | "image" | "url" | "text"; value: string; label: string }

const KEY = "cursed.finetune";
interface Form {
  baseModelDir: string; datasetFile: string; outputDir: string; rank: number; alpha: number; epochs: number; learningRate: string; batchSize: number; maxSeqLength: number; exportGguf: boolean; ollamaName: string;
  pairModel: string; visionModel: string; count: number; topic: string; fileName: string;
}
const DEFAULTS: Form = { baseModelDir: "", datasetFile: "", outputDir: "", rank: 16, alpha: 16, epochs: 3, learningRate: "2e-4", batchSize: 2, maxSeqLength: 2048, exportGguf: true, ollamaName: "", pairModel: "", visionModel: "", count: 5, topic: "", fileName: "" };
const load = (): Form => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEFAULTS; } };

/** Base models that fit a small card in 4-bit; downloaded once, then everything runs offline. */
const SUGGESTED = [
  { repo: "unsloth/Phi-3.5-mini-instruct-bnb-4bit", note: "3.8B, about 2.3 GB - the safest fit for 8 GB cards" },
  { repo: "unsloth/Llama-3.2-3B-Instruct-bnb-4bit", note: "3B, about 2 GB" },
  { repo: "unsloth/Qwen2.5-3B-Instruct-bnb-4bit", note: "3B, about 2 GB, good in many languages" },
  { repo: "unsloth/gemma-2-2b-it-bnb-4bit", note: "2B, about 1.7 GB, the lightest" },
];

/** Same text train.py builds from an example, so there is no guessing what the model sees. */
const preview = (e: Partial<Example>) => {
  const inp = (e.input || "").trim();
  return `### Instruction:\n${(e.instruction || "").trim()}\n${inp ? `\n### Input:\n${inp}\n` : ""}\n### Response:\n${(e.output || "").trim()}`;
};

function parseCsv(text: string): Example[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const head = lines[0]?.split(",").map(h => h.trim().toLowerCase()) || [];
  const [i, n, o] = [head.indexOf("instruction"), head.indexOf("input"), head.indexOf("output")];
  if (i < 0 || o < 0) throw new Error('The CSV needs "instruction" and "output" columns.');
  return lines.slice(1).map(l => { const c = l.split(","); return { instruction: (c[i] || "").trim(), input: (c[n] || "").trim(), output: (c[o] || "").trim() }; }).filter(e => e.instruction && e.output);
}

/** Fine-tune a language model on your own examples (Unsloth QLoRA), then send it to Ollama. */
export function FineTuneView() {
  const [status, reload] = useTrainStatus();
  const [tab, setTab] = React.useState<Tab>("dataset");
  const [f, setF] = React.useState<Form>(load);
  const set = (patch: Partial<Form>) => setF(prev => { const n = { ...prev, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* storage blocked */ } return n; });
  const [sources, setSources] = React.useState<Source[]>([]);
  const [examples, setExamples] = React.useState<Example[]>([]);
  const [hand, setHand] = React.useState<Example>({ instruction: "", input: "", output: "" });
  const [url, setUrl] = React.useState("");
  const [pasted, setPasted] = React.useState("");
  const [pairModels, setPairModels] = React.useState<{ ollama: string[]; vision: string[]; gemini: boolean }>({ ollama: [], vision: [], gemini: false });
  const [setupOpen, setSetupOpen] = React.useState(false);
  const [trainRoot, setTrainRoot] = React.useState("");
  const [repo, setRepo] = React.useState(SUGGESTED[0].repo);
  const [regName, setRegName] = React.useState("");
  const [previewText, setPreviewText] = React.useState<{ label: string; text: string } | null>(null);
  const [consoleKind, setConsoleKind] = React.useState<"pairs" | "llm" | "download">("pairs");
  const pairs = useJob("pairs"), llm = useJob("llm"), dl = useJob("download");
  const jobs = { pairs, llm, download: dl };
  const fileRef = React.useRef<HTMLInputElement>(null);
  const importRef = React.useRef<HTMLInputElement>(null);
  const seenResult = React.useRef<number | null>(null);

  React.useEffect(() => { if (status) setTrainRoot(status.paths.trainRoot); }, [status?.paths.trainRoot]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { api("/api/train/pair-models").then(setPairModels).catch(() => {}); }, [status?.ollama.models.length, status?.gemini]);
  React.useEffect(() => {
    if (!status) return;
    if (!f.baseModelDir && status.llm.baseModels[0]) set({ baseModelDir: status.llm.baseModels[0].path });
    if (!f.pairModel && pairModels.ollama[0]) set({ pairModel: pairModels.ollama.find(m => /qwen|llama|gemma|mistral|phi/i.test(m) && !/cloud/.test(m)) ? "ollama::" + pairModels.ollama.find(m => /qwen|llama|gemma|mistral|phi/i.test(m) && !/cloud/.test(m)) : "ollama::" + pairModels.ollama[0] });
    if (!f.visionModel && pairModels.vision[0]) set({ visionModel: pairModels.vision[0] });
  }, [status?.llm.baseModels.length, pairModels.ollama.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pairs finished: they join the list.
  React.useEffect(() => {
    const s = pairs.state;
    if (s && !s.running && s.endedAt && s.endedAt !== seenResult.current && s.result?.examples) {
      seenResult.current = s.endedAt;
      setExamples(prev => [...prev, ...s.result.examples]);
      notify({ message: `${s.result.examples.length} pairs added - review them below`, tab: "finetune" });
    } else if (s?.endedAt) seenResult.current = seenResult.current ?? s.endedAt;
  }, [pairs.state]);
  React.useEffect(() => { if (dl.state && !dl.running) reload(); }, [dl.running]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (llm.state && !llm.running) reload(); }, [llm.running]); // eslint-disable-line react-hooks/exhaustive-deps

  const guard = async (fn: () => Promise<any>) => { try { return await fn(); } catch (e: any) { notifyError(e?.message || String(e), "finetune"); } };
  const run = (kind: "pairs" | "llm" | "download", url: string, body: unknown) => guard(async () => { setConsoleKind(kind); await api(url, body); reload(); });

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    guard(async () => {
      for (const file of Array.from(list)) {
        const res = await fetch(`/api/train/source/upload?name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || `Could not add ${file.name}`);
        setSources(s => [...s, d]);
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  };
  const addUrl = () => { if (/^https?:\/\//i.test(url.trim())) { setSources(s => [...s, { type: "url", value: url.trim(), label: url.trim() }]); setUrl(""); } else notifyError("Use a full address starting with http:// or https://", "finetune"); };
  const addText = () => { if (pasted.trim()) { setSources(s => [...s, { type: "text", value: pasted, label: `Pasted text (${pasted.length.toLocaleString()} characters)` }]); setPasted(""); } };
  const peek = (s: Source) => guard(async () => { const r = await api<{ text: string; chars: number }>("/api/train/source/preview", { ...s, visionModel: f.visionModel || undefined }); setPreviewText({ label: `${s.label} - ${r.chars.toLocaleString()} characters`, text: r.text.slice(0, 4000) || "(nothing could be read)" }); });
  const addExample = () => { if (hand.instruction.trim() && hand.output.trim()) { setExamples(e => [...e, { ...hand }]); setHand({ instruction: "", input: "", output: "" }); } };
  const importFile = async (file?: File) => {
    if (!file) return;
    await guard(async () => {
      const text = await file.text();
      const rows: Example[] = file.name.toLowerCase().endsWith(".csv") ? parseCsv(text) : text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l)).map((e: any) => ({ instruction: String(e.instruction || ""), input: String(e.input || ""), output: String(e.output || "") })).filter(e => e.instruction && e.output);
      setExamples(prev => [...prev, ...rows]);
      notify({ message: `Imported ${rows.length} examples`, tab: "finetune" });
    });
    if (importRef.current) importRef.current.value = "";
  };
  const openDataset = (p: string) => guard(async () => { const r = await api<{ examples: Example[] }>("/api/train/llm/dataset/load", { path: p }); setExamples(r.examples); set({ fileName: p.split(/[\\/]/).pop()!.replace(/\.jsonl$/i, "") }); });
  const saveDataset = () => guard(async () => { const r = await api<{ file: string; count: number }>("/api/train/llm/dataset/save", { fileName: f.fileName, examples }); set({ datasetFile: r.file }); notify({ message: `Saved ${r.count} examples - ready to train on`, tab: "finetune" }); reload(); });
  const edit = (i: number, patch: Partial<Example>) => setExamples(l => l.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  const sourceIcon = (t: Source["type"]) => t === "image" ? <ImagePlus size={14} /> : t === "url" ? <Globe size={14} /> : <FileText size={14} />;
  const pairOptions = [...pairModels.ollama.map(m => ({ value: "ollama::" + m, label: m + (/cloud/.test(m) ? " (online)" : " (offline)") })), ...(pairModels.gemini ? [{ value: "gemini::gemini-2.5-flash", label: "Gemini 2.5 Flash (online)" }, { value: "gemini::gemini-2.5-pro", label: "Gemini 2.5 Pro (online)" }] : [])];
  const imageSource = sources.some(s => s.type === "image");
  const trainReason = !status?.llm.ready ? "The fine-tuning environment was not found (see Setup)." : !f.baseModelDir ? "Choose a base model (or download one)." : !f.datasetFile ? "Choose or save a dataset." : "";
  const busy = pairs.running || llm.running || dl.running;
  const datasetOptions = status?.llm.datasets.map(d => ({ value: d.path, label: `${d.name} (${d.examples} examples)` })) || [];

  if (!status) return <div className="glass flex h-full flex-1 items-center justify-center rounded-[2.5rem] text-sm text-zinc-500"><Loader2 size={16} className="mr-2 animate-spin" />Loading...</div>;

  return (
    <div className="glass flex h-full flex-1 flex-col overflow-hidden rounded-[2.5rem]">
      <div className="flex h-20 shrink-0 items-center justify-between gap-4 border-b border-white/5 px-8">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5"><GraduationCap size={22} className="text-violet-400" /></div>
          <div className="min-w-0"><h1 className="text-lg font-bold leading-none tracking-tight text-white">FineTune LLM</h1><p className="mt-1 truncate text-[11px] text-zinc-500">Teach a small model your own material, then use it in Ollama</p></div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "dataset", label: "1  Dataset", busy: pairs.running }, { id: "train", label: "2  Fine-tune", busy: llm.running }]} />
          <Badge ok={status.llm.ready} title={status.llm.ready ? "Unsloth environment found" : "Not found at " + status.paths.llmPython}>{status.llm.ready ? "Unsloth ready" : "Unsloth missing"}</Badge>
          <Badge ok={status.ollama.running} title="Writes the pairs, and receives the finished model">Ollama {status.ollama.running ? "on" : "off"}</Badge>
          <button onClick={() => setSetupOpen(v => !v)} title="Folders" className={`p-2 transition-colors ${setupOpen ? "text-violet-400" : "text-zinc-500 hover:text-white"}`}><Settings2 size={18} /></button>
        </div>
      </div>

      {setupOpen && (
        <div className="grid shrink-0 gap-3 border-b border-white/5 bg-white/[0.02] px-8 py-4 md:grid-cols-3">
          <FolderField label="Training folder" value={trainRoot} onChange={setTrainRoot} hint="Holds llm_finetune/ with the Python environment, models, datasets and outputs." />
          <div className="flex items-end"><button onClick={() => guard(async () => { await api("/api/train/paths", { trainRoot }); setSetupOpen(false); reload(); })} className={btnPrimary}><Check size={14} />Save</button></div>
          <p className="self-end text-[11px] text-zinc-500">Python: {status.paths.llmPython}</p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-6xl space-y-4">
          {tab === "dataset" ? (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Build from your material" icon={<BookOpen size={15} />} note="Add PDFs, Word files, pictures, web pages or text. A model reads each one and writes question-and-answer pairs from what is really in it; answers that only describe the source are thrown away.">
                  <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt,.md,image/png,image/jpeg,image/webp" hidden onChange={e => addFiles(e.target.files)} />
                  <div className="flex flex-wrap gap-2"><button onClick={() => fileRef.current?.click()} className={btn}><Upload size={14} />Add files...</button></div>
                  <div className="flex gap-2"><input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && addUrl()} placeholder="https://..." className={inputCls} /><button onClick={addUrl} className={btn}><Link2 size={14} />Add page</button></div>
                  <div className="flex gap-2"><textarea value={pasted} onChange={e => setPasted(e.target.value)} rows={2} placeholder="...or paste text here" className={inputCls + " resize-none"} /><button onClick={addText} disabled={!pasted.trim()} className={btn + " self-start"}><Plus size={14} />Add</button></div>
                  {sources.length > 0 && (
                    <div className="space-y-1.5">{sources.map((s, i) => (
                      <div key={i} className="flex items-center gap-2.5 rounded-xl border border-white/5 px-3 py-2 text-xs"><span className="text-violet-400">{sourceIcon(s.type)}</span><span className="min-w-0 flex-1 truncate text-zinc-300">{s.label}</span>
                        <button onClick={() => peek(s)} className="text-[11px] text-zinc-500 hover:text-white">Preview text</button><button onClick={() => setSources(l => l.filter((_, j) => j !== i))} className="text-zinc-600 hover:text-rose-400"><Trash2 size={13} /></button></div>
                    ))}</div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2"><SelectField label="Model that writes the pairs" value={f.pairModel} onChange={v => set({ pairModel: v })} options={pairOptions} empty="Start Ollama, or add a Gemini key" hint="Offline models need nothing else. Online ones send the text to that service." /></div>
                    {imageSource && <div className="col-span-2"><SelectField label="Reads pictures with" value={f.visionModel} onChange={v => set({ visionModel: v })} options={[{ value: "", label: "Florence-2 (FluxGym's environment)" }, ...pairModels.vision.map(m => ({ value: m, label: m + " (Ollama vision)" }))]} /></div>}
                    <NumberField label="Pairs per chunk" value={f.count} onChange={v => set({ count: v })} min={1} max={20} />
                    <TextField label="Topic hint (optional)" value={f.topic} onChange={v => set({ topic: v })} placeholder="e.g. our refund policy" />
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => run("pairs", "/api/train/pairs/start", { sources, model: f.pairModel, count: f.count, topic: f.topic, visionModel: f.visionModel })} disabled={!sources.length || !f.pairModel || pairs.running} className={btnPrimary}>{pairs.running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}Write pairs from {sources.length || "the"} source{sources.length === 1 ? "" : "s"}</button>
                    {pairs.running && <button onClick={pairs.stop} className={btnDanger}>Stop</button>}
                  </div>
                </Card>

                <Card title="Write examples by hand" icon={<FileText size={15} />} note="Each example is one thing you ask and the answer you want. The box below shows exactly what the trainer will see.">
                  <TextField label="Instruction" value={hand.instruction} onChange={v => setHand({ ...hand, instruction: v })} placeholder="What should the model be asked to do?" />
                  <TextField label="Input (optional)" value={hand.input} onChange={v => setHand({ ...hand, input: v })} placeholder="Extra context the instruction refers to" />
                  <Field label="Expected output"><textarea value={hand.output} onChange={e => setHand({ ...hand, output: e.target.value })} rows={3} placeholder="The answer the model should learn to give" className={inputCls + " resize-none"} /></Field>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-black/30 px-3 py-2 font-mono text-[11px] text-zinc-500">{preview(hand)}</pre>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={addExample} disabled={!hand.instruction.trim() || !hand.output.trim()} className={btnPrimary}><Plus size={14} />Add example</button>
                    <input ref={importRef} type="file" accept=".jsonl,.csv" hidden onChange={e => importFile(e.target.files?.[0])} />
                    <button onClick={() => importRef.current?.click()} className={btn}><Upload size={14} />Import .jsonl / .csv...</button>
                  </div>
                </Card>
              </div>

              <Card title={`Your dataset (${examples.length} example${examples.length === 1 ? "" : "s"})`} icon={<Check size={15} />} note="Fix or delete anything wrong, then save it - the saved file shows up in the Fine-tune step.">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-64"><SelectField label="Open a saved dataset" value="" onChange={v => v && openDataset(v)} options={[{ value: "", label: "Choose..." }, ...datasetOptions]} /></div>
                  <div className="w-64"><TextField label="Save as" value={f.fileName} onChange={v => set({ fileName: v })} placeholder="e.g. my_character_chat" /></div>
                  <button onClick={saveDataset} disabled={!examples.length || !f.fileName.trim()} className={btnPrimary}>Save as .jsonl</button>
                  {examples.length > 0 && <button onClick={() => { if (window.confirm("Remove every example from this list? Saved files are not touched.")) setExamples([]); }} className={btn}><Trash2 size={14} />Clear the list</button>}
                </div>
                {!examples.length ? <p className="text-xs text-zinc-600">No examples yet - write some above, import a file, or build them from your material.</p> : (
                  <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                    {examples.map((e, i) => (
                      <div key={i} className="grid gap-2 rounded-xl border border-white/5 p-2.5 md:grid-cols-[1fr_1.4fr_auto]">
                        <textarea value={e.instruction} onChange={ev => edit(i, { instruction: ev.target.value })} rows={2} className={inputCls + " resize-none text-xs"} />
                        <textarea value={e.output} onChange={ev => edit(i, { output: ev.target.value })} rows={2} className={inputCls + " resize-none text-xs"} />
                        <button onClick={() => setExamples(l => l.filter((_, j) => j !== i))} title="Delete" className="self-start p-2 text-zinc-600 hover:text-rose-400"><Trash2 size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Model and data" icon={<GraduationCap size={15} />}>
                  <SelectField label="Base model (what is fine-tuned)" value={f.baseModelDir} onChange={v => set({ baseModelDir: v })} options={status.llm.baseModels.map(m => ({ value: m.path, label: m.name }))} empty="No base model downloaded yet" hint="A downloaded 4-bit checkpoint. Small ones (3-4B) train comfortably on 8 GB." />
                  <SelectField label="Training dataset" value={f.datasetFile} onChange={v => set({ datasetFile: v })} options={datasetOptions} empty="No saved datasets yet - build one in step 1" />
                  <FolderField label="Save the result to" value={f.outputDir} onChange={v => set({ outputDir: v })} placeholder="defaults to a new folder in outputs" />
                  <div className="rounded-xl border border-white/5 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-500"><Cloud size={12} />Need a base model? (needs internet, once)</p>
                    <div className="flex gap-2">
                      <select value={repo} onChange={e => setRepo(e.target.value)} className={inputCls}>{SUGGESTED.map(s => <option key={s.repo} value={s.repo} className="bg-zinc-900">{s.repo.split("/")[1]}</option>)}</select>
                      <button onClick={() => run("download", "/api/train/llm/download", { repo })} disabled={dl.running || busy} className={btn}>{dl.running ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}Download</button>
                    </div>
                    <p className="mt-1.5 text-[10px] text-zinc-600">{SUGGESTED.find(s => s.repo === repo)?.note}</p>
                  </div>
                </Card>
                <Card title="Settings" icon={<Settings2 size={15} />} note="Defaults suit a 3-4B model on 8 GB. Lower the batch size or sequence length if it runs out of memory.">
                  <div className="grid grid-cols-3 gap-3">
                    <NumberField label="LoRA rank" value={f.rank} onChange={v => set({ rank: v })} min={1} max={256} />
                    <NumberField label="LoRA alpha" value={f.alpha} onChange={v => set({ alpha: v })} min={1} max={256} />
                    <NumberField label="Epochs" value={f.epochs} onChange={v => set({ epochs: v })} min={1} max={100} />
                    <TextField label="Learning rate" value={f.learningRate} onChange={v => set({ learningRate: v })} />
                    <NumberField label="Batch size" value={f.batchSize} onChange={v => set({ batchSize: v })} min={1} max={64} />
                    <NumberField label="Max length" value={f.maxSeqLength} onChange={v => set({ maxSeqLength: v })} min={128} max={16384} step={128} />
                  </div>
                  <CheckBox label="Also export a GGUF for Ollama when it finishes" checked={f.exportGguf} onChange={v => set({ exportGguf: v })} />
                  {f.exportGguf && <TextField label="Ollama model name (optional)" value={f.ollamaName} onChange={v => set({ ollamaName: v })} placeholder="e.g. my-character-chat" hint="If set, it is added to Ollama straight away." />}
                </Card>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => run("llm", "/api/train/llm/start", { baseModelDir: f.baseModelDir, datasetFile: f.datasetFile, outputDir: f.outputDir, rank: f.rank, alpha: f.alpha, epochs: f.epochs, learningRate: f.learningRate, batchSize: f.batchSize, maxSeqLength: f.maxSeqLength, exportGguf: f.exportGguf, ollamaName: f.ollamaName })} disabled={!!trainReason || busy} title={trainReason} className={btnPrimary}>{llm.running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}Start fine-tune</button>
                {llm.running && <button onClick={llm.stop} className={btnDanger}>Stop</button>}
                {trainReason && <span className="text-[11px] text-amber-400">{trainReason}</span>}
                {!trainReason && <span className="text-[11px] text-zinc-500">Ollama's and ComfyUI's models are unloaded first so training has the GPU to itself.</span>}
              </div>

              <Card title="Finished models" icon={<Check size={15} />} note={`In ${status.llm.outputDir}. The adapter is the small trained layer; a GGUF is the whole model, ready for Ollama.`} right={<button onClick={reload} className="text-[11px] text-zinc-500 hover:text-white">Refresh</button>}>
                {!status.llm.outputs.length ? <p className="text-xs text-zinc-600">Nothing trained yet.</p> : (
                  <div className="space-y-2">{status.llm.outputs.map(o => (
                    <div key={o.path} className="rounded-xl border border-white/5 p-3 text-xs">
                      <p className="font-mono text-zinc-300">{o.name}</p>
                      <p className="mt-0.5 text-[10px] text-zinc-600">{o.hasAdapter ? "adapter saved" : "no adapter yet"}{o.gguf.length ? ` - ${o.gguf.length} GGUF` : ""}</p>
                      {o.gguf.map(g => (
                        <div key={g.path} className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-mono text-zinc-400">{g.name} ({fmtBytes(g.bytes)})</span>
                          <input value={regName} onChange={e => setRegName(e.target.value)} placeholder="Ollama name" className={inputCls + " !w-40 !py-1 text-xs"} />
                          <button onClick={() => run("download", "/api/train/llm/register", { gguf: g.path, name: regName })} disabled={!regName.trim() || dl.running} className={btn + " !py-1"}>Add to Ollama</button>
                        </div>
                      ))}
                    </div>
                  ))}</div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>

      {previewText && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-6" onClick={() => setPreviewText(null)}>
          <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-white/15 bg-zinc-950 shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="border-b border-white/10 px-5 py-3 text-xs font-bold text-zinc-300">{previewText.label}</p>
            <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap px-5 py-4 font-mono text-[11px] text-zinc-400">{previewText.text}</pre>
          </div>
        </div>
      )}

      <div className="shrink-0 border-t border-white/5 p-4">
        <div className="mx-auto max-w-6xl">
          <div className="mb-2 flex items-center gap-1.5">{([["pairs", "Pairs"], ["llm", "Fine-tune"], ["download", "Downloads"]] as const).map(([k, l]) => <button key={k} onClick={() => setConsoleKind(k)} className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${consoleKind === k ? "bg-white/10 text-white" : "text-zinc-600 hover:text-zinc-300"}`}>{l}{jobs[k].running ? " ..." : ""}</button>)}</div>
          <div className="h-48"><JobConsole job={jobs[consoleKind]} title={consoleKind === "llm" ? "Fine-tune" : consoleKind === "pairs" ? "Writing pairs" : "Downloads and Ollama"} /></div>
        </div>
      </div>
    </div>
  );
}
