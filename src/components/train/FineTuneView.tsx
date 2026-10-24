import React from "react";
import { ArrowRight, BookOpen, Check, Cloud, Download, FileText, GraduationCap, Globe, ImagePlus, Link2, Loader2, Play, Plus, RefreshCw, Settings2, Sparkles, Trash2, Upload } from "lucide-react";
import { notify, notifyError } from "../../lib/notify";
import { api, fmtBytes, useJob, useTrainStatus } from "./trainApi";
import { GuideButton, FineTuneGuide } from "./Guide";
import { Badge, btn, btnDanger, btnPrimary, Card, type CardInfo, Check as CheckBox, Field, FolderField, inputCls, JobConsole, NumberField, SelectField, Tabs, TextField, TrainProgress } from "./ui";

/** The text behind the (i) button of each card: the job of the step, why it matters, and what its settings do. */
const INFO: Record<string, CardInfo> = {
  material: {
    job: "Turns your documents, web pages and pictures into question-and-answer training pairs, so you do not write them by hand.",
    why: "A fine-tuned model only knows what the pairs say. This step is where its knowledge comes from, so clear source text and a careful review of the pairs decide how good the model is.",
    settings: [
      ["Model that writes the pairs", "Reads each passage and writes the pairs. A bigger or online model writes better pairs; online ones send your text to that service."],
      ["Reads pictures with", "Turns a picture into text first, so it can become pairs."],
      ["Pairs per chunk", "How many pairs are written from each passage of about 3,000 characters. 3 to 6 is a good range; higher numbers start repeating themselves."],
      ["Topic hint", "Keeps the writer on one subject, so side material in the document produces fewer pairs."],
    ],
  },
  hand: {
    job: "Lets you add exact examples yourself, or import a .jsonl, .json or .csv file made elsewhere (for example in ChatGPT).",
    why: "Hand-written pairs are the most reliable. Use them for facts that must be exactly right, such as names, numbers and signals, and to add the same fact in several wordings.",
    settings: [
      ["Instruction", "The question or request the model will be given."],
      ["Input (optional)", "Extra context the instruction refers to. Leave empty for plain questions."],
      ["Expected output", "The answer you want the model to give. Training copies this."],
    ],
  },
  dataset: {
    job: "Lists every training example so you can fix, delete, redo or add to them, then saves them as one .jsonl file.",
    why: "Training reads only this saved file. A wrong pair teaches the model something wrong, so delete or correct bad rows before you save.",
    settings: [
      ["Open a saved dataset", "Loads an earlier file back into the list to keep working on it."],
      ["Save as", "The file name. Saved files appear in the Fine-tune step."],
      ["Redo / Add buttons on a row", "Redo writes that pair again from the same passage; Add writes a different pair from it. Only pairs written from your material have them."],
    ],
  },
  model: {
    job: "Chooses what to train (the base model), what to train it on (the dataset) and where the result goes.",
    why: "The base model sets how much the model already knows, which languages it handles and how big it is. For a GGUF export it must be the full-precision version; training loads it in 4-bit by itself.",
    settings: [
      ["Base model", "The downloaded model that is improved. Small ones (0.5 to 4 billion parameters) train quickly on an 8 GB card."],
      ["Training dataset", "The saved .jsonl file from step 1."],
      ["Save the result to", "A folder for the adapter and GGUF. Leave empty for a new folder in outputs."],
      ["Need a base model?", "Downloads one from Hugging Face. It needs internet once; afterwards everything runs offline."],
    ],
  },
  settings: {
    job: "Sets how strongly and for how long the model learns from the examples.",
    why: "Too little training and the model barely changes; too much and it repeats the examples word for word and forgets how to answer anything else.",
    settings: [
      ["LoRA rank", "How much the model can learn. 8 to 16 is light; 32 to 64 holds many facts but uses more memory."],
      ["LoRA alpha", "How strongly the learned part counts. Usually the same number as the rank."],
      ["Epochs", "How many times the model reads the whole dataset. 3 is typical; small datasets often need 5 to 8."],
      ["Learning rate", "The size of each learning step. 2e-4 is a safe default; lower it if answers get worse or the loss jumps around."],
      ["Batch size", "Examples handled at once. Lower it if you run out of memory."],
      ["Max length", "The longest example, in tokens. Lower it to save memory if your examples are short."],
      ["Export a GGUF", "Makes a single file Ollama can run. It adds several minutes, needs the full-precision base model and about twice the model size in free disk."],
      ["Ollama model name", "If set, the model is added to Ollama as soon as the export finishes."],
    ],
  },
  finished: {
    job: "Shows the trained results: the adapter (the small learned layer) and any GGUF files, and adds a GGUF to Ollama.",
    why: "An adapter alone cannot be chatted with in Ollama. Only a GGUF added to Ollama appears in your model list.",
    settings: [
      ["Add to Ollama", "Registers the GGUF under the name you type. Use a new name for each version so older ones stay available."],
    ],
  },
};

type Tab = "dataset" | "train";
/** source = which material it came from; ctx = the passage it was written from (kept so one row can be redone). Neither is saved into the .jsonl. */
interface Example { instruction: string; input: string; output: string; source?: string; ctx?: string }
interface Source { type: "pdf" | "docx" | "image" | "url" | "text"; value: string; label: string }

const KEY = "cursed.finetune";
const LIST_KEY = "cursed.finetune.work";
/** The sources and the unsaved pairs survive a refresh. */
const loadWork = (): { sources: Source[]; examples: Example[] } => { try { const w = JSON.parse(localStorage.getItem(LIST_KEY) || "{}"); return { sources: Array.isArray(w.sources) ? w.sources : [], examples: Array.isArray(w.examples) ? w.examples : [] }; } catch { return { sources: [], examples: [] }; } };
interface Form {
  baseModelDir: string; datasetFile: string; outputDir: string; rank: number; alpha: number; epochs: number; learningRate: string; batchSize: number; maxSeqLength: number; exportGguf: boolean; ollamaName: string;
  pairModel: string; visionModel: string; count: number; topic: string; fileName: string;
}
const DEFAULTS: Form = { baseModelDir: "", datasetFile: "", outputDir: "", rank: 16, alpha: 16, epochs: 3, learningRate: "2e-4", batchSize: 2, maxSeqLength: 2048, exportGguf: true, ollamaName: "", pairModel: "", visionModel: "", count: 5, topic: "", fileName: "" };
const load = (): Form => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEFAULTS; } };

/** Full-precision base models: training loads them in 4-bit itself (fits a small card), and the same files are what the GGUF export needs, so one download does both. Downloaded once, then everything runs offline. */
const SUGGESTED = [
  { repo: "unsloth/Phi-3.5-mini-instruct", note: "3.8B, about 7.6 GB download - the safest fit for 8 GB cards" },
  { repo: "unsloth/Llama-3.2-3B-Instruct", note: "3B, about 6.4 GB download" },
  { repo: "unsloth/Qwen2.5-3B-Instruct", note: "3B, about 6.2 GB download, good in many languages" },
  { repo: "unsloth/gemma-2-2b-it", note: "2B, about 5.2 GB download, the lightest" },
];

/** Same text train.py builds from an example, so there is no guessing what the model sees. */
const preview = (e: Partial<Example>) => {
  const inp = (e.input || "").trim();
  return `### Instruction:\n${(e.instruction || "").trim()}\n${inp ? `\n### Input:\n${inp}\n` : ""}\n### Response:\n${(e.output || "").trim()}`;
};

/** One row from another tool's dataset: instruction/input/output, prompt/completion, question/answer, or a chat "messages" list (system text becomes the input). */
function toExample(e: any): Example | null {
  const s = (v: any) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
  let instruction = s(e?.instruction ?? e?.prompt ?? e?.question ?? e?.query ?? e?.human);
  let input = s(e?.input ?? e?.context);
  let output = s(e?.output ?? e?.response ?? e?.completion ?? e?.answer ?? e?.assistant);
  if (Array.isArray(e?.messages)) {
    const m = e.messages as { role?: string; content?: any }[];
    instruction = s(m.find(x => x.role === "user")?.content);
    output = s(m.find(x => x.role === "assistant")?.content);
    input = s(m.find(x => x.role === "system")?.content);
  }
  return instruction && output ? { instruction, input, output } : null;
}
/** .jsonl (one object per line) or .json (a list) in any of the shapes above. */
function parseJsonRows(text: string): Example[] {
  const t = text.trim();
  const rows: any[] = t.startsWith("[") ? JSON.parse(t) : t.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
  return rows.map(toExample).filter((x): x is Example => !!x);
}

function parseCsv(text: string): Example[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const head = lines[0]?.split(",").map(h => h.trim().toLowerCase()) || [];
  const [i, n, o] = [head.indexOf("instruction"), head.indexOf("input"), head.indexOf("output")];
  if (i < 0 || o < 0) throw new Error('The CSV needs "instruction" and "output" columns.');
  return lines.slice(1).map(l => { const c = l.split(","); return { instruction: (c[i] || "").trim(), input: (c[n] || "").trim(), output: (c[o] || "").trim() }; }).filter(e => e.instruction && e.output);
}

/** Fine-tune a language model on your own examples (Unsloth QLoRA), then send it to Ollama. */
export function FineTuneView() {
  const [guide, setGuide] = React.useState(false);
  const [status, reload] = useTrainStatus();
  const [tab, setTab] = React.useState<Tab>("dataset");
  const [f, setF] = React.useState<Form>(load);
  const set = (patch: Partial<Form>) => setF(prev => { const n = { ...prev, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* storage blocked */ } return n; });
  const [sources, setSources] = React.useState<Source[]>(() => loadWork().sources);
  const [examples, setExamples] = React.useState<Example[]>(() => loadWork().examples);
  const [busyRow, setBusyRow] = React.useState<number | null>(null);
  React.useEffect(() => { try { localStorage.setItem(LIST_KEY, JSON.stringify({ sources, examples })); } catch { /* storage full or blocked: the work just will not survive a refresh */ } }, [sources, examples]);
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
      const rows: Example[] = file.name.toLowerCase().endsWith(".csv") ? parseCsv(text) : parseJsonRows(text);
      if (!rows.length) throw new Error("No usable examples found. Each row needs an instruction (or prompt / question) and an output (or response / answer).");
      setExamples(prev => [...prev, ...rows]);
      notify({ message: `Imported ${rows.length} examples`, tab: "finetune" });
    });
    if (importRef.current) importRef.current.value = "";
  };
  const openDataset = (p: string) => guard(async () => { const r = await api<{ examples: Example[] }>("/api/train/llm/dataset/load", { path: p }); setExamples(r.examples); set({ fileName: p.split(/[\\/]/).pop()!.replace(/\.jsonl$/i, "") }); });
  const saveDataset = () => guard(async () => { const r = await api<{ file: string; count: number }>("/api/train/llm/dataset/save", { fileName: f.fileName, examples }); set({ datasetFile: r.file }); notify({ message: `Saved ${r.count} examples - ready to train on`, tab: "finetune" }); reload(); });
  const edit = (i: number, patch: Partial<Example>) => setExamples(l => l.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  /** Ask the pair model for a new pair from the same passage as row i: replace the row ("redo") or put it underneath ("more"). */
  const another = (i: number, mode: "redo" | "more") => guard(async () => {
    const row = examples[i];
    setBusyRow(i);
    try {
      const sameCtx = examples.filter(e => e.ctx === row.ctx).map(e => e.instruction);
      const r = await api<{ example: Example }>("/api/train/pairs/one", { model: f.pairModel, ctx: row.ctx, source: row.source, topic: f.topic, avoid: sameCtx });
      setExamples(l => mode === "redo" ? l.map((e, j) => (j === i ? r.example : e)) : [...l.slice(0, i + 1), r.example, ...l.slice(i + 1)]);
    } finally { setBusyRow(null); }
  });

  const sourceIcon = (t: Source["type"]) => t === "image" ? <ImagePlus size={14} /> : t === "url" ? <Globe size={14} /> : <FileText size={14} />;
  const pairOptions = [...pairModels.ollama.map(m => ({ value: "ollama::" + m, label: m + (/cloud/.test(m) ? " (online)" : " (offline)") })), ...(pairModels.gemini ? [{ value: "gemini::gemini-2.5-flash", label: "Gemini 2.5 Flash (online)" }, { value: "gemini::gemini-2.5-pro", label: "Gemini 2.5 Pro (online)" }] : [])];
  const imageSource = sources.some(s => s.type === "image");
  const trainReason = !status?.llm.ready ? "The fine-tuning environment was not found (see Setup)." : !f.baseModelDir ? "Choose a base model (or download one)." : !f.datasetFile ? "Choose or save a dataset." : "";
  const busy = pairs.running || llm.running || dl.running;
  const datasetOptions = status?.llm.datasets.map(d => ({ value: d.path, label: `${d.name} (${d.examples} examples)` })) || [];

  if (!status) return <div className="glass flex h-full flex-1 items-center justify-center rounded-[2.5rem] text-sm text-zinc-500"><Loader2 size={16} className="mr-2 animate-spin" />Loading...</div>;

  return (
    <div className="glass flex h-full flex-1 flex-col overflow-hidden rounded-[2.5rem]">
      {guide && <FineTuneGuide onClose={() => setGuide(false)} />}
      <div className="flex h-20 shrink-0 items-center justify-between gap-4 border-b border-white/5 px-8">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5"><GraduationCap size={22} className="text-violet-400" /></div>
          <div className="min-w-0"><h1 className="text-lg font-bold leading-none tracking-tight text-white">FineTune LLM</h1><p className="mt-1 truncate text-[11px] text-zinc-500">Teach a small model your own material, then use it in Ollama</p></div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <GuideButton onClick={() => setGuide(true)} />
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "dataset", label: "1  Dataset", busy: pairs.running }, { id: "train", label: "2  Fine-tune", busy: llm.running }]} />
          <Badge ok={status.llm.ready} title={status.llm.ready ? "Unsloth environment found" : "Not found at " + status.paths.llmPython}>{status.llm.ready ? "Unsloth ready" : "Unsloth missing"}</Badge>
          <Badge ok={status.ollama.running} title="Writes the pairs, and receives the finished model">Ollama {status.ollama.running ? "on" : "off"}</Badge>
          <button onClick={() => setSetupOpen(v => !v)} title="Folders" className={`p-2 transition-colors ${setupOpen ? "text-violet-400" : "text-zinc-500 hover:text-white"}`}><Settings2 size={18} /></button>
        </div>
      </div>

      <TrainProgress jobs={[{ title: "Fine-tune", job: llm }, { title: "Writing pairs", job: pairs }, { title: "Download", job: dl }]} />

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
                <Card title="Build from your material" info={INFO.material} icon={<BookOpen size={15} />} note="Add PDFs, Word files, pictures, web pages or text. A model reads each one and writes question-and-answer pairs from what is really in it; answers that only describe the source are thrown away.">
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

                <Card title="Write examples by hand" info={INFO.hand} icon={<FileText size={15} />} note="Each example is one thing you ask and the answer you want. The box below shows exactly what the trainer will see.">
                  <TextField label="Instruction" value={hand.instruction} onChange={v => setHand({ ...hand, instruction: v })} placeholder="What should the model be asked to do?" />
                  <TextField label="Input (optional)" value={hand.input} onChange={v => setHand({ ...hand, input: v })} placeholder="Extra context the instruction refers to" />
                  <Field label="Expected output"><textarea value={hand.output} onChange={e => setHand({ ...hand, output: e.target.value })} rows={3} placeholder="The answer the model should learn to give" className={inputCls + " resize-none"} /></Field>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-black/30 px-3 py-2 font-mono text-[11px] text-zinc-500">{preview(hand)}</pre>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={addExample} disabled={!hand.instruction.trim() || !hand.output.trim()} className={btnPrimary}><Plus size={14} />Add example</button>
                    <input ref={importRef} type="file" accept=".jsonl,.json,.csv" hidden onChange={e => importFile(e.target.files?.[0])} />
                    <button onClick={() => importRef.current?.click()} className={btn}><Upload size={14} />Import .jsonl / .json / .csv...</button>
                  </div>
                </Card>
              </div>

              <Card title={`Your dataset (${examples.length} example${examples.length === 1 ? "" : "s"})`} info={INFO.dataset} icon={<Check size={15} />} note="Fix or delete anything wrong, then save it - the saved file shows up in the Fine-tune step.">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-64"><SelectField label="Open a saved dataset" value="" onChange={v => v && openDataset(v)} options={[{ value: "", label: "Choose..." }, ...datasetOptions]} /></div>
                  <div className="w-64"><TextField label="Save as" value={f.fileName} onChange={v => set({ fileName: v })} placeholder="e.g. my_character_chat" /></div>
                  <button onClick={saveDataset} disabled={!examples.length || !f.fileName.trim()} className={btnPrimary}>Save as .jsonl</button>
                  {examples.length > 0 && <button onClick={() => { if (window.confirm("Remove every example from this list? Saved files are not touched.")) setExamples([]); }} className={btn}><Trash2 size={14} />Clear the list</button>}
                </div>
                {!examples.length ? <p className="text-xs text-zinc-600">No examples yet - write some above, import a file, or build them from your material.</p> : (
                  <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                    {examples.map((e, i) => (
                      <div key={i} className="rounded-xl border border-white/5 p-2.5">
                        <div className="grid gap-2 md:grid-cols-[1fr_1fr_1.4fr_auto]">
                          <textarea value={e.instruction} onChange={ev => edit(i, { instruction: ev.target.value })} rows={2} placeholder="Instruction" className={inputCls + " resize-none text-xs"} />
                          <textarea value={e.input} onChange={ev => edit(i, { input: ev.target.value })} rows={2} placeholder="Input (optional)" className={inputCls + " resize-none text-xs"} />
                          <textarea value={e.output} onChange={ev => edit(i, { output: ev.target.value })} rows={2} placeholder="Output" className={inputCls + " resize-none text-xs"} />
                          <div className="flex flex-col items-center">
                            {busyRow === i ? <Loader2 size={14} className="m-2 animate-spin text-zinc-500" /> : <>
                              <button onClick={() => another(i, "redo")} disabled={!e.ctx || !f.pairModel || busyRow !== null} title={e.ctx ? "Write this pair again from the same passage" : "Only pairs written from material can be redone"} className="p-1.5 text-zinc-600 hover:text-white disabled:opacity-30"><RefreshCw size={14} /></button>
                              <button onClick={() => another(i, "more")} disabled={!e.ctx || !f.pairModel || busyRow !== null} title={e.ctx ? "Add another, different pair from the same passage" : "Only pairs written from material can be extended"} className="p-1.5 text-zinc-600 hover:text-white disabled:opacity-30"><Plus size={14} /></button>
                            </>}
                            <button onClick={() => setExamples(l => l.filter((_, j) => j !== i))} title="Delete" className="p-1.5 text-zinc-600 hover:text-rose-400"><Trash2 size={14} /></button>
                          </div>
                        </div>
                        <p className="mt-1 truncate text-[10px] text-zinc-600">{e.source ? `From: ${e.source}` : "Written or imported by hand"}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Model and data" info={INFO.model} icon={<GraduationCap size={15} />}>
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
                <Card title="Settings" info={INFO.settings} icon={<Settings2 size={15} />} note="Defaults suit a 3-4B model on 8 GB. Lower the batch size or sequence length if it runs out of memory.">
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

              <Card title="Finished models" info={INFO.finished} icon={<Check size={15} />} note={`In ${status.llm.outputDir}. The adapter is the small trained layer; a GGUF is the whole model, ready for Ollama.`} right={<button onClick={reload} className="text-[11px] text-zinc-500 hover:text-white">Refresh</button>}>
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
          {tab === "dataset" && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <button onClick={() => setTab("train")} className={btnPrimary}>Next: Fine-tune<ArrowRight size={14} /></button>
              <span className="text-[11px] text-zinc-500">When the examples look right, go to the Fine-tune tab and press Start.</span>
            </div>
          )}
          {tab === "train" && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button onClick={() => run("llm", "/api/train/llm/start", { baseModelDir: f.baseModelDir, datasetFile: f.datasetFile, outputDir: f.outputDir, rank: f.rank, alpha: f.alpha, epochs: f.epochs, learningRate: f.learningRate, batchSize: f.batchSize, maxSeqLength: f.maxSeqLength, exportGguf: f.exportGguf, ollamaName: f.ollamaName })} disabled={!!trainReason || busy} title={trainReason} className={btnPrimary}>{llm.running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}Start fine-tune</button>
          {llm.running && <button onClick={llm.stop} className={btnDanger}>Stop</button>}
          {trainReason && <span className="text-[11px] text-amber-400">{trainReason}</span>}
          {!trainReason && <span className="text-[11px] text-zinc-500">Ollama's and ComfyUI's models are unloaded first so training has the GPU to itself.</span>}
        </div>
          )}
          <div className="mb-2 flex items-center gap-1.5">{([["pairs", "Pairs"], ["llm", "Fine-tune"], ["download", "Downloads"]] as const).map(([k, l]) => <button key={k} onClick={() => setConsoleKind(k)} className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${consoleKind === k ? "bg-white/10 text-white" : "text-zinc-600 hover:text-zinc-300"}`}>{l}{jobs[k].running ? " ..." : ""}</button>)}</div>
          <div className="h-48"><JobConsole job={jobs[consoleKind]} title={consoleKind === "llm" ? "Fine-tune" : consoleKind === "pairs" ? "Writing pairs" : "Downloads and Ollama"} /></div>
        </div>
      </div>
    </div>
  );
}
