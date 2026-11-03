import React from "react";
import { Check, Cloud, Copy, Database, Download, FileText, Loader2, Play, Settings2, Smartphone, Upload } from "lucide-react";
import { notify, notifyError } from "../../lib/notify";
import { api, fmtBytes, useJob } from "./trainApi";
import { Badge, btn, btnDanger, btnPrimary, Card, type CardInfo, inputCls, JobConsole, NumberField, SelectField, TextField, FileField, TrainProgress } from "./ui";

interface Preset { id: string; label: string; suggest: string[]; quant: string; maxLength: number; note: string }
interface MobileStatus {
  ready: { python: boolean; converter: boolean };
  presets: Preset[]; quants: { id: string; label: string; bytesPerParam: number }[]; downloads: { repo: string; note: string }[];
  models: { name: string; path: string; paramsM: number | null }[];
  datasets: { name: string; path: string; bytes: number; rows: number }[];
  outputs: { name: string; path: string; run: { params_m: number; method: string; examples: number; tested: number; exact: number; gguf: { mb: number; quant: string } | null } | null; gguf: { name: string; path: string; bytes: number }[] }[];
  outputRoot: string;
}
interface DataCheck { rows: number; usable: number; skipped: number; longestChars: number; avgChars: number; problems: string[] }

const KEY = "cursed.mobiletrain";
interface Form {
  preset: string; baseModelDir: string; trainFile: string; testFile: string; method: "auto" | "full" | "lora"; epochs: number; learningRate: string;
  batchSize: number; gradAccum: number; maxLength: number; evalPercent: number; match: "first_line" | "full"; rank: number; maxSteps: number; quant: string; name: string; dlRepo: string;
}
const DEFAULTS: Form = {
  preset: "budget", baseModelDir: "", trainFile: "", testFile: "", method: "auto", epochs: 3, learningRate: "1e-4", batchSize: 4, gradAccum: 1, maxLength: 512,
  evalPercent: 10, match: "first_line", rank: 32, maxSteps: 0, quant: "q8_0", name: "", dlRepo: "HuggingFaceTB/SmolLM2-135M-Instruct",
};
const load = (): Form => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEFAULTS; } };

const INFO: Record<string, CardInfo> = {
  phone: {
    job: "Pick the kind of phone the model has to run on. This suggests a model size, a sequence length and a file format that fit.",
    why: "A phone has far less memory than your PC, and the model file must fit next to Android and your app. Choose for the weakest phone you will support: a model that fits a budget phone also runs on a flagship, not the other way round.",
    settings: [
      ["Phone class", "Budget (3-4 GB RAM), mid-range (6-8 GB) or flagship (12 GB or more). It only sets suggestions; every value below can still be changed."],
      ["Size estimate", "About the size of the finished phone file, from the model's parameter count and the chosen format."],
    ],
  },
  model: {
    job: "Chooses the small model that is trained, and downloads one if you have none.",
    why: "Smaller models are faster and use less battery but hold less; for a narrow job such as turning a sentence into a command, a 135M to 500M model is often enough. Always test on the real phone.",
    settings: [
      ["Base model", "A model folder in the training folder. The ones suggested for your phone class are marked."],
      ["Need a model?", "Downloads one from Hugging Face. It needs internet once; the file is shared with the PC side of this page."],
    ],
  },
  data: {
    job: "Chooses the training examples and an optional separate test file, and checks them.",
    why: "The model only learns what these examples show, and it is scored on rows it never trained on. Examples should be in exactly the form the phone app sends, including the system prompt, because the model learns that exact layout.",
    settings: [
      ["Training file", "A .jsonl with one example per line: {\"messages\":[system, user, assistant]}. The last message must be the reply to learn. instruction/output rows also work."],
      ["Test file (optional)", "A separate .jsonl used only for scoring. If empty, part of the training file is held back instead."],
      ["Check", "Counts the usable rows and points out lines that cannot be trained on."],
    ],
  },
  settings: {
    job: "Sets how the small model learns.",
    why: "For tiny models every weight is trained, which works better than a LoRA add-on and fits easily. For models above about 700M parameters the page switches to LoRA automatically, because training every weight would not fit on an 8 GB card.",
    settings: [
      ["Method", "Auto picks full training for small models and LoRA for bigger ones. Full or LoRA forces a choice."],
      ["Epochs", "Passes over the data. 3 is a good start; raise it if the held-out score is still climbing."],
      ["Learning rate", "1e-4 suits full training of a small model; LoRA tolerates larger values such as 2e-4."],
      ["Batch size and accumulation", "Examples at once, and rounds combined per step. Lower the batch size if memory runs out."],
      ["Max length", "Examples longer than this many tokens are left out. Your phone engine's context is 4096 tokens, so keep prompt plus reply well under that."],
      ["Held-out %", "Share of the training file kept back for scoring (only when there is no test file)."],
      ["Score by", "First line compares only the first line of the reply (right for one-line replies); whole reply compares everything."],
      ["Stop after N steps", "For a quick test of the whole chain. Leave at 0 for a real run."],
    ],
  },
  export: {
    job: "Makes the GGUF file the phone app loads, and names this run.",
    why: "The format is a trade between size and quality. Tiny models lose more quality when compressed hard, so q8_0 (about half the size of f16 with almost no loss) is the safe choice for them.",
    settings: [
      ["Format", "f16 is the largest and best; q8_0 is about half the size; q4_k_m is smallest but costs the most accuracy on tiny models."],
      ["Run name", "The folder and file name. Leave empty for a name from the model and the time."],
    ],
  },
  done: {
    job: "Lists the phone models you have trained, with their held-out score and the GGUF file to copy to the phone.",
    why: "Each run keeps its own folder, so you can compare versions before copying one to the phone.",
    settings: [["Copy path", "Copies the file's full path. Copy the file to the phone, then add it from phone storage in the app's Phone settings."]],
  },
};

/** Train a small model for a phone app: chat-format data, full fine-tune of tiny models, GGUF out. */
export function MobileTrainView() {
  const [st, setSt] = React.useState<MobileStatus | null>(null);
  const reload = React.useCallback(async () => { try { setSt(await api<MobileStatus>("/api/mobile/status")); } catch { /* server restarting */ } }, []);
  React.useEffect(() => { reload(); const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload]);
  const [f, setF] = React.useState<Form>(load);
  const set = (patch: Partial<Form>) => setF(prev => { const n = { ...prev, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* storage blocked */ } return n; });
  const mobile = useJob("mobile"), dl = useJob("download");
  const [consoleKind, setConsoleKind] = React.useState<"mobile" | "download">("mobile");
  const [check, setCheck] = React.useState<DataCheck | null>(null);
  const [busy, setBusy] = React.useState(false);

  const guard = async (fn: () => Promise<any>) => { try { return await fn(); } catch (e: any) { notifyError(e?.message || String(e), "finetune"); } };
  const preset = st?.presets.find(p => p.id === f.preset) || st?.presets[0];
  const isSuggested = (name: string) => !!preset?.suggest.some(s => name.toLowerCase().includes(s.toLowerCase()));
  const model = st?.models.find(m => m.path === f.baseModelDir);

  // First visit: choose a model that suits the phone class, and the first dataset.
  React.useEffect(() => {
    if (!st) return;
    if (!f.baseModelDir && st.models.length) set({ baseModelDir: (st.models.find(m => isSuggested(m.name)) || st.models[0]).path });
    if (!f.trainFile && st.datasets[0]) set({ trainFile: st.datasets[0].path });
  }, [st?.models.length, st?.datasets.length]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (!mobile.running && mobile.state) reload(); }, [mobile.running]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (!dl.running && dl.state) reload(); }, [dl.running]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { setCheck(null); }, [f.trainFile]);

  const pickPreset = (id: string) => { const p = st?.presets.find(x => x.id === id); if (p) set({ preset: id, quant: p.quant, maxLength: p.maxLength, baseModelDir: st!.models.find(m => p.suggest.some(s => m.name.toLowerCase().includes(s.toLowerCase())))?.path || f.baseModelDir }); };
  const runCheck = () => guard(async () => { setBusy(true); try { setCheck(await api<DataCheck>("/api/mobile/dataset/check", { path: f.trainFile })); } finally { setBusy(false); } });
  const start = () => guard(async () => { setConsoleKind("mobile"); await api("/api/mobile/start", { baseModelDir: f.baseModelDir, trainFile: f.trainFile, testFile: f.testFile, method: f.method, epochs: f.epochs, learningRate: f.learningRate, batchSize: f.batchSize, gradAccum: f.gradAccum, maxLength: f.maxLength, evalPercent: f.evalPercent, match: f.match, rank: f.rank, maxSteps: f.maxSteps, quant: f.quant, name: f.name }); reload(); });
  const download = () => guard(async () => { setConsoleKind("download"); await api("/api/train/llm/download", { repo: f.dlRepo }); reload(); });
  const copy = (text: string) => { navigator.clipboard?.writeText(text).then(() => notify({ message: "Path copied", tab: "finetune" })).catch(() => notifyError("Could not copy; select the path and copy it by hand.", "finetune")); };

  const reason = !st?.ready.python ? "The Python environment was not found." : !f.baseModelDir ? "Choose or download a base model." : !f.trainFile ? "Choose the training file." : f.quant !== "none" && !st.ready.converter ? "The GGUF converter is not installed yet (export one model on the PC side first), or choose no export." : "";
  const sizeMB = model?.paramsM && f.quant !== "none" ? Math.round(model.paramsM * (st?.quants.find(q => q.id === f.quant)?.bytesPerParam ?? 2)) : null;

  if (!st) return <div className="glass flex h-full flex-1 items-center justify-center rounded-[2.5rem] text-sm text-zinc-500"><Loader2 size={16} className="mr-2 animate-spin" />Loading...</div>;

  return (
    <div className="glass flex h-full flex-1 flex-col overflow-hidden rounded-[2.5rem]">
      <div className="flex h-20 shrink-0 items-center justify-between gap-4 border-b border-white/5 px-8">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5"><Smartphone size={22} className="text-violet-400" /></div>
          <div className="min-w-0"><h1 className="text-lg font-bold leading-none tracking-tight text-white">Train a model for a phone</h1><p className="mt-1 truncate text-[11px] text-zinc-500">A small chat model, trained in full, exported as a GGUF the phone app loads</p></div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Badge ok={st.ready.python} title="The training Python environment">Trainer {st.ready.python ? "ready" : "missing"}</Badge>
          <Badge ok={st.ready.converter} title="llama.cpp's GGUF converter, installed by the first PC-side export">GGUF tools {st.ready.converter ? "ready" : "missing"}</Badge>
        </div>
      </div>

      <TrainProgress jobs={[{ title: "Phone model", job: mobile }, { title: "Download", job: dl }]} />

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Target phone" info={INFO.phone} icon={<Smartphone size={15} />} note={preset?.note}>
              <SelectField label="Phone class" value={f.preset} onChange={pickPreset} options={st.presets.map(p => ({ value: p.id, label: p.label }))} hint="Choose for the weakest phone you support." />
              <p className="text-[11px] text-zinc-500">Suggested models: {preset?.suggest.join(", ")}. Suggested format: {preset?.quant}. {sizeMB ? `Estimated phone file: about ${sizeMB} MB.` : model && !model.paramsM ? "" : ""}</p>
            </Card>
            <Card title="Base model" info={INFO.model} icon={<Database size={15} />}>
              <SelectField label="Model to train" value={f.baseModelDir} onChange={v => set({ baseModelDir: v })} options={st.models.map(m => ({ value: m.path, label: `${m.name}${m.paramsM ? ` (${m.paramsM >= 1000 ? (m.paramsM / 1000).toFixed(1) + "B" : m.paramsM + "M"})` : ""}${isSuggested(m.name) ? " - suggested" : ""}` }))} empty="No model downloaded yet" />
              <div className="rounded-xl border border-white/5 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-500"><Cloud size={12} />Need a small model? (needs internet, once)</p>
                <div className="flex gap-2">
                  <select value={f.dlRepo} onChange={e => set({ dlRepo: e.target.value })} className={inputCls}>{st.downloads.map(d => <option key={d.repo} value={d.repo} className="bg-zinc-900">{d.repo.split("/")[1]}</option>)}</select>
                  <button onClick={download} disabled={dl.running} className={btn}>{dl.running ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}Download</button>
                </div>
                <p className="mt-1.5 text-[10px] text-zinc-600">{st.downloads.find(d => d.repo === f.dlRepo)?.note}</p>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Training data" info={INFO.data} icon={<FileText size={15} />} note="Chat-format rows in exactly the layout the phone app sends, ending with the reply to learn.">
              <SelectField label="Files in the training folder" value={st.datasets.find(d => d.path === f.trainFile)?.path || ""} onChange={v => set({ trainFile: v })} options={st.datasets.map(d => ({ value: d.path, label: `${d.name} (${d.rows} rows)` }))} empty="No .jsonl files there yet" />
              <FileField label="Training file (or paste any path)" value={f.trainFile} onChange={v => set({ trainFile: v })} placeholder="C:\\path\\to\\train.jsonl" />
              <FileField label="Test file (optional)" value={f.testFile} onChange={v => set({ testFile: v })} placeholder="C:\\path\\to\\test.jsonl" hint="Leave empty to keep part of the training file back for testing." />
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={runCheck} disabled={!f.trainFile || busy} className={btn}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}Check the file</button>
                {check && <span className="text-[11px] text-zinc-400">{check.usable} of {check.rows} rows usable; average {check.avgChars} characters, longest {check.longestChars}</span>}
              </div>
              {check?.problems.length ? <ul className="space-y-0.5 text-[11px] text-amber-400">{check.problems.map(p => <li key={p}>{p}</li>)}</ul> : null}
            </Card>
            <Card title="Training settings" info={INFO.settings} icon={<Settings2 size={15} />} note="Defaults suit a model of a few hundred million parameters.">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-3"><SelectField label="Method" value={f.method} onChange={v => set({ method: v as Form["method"] })} options={[{ value: "auto", label: "Auto - full for small models, LoRA for bigger ones" }, { value: "full", label: "Full - train every weight" }, { value: "lora", label: "LoRA - small add-on" }]} /></div>
                <NumberField label="Epochs" value={f.epochs} onChange={v => set({ epochs: v })} min={1} max={50} />
                <TextField label="Learning rate" value={f.learningRate} onChange={v => set({ learningRate: v })} />
                <NumberField label="Max length" value={f.maxLength} onChange={v => set({ maxLength: v })} min={64} max={4096} step={64} />
                <NumberField label="Batch size" value={f.batchSize} onChange={v => set({ batchSize: v })} min={1} max={32} />
                <NumberField label="Accumulation" value={f.gradAccum} onChange={v => set({ gradAccum: v })} min={1} max={32} />
                <NumberField label="Held-out %" value={f.evalPercent} onChange={v => set({ evalPercent: v })} min={0} max={30} />
                <NumberField label="LoRA rank" value={f.rank} onChange={v => set({ rank: v })} min={4} max={128} />
                <NumberField label="Stop after N steps" value={f.maxSteps} onChange={v => set({ maxSteps: v })} min={0} max={100000} hint="0 = full run" />
                <SelectField label="Score by" value={f.match} onChange={v => set({ match: v as Form["match"] })} options={[{ value: "first_line", label: "First line of the reply" }, { value: "full", label: "Whole reply" }]} />
              </div>
            </Card>
          </div>

          <Card title="Export for the phone" info={INFO.export} icon={<Upload size={15} />} note="The GGUF is what the phone app loads. It is saved next to the trained model.">
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField label="Format" value={f.quant} onChange={v => set({ quant: v })} options={[...st.quants.map(q => ({ value: q.id, label: q.label })), { value: "none", label: "No export (just train and test)" }]} hint={sizeMB ? `About ${sizeMB} MB for this model.` : undefined} />
              <TextField label="Run name (optional)" value={f.name} onChange={v => set({ name: v.replace(/[^\w.-]/g, "") })} placeholder="e.g. navyeo-135m-v2" hint="Letters, numbers, dot, dash and underscore." />
            </div>
          </Card>

          <Card title="Phone models you trained" info={INFO.done} icon={<Check size={15} />} note={`In ${st.outputRoot}`} right={<button onClick={reload} className="text-[11px] text-zinc-500 hover:text-white">Refresh</button>}>
            {!st.outputs.length ? <p className="text-xs text-zinc-600">Nothing trained here yet.</p> : (
              <div className="space-y-2">{st.outputs.map(o => (
                <div key={o.path} className="rounded-xl border border-white/5 p-3 text-xs">
                  <p className="font-mono text-zinc-300">{o.name}</p>
                  {o.run && <p className="mt-0.5 text-[10px] text-zinc-500">{o.run.params_m}M parameters - {o.run.method} - {o.run.examples} examples{o.run.tested ? ` - held-out ${o.run.exact}/${o.run.tested} exact (${Math.round(100 * o.run.exact / o.run.tested)}%)` : ""}</p>}
                  {o.gguf.map(g => (
                    <div key={g.path} className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-zinc-400">{g.name} ({fmtBytes(g.bytes)})</span>
                      <button onClick={() => copy(g.path)} className={btn + " !py-1"}><Copy size={12} />Copy path</button>
                    </div>
                  ))}
                  {!o.gguf.length && <p className="mt-1 text-[10px] text-zinc-600">No GGUF in this run.</p>}
                </div>
              ))}</div>
            )}
          </Card>
        </div>
      </div>

      <div className="shrink-0 border-t border-white/5 p-4">
        <div className="mx-auto max-w-6xl">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <button onClick={start} disabled={!!reason || mobile.running} title={reason} className={btnPrimary}>{mobile.running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}Start phone training</button>
            {mobile.running && <button onClick={() => { fetch("/api/mobile/stop", { method: "POST" }).catch(() => {}); }} className={btnDanger}>Stop</button>}
            {reason ? <span className="text-[11px] text-amber-400">{reason}</span> : <span className="text-[11px] text-zinc-500">Close other GPU programs first (Ollama models, ComfyUI) if memory is tight.</span>}
          </div>
          <div className="mb-2 flex items-center gap-1.5">{([["mobile", "Phone training"], ["download", "Downloads"]] as const).map(([k, l]) => <button key={k} onClick={() => setConsoleKind(k)} className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${consoleKind === k ? "bg-white/10 text-white" : "text-zinc-600 hover:text-zinc-300"}`}>{l}{(k === "mobile" ? mobile : dl).running ? " ..." : ""}</button>)}</div>
          <div className="h-48"><JobConsole job={consoleKind === "mobile" ? mobile : dl} title={consoleKind === "mobile" ? "Phone model training" : "Downloads"} /></div>
        </div>
      </div>
    </div>
  );
}
