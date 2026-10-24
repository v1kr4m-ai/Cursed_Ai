import React from "react";
import { ArrowRight, AudioLines, Check, Cloud, Download, FileText, FolderOpen, Loader2, Mic, Play, Plus, Settings2, Sparkles, Square, Trash2, Upload, Volume2, Wrench } from "lucide-react";
import { notify, notifyError } from "../../lib/notify";
import { api, useJob } from "./trainApi";
import { Badge, btn, btnDanger, btnPrimary, Card, type CardInfo, Check as CheckBox, Field, FolderField, inputCls, JobConsole, NumberField, SelectField, Tabs, TextField, TrainProgress } from "./ui";

type Mode = "stt" | "tts";
type Step = "clips" | "train" | "try";
interface Lang { code: string; name: string }
interface Dataset { name: string; path: string; clips: number; transcribed: number; voiceReady: boolean }
interface SpeechStatus {
  paths: { root: string; datasets: string; models: string; outputs: string; ttsPython: string };
  ready: { stt: boolean; ffmpeg: boolean; ttsEnv: boolean; xttsModel: boolean };
  langs: Lang[]; whisperModels: { repo: string; note: string }[]; xttsRepo: string;
  sttModels: { name: string; path: string }[]; xttsModel: { name: string; path: string } | null;
  datasets: Dataset[];
  sttOutputs: { name: string; path: string; run: { base: string; language: string; method: string; metric: string; before: number | null; after: number | null; clips: number } | null }[];
  ttsOutputs: { name: string; path: string; reference: string }[];
}
interface Clip { name: string; path: string; text: string }
interface Check { clips: number; withText: number; minutes: number | null; tooShort: number; tooLong: number; unreadable: number }

const KEY = "cursed.trainspeech";
interface Form {
  mode: Mode; step: Step; language: string; datasetDir: string; name: string;
  sttBase: string; method: "lora" | "full"; epochs: number; learningRate: string; batchSize: number; gradAccum: number; rank: number; evalPercent: number; maxSteps: number;
  ttsEpochs: number; ttsBatch: number; ttsAccum: number; ttsLr: string;
  draftModel: string; tryModel: string; tryVoice: string; tryRef: string; sayText: string;
}
const DEFAULTS: Form = {
  mode: "stt", step: "clips", language: "en", datasetDir: "", name: "",
  sttBase: "", method: "lora", epochs: 5, learningRate: "1e-3", batchSize: 8, gradAccum: 2, rank: 32, evalPercent: 10, maxSteps: 0,
  ttsEpochs: 6, ttsBatch: 2, ttsAccum: 8, ttsLr: "5e-6",
  draftModel: "", tryModel: "", tryVoice: "", tryRef: "", sayText: "",
};
const load = (): Form => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEFAULTS; } };

/** The text behind the (i) button of each card. */
const INFO: Record<string, CardInfo> = {
  folder: {
    job: "Picks the folder of recordings (clips) you will train on, and the language they are spoken in.",
    why: "Every speech model learns only from these clips and their written text, so the folder decides what the model will be good at: its language, accent, vocabulary and, for a voice, who it sounds like.",
    settings: [
      ["Existing datasets", "Folders the page made for you. Any other folder on this PC also works."],
      ["Language", "The language the clips are spoken in. To teach Whisper an Indian accent, record Indian speakers and choose English; choose Hindi only for Hindi speech. Chinese is scored by characters, the others by words."],
      ["Check", "Counts the clips, how many have a transcript, and the total length, and flags clips that will be skipped."],
    ],
  },
  add: {
    job: "Adds recordings and their transcripts. A transcript is a text file with the same name as the clip, holding exactly what is said.",
    why: "Wrong transcripts teach the model wrong spellings. Drafts written by Whisper are a good start, but read through and correct them before training.",
    settings: [
      ["Add recordings", "wav, mp3, flac, m4a, ogg, opus, webm or aac files. Short clips of 3 to 15 seconds work best."],
      ["Import transcripts", "Reads a sheet you already have: a Common Voice .tsv, or lines like clip01.wav|the words spoken."],
      ["Write drafts with Whisper", "Listens to every clip that has no transcript and writes a first guess in the chosen language."],
    ],
  },
  clips: {
    job: "Lists every clip so you can listen to it, correct its transcript, or delete it.",
    why: "This is the last check before training. A mistake fixed here is a mistake the model never learns.",
    settings: [["Transcript box", "Edit and click outside the box to save. Right-to-left text such as Arabic is shown the right way round."]],
  },
  sttModel: {
    job: "Chooses the Whisper model to improve and how to train it.",
    why: "A bigger Whisper hears better but needs more memory and time. LoRA trains a small add-on and fits easily; full training changes the whole model and can reach a lower error but needs more memory.",
    settings: [
      ["Base model", "A downloaded Whisper. small is a good balance on an 8 GB card; tiny and base are quick for trying things out."],
      ["Method", "LoRA (light, safe) or Full (all weights; keep to tiny, base or small on 8 GB)."],
      ["Need a model?", "Downloads a Whisper from Hugging Face. It needs internet once."],
      ["Save as", "A name for the result so it does not overwrite an earlier run."],
    ],
  },
  sttSettings: {
    job: "Sets how long and how strongly Whisper learns from the clips.",
    why: "Too little training changes nothing; too much and the model memorises your clips and gets worse on new voices. The page keeps 10 percent of the clips aside and scores the model on them before and after, so you can see which it did.",
    settings: [
      ["Epochs", "Passes over all clips. 3 to 8 is usual; fewer clips need more."],
      ["Learning rate", "Step size. LoRA likes 1e-3; full training needs far smaller, around 1e-5."],
      ["Batch size and accumulation", "Clips handled at once, and how many rounds are combined before each learning step. Lower the batch size if memory runs out."],
      ["LoRA rank", "How much the add-on can learn. 16 to 64 is typical."],
      ["Held back for scoring", "Percent of clips never trained on, used to measure the error rate."],
      ["Stop after N steps", "For a quick test of the whole chain. Leave at 0 for a real run."],
    ],
  },
  ttsTools: {
    job: "Gets the two things voice training needs: its own Python environment (coqui-tts) and the XTTS-v2 base voice model.",
    why: "XTTS-v2 can speak Hindi, Arabic and Chinese and learn a voice from your clips. The separate environment keeps it from disturbing your other tools. Note: XTTS-v2 is licensed for non-commercial use.",
    settings: [
      ["Environment", "Needs Python 3.10, 3.11 or 3.12 and several GB of downloads (PyTorch with CUDA, coqui-tts)."],
      ["XTTS-v2 model", "About 2 GB from Hugging Face, downloaded once."],
    ],
  },
  ttsPrep: {
    job: "Converts the clips to the format voice training reads (22 kHz mono), drops clips under 1 s or over 11 s, and picks a reference clip of the voice.",
    why: "Voice models are fussy: noisy clips, several speakers, or wrong transcripts all end up in the voice. 30 minutes or more of clean, single-speaker speech gives a good result; under 10 minutes is only a rough copy.",
    settings: [["Prepare for voice training", "Makes a _tts folder inside the dataset. Run it again after you change clips."]],
  },
  ttsSettings: {
    job: "Sets how long the voice model learns from the clips.",
    why: "XTTS is already a strong voice model; fine-tuning only adjusts it, so small learning rates and a few epochs are right. Too many epochs make it robotic or unstable.",
    settings: [
      ["Epochs", "Passes over the clips. 4 to 10 is typical."],
      ["Batch size and accumulation", "Clips at once on the GPU, and rounds combined per step. Keep the batch at 1 or 2 on 8 GB."],
      ["Learning rate", "5e-6 is the standard for XTTS fine-tuning."],
    ],
  },
  trained: {
    job: "Lists what you have trained. Use one in the Try it step.",
    why: "Each run is kept in its own folder, so you can compare versions.",
  },
  trySpeech: {
    job: "Records or loads a clip and shows what the chosen Whisper model hears.",
    why: "Run the same recording through the base model and then your trained one to see whether the training helped on your kind of speech.",
    settings: [["Model", "A base Whisper or one you trained. The recording stays loaded, so you can switch model and run it again."]],
  },
  tryVoice: {
    job: "Makes the chosen voice say a sentence.",
    why: "The base XTTS model copies a voice from a short reference clip without any training; a trained voice copies it more faithfully and pronounces your language better.",
    settings: [
      ["Voice", "A voice you trained, or the XTTS-v2 base model."],
      ["Reference clip", "A few seconds of the speaker. A trained voice uses its own."],
    ],
  },
};

function useSpeechStatus(): [SpeechStatus | null, () => Promise<void>] {
  const [s, setS] = React.useState<SpeechStatus | null>(null);
  const load = React.useCallback(async () => { try { setS(await api<SpeechStatus>("/api/speech/status")); } catch { /* server restarting */ } }, []);
  React.useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  return [s, load];
}
const pct = (v: number | null | undefined) => (v == null ? "-" : `${(v * 100).toFixed(1)}%`);

/** Train speech models: Whisper for speech to text, XTTS-v2 for text to speech. Clips and transcripts in, a better model out. */
export function SpeechTrainView() {
  const [status, reload] = useSpeechStatus();
  const [f, setF] = React.useState<Form>(load);
  const set = (patch: Partial<Form>) => setF(prev => { const n = { ...prev, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* storage blocked */ } return n; });
  const stt = useJob("stt"), tts = useJob("tts"), prep = useJob("speechprep"), env = useJob("speechenv");
  const jobs = { stt, tts, speechprep: prep, speechenv: env };
  const [consoleKind, setConsoleKind] = React.useState<keyof typeof jobs>("speechprep");
  const [clips, setClips] = React.useState<Clip[]>([]);
  const [newName, setNewName] = React.useState("");
  const [check, setCheck] = React.useState<Check | null>(null);
  const [repo, setRepo] = React.useState("openai/whisper-small");
  const [busy, setBusy] = React.useState(false);
  const [redo, setRedo] = React.useState(false);
  const [heard, setHeard] = React.useState<{ model: string; text: string } | null>(null);
  const [tryAudio, setTryAudio] = React.useState<{ blob: Blob; name: string } | null>(null);
  const [recording, setRecording] = React.useState<MediaRecorder | null>(null);
  const [saying, setSaying] = React.useState(false);
  const [spoken, setSpoken] = React.useState<string | null>(null);
  const tryUrl = React.useMemo(() => (tryAudio ? URL.createObjectURL(tryAudio.blob) : null), [tryAudio]);
  React.useEffect(() => () => { if (tryUrl) URL.revokeObjectURL(tryUrl); }, [tryUrl]);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const sheetRef = React.useRef<HTMLInputElement>(null);
  const tryRef = React.useRef<HTMLInputElement>(null);

  const guard = async (fn: () => Promise<any>) => { try { return await fn(); } catch (e: any) { notifyError(e?.message || String(e), "trainspeech"); } };
  const start = (kind: keyof typeof jobs, url: string, body: unknown) => guard(async () => { setConsoleKind(kind); await api(url, body); reload(); });
  const lang = status?.langs.find(l => l.code === f.language)?.name || f.language;
  const ds = status?.datasets.find(d => d.path === f.datasetDir);

  // Defaults that depend on what is installed.
  React.useEffect(() => {
    if (!status) return;
    if (!f.datasetDir && status.datasets[0]) set({ datasetDir: status.datasets[0].path });
    if (!f.sttBase && status.sttModels[0]) set({ sttBase: (status.sttModels.find(m => /small/i.test(m.name)) || status.sttModels[0]).path });
    if (!f.draftModel && status.sttModels[0]) set({ draftModel: (status.sttModels.find(m => /small|base/i.test(m.name)) || status.sttModels[0]).path });
  }, [status?.datasets.length, status?.sttModels.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // A finished job changes what exists on disk.
  React.useEffect(() => { if (!stt.running && stt.state) reload(); }, [stt.running]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (!tts.running && tts.state) reload(); }, [tts.running]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (!prep.running && prep.state) { reload(); refreshClips(); } }, [prep.running]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (!env.running && env.state) reload(); }, [env.running]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshClips = React.useCallback(async () => {
    if (!f.datasetDir) { setClips([]); return; }
    try { setClips((await api<{ clips: Clip[] }>(`/api/speech/clips?dir=${encodeURIComponent(f.datasetDir)}`)).clips); } catch { setClips([]); }
  }, [f.datasetDir]);
  React.useEffect(() => { refreshClips(); setCheck(null); }, [refreshClips]);

  const createDataset = () => guard(async () => { const r = await api<{ path: string }>("/api/speech/dataset/create", { name: newName }); set({ datasetDir: r.path }); setNewName(""); reload(); });
  const runCheck = () => guard(async () => { setBusy(true); try { setCheck(await api<Check>("/api/speech/dataset/check", { dir: f.datasetDir })); } finally { setBusy(false); } });
  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    if (!f.datasetDir) { notifyError("Choose or create a dataset folder first.", "trainspeech"); return; }
    setBusy(true);
    try {
      for (const file of Array.from(list)) {
        const res = await fetch(`/api/speech/clips/upload?dir=${encodeURIComponent(f.datasetDir)}&name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Could not add ${file.name}`);
      }
      notify({ message: `Added ${list.length} recording${list.length === 1 ? "" : "s"}`, tab: "trainspeech" });
      refreshClips(); reload();
    } catch (e: any) { notifyError(e.message, "trainspeech"); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const importSheet = (file?: File) => guard(async () => {
    if (!file) return;
    const r = await api<{ written: number; notFound: number; examples: string[] }>("/api/speech/dataset/import-sheet", { dir: f.datasetDir, text: await file.text() });
    notify({ kind: r.notFound ? "warning" : "success", tab: "trainspeech", message: `Transcripts added to ${r.written} clip${r.written === 1 ? "" : "s"}${r.notFound ? `; ${r.notFound} row(s) matched no clip (e.g. ${r.examples[0] || "?"})` : ""}` });
    refreshClips(); reload();
    if (sheetRef.current) sheetRef.current.value = "";
  });
  const saveText = (c: Clip, text: string) => { if (text === c.text) return; guard(async () => { await api("/api/speech/transcript", { path: c.path, text }, "PUT"); setClips(l => l.map(x => (x.path === c.path ? { ...x, text } : x))); reload(); }); };
  const removeClip = (c: Clip) => { if (window.confirm(`Delete ${c.name} (and its transcript)?`)) guard(async () => { await api(`/api/speech/clip?path=${encodeURIComponent(c.path)}`, undefined, "DELETE"); refreshClips(); reload(); }); };

  // ---- try it
  const startRecording = () => guard(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const parts: Blob[] = [];
    rec.ondataavailable = e => parts.push(e.data);
    rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); setTryAudio({ blob: new Blob(parts, { type: rec.mimeType || "audio/webm" }), name: "recording.webm" }); setRecording(null); };
    rec.start();
    setRecording(rec);
  });
  const transcribe = () => guard(async () => {
    if (!tryAudio || !f.tryModel) return;
    setBusy(true); setHeard(null);
    try {
      const res = await fetch(`/api/speech/stt/transcribe?model=${encodeURIComponent(f.tryModel)}&language=${f.language}&name=${encodeURIComponent(tryAudio.name)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: tryAudio.blob });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not transcribe");
      setHeard({ model: tryModels.find(m => m.value === f.tryModel)?.label || f.tryModel, text: d.text || "(nothing heard)" });
    } finally { setBusy(false); }
  });
  const say = () => guard(async () => {
    setSaying(true);
    try {
      const res = await fetch("/api/speech/tts/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelDir: f.tryVoice, reference: f.tryRef || voiceRef(f.tryVoice), text: f.sayText, language: f.language }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not make the speech");
      if (spoken) URL.revokeObjectURL(spoken);
      setSpoken(URL.createObjectURL(await res.blob()));
    } finally { setSaying(false); }
  });
  const voiceRef = (dir: string) => status?.ttsOutputs.find(o => o.path === dir)?.reference || "";

  const sttBaseOptions = (status?.sttModels || []).map(m => ({ value: m.path, label: m.name }));
  const tryModels = [...(status?.sttOutputs || []).map(o => ({ value: o.path, label: `${o.name} (trained)` })), ...sttBaseOptions.map(o => ({ value: o.value, label: `${o.label} (base)` }))];
  const voiceOptions = [...(status?.ttsOutputs || []).map(o => ({ value: o.path, label: `${o.name} (trained)` })), ...(status?.xttsModel ? [{ value: status.xttsModel.path, label: "XTTS-v2 base (copies a reference clip)" }] : [])];
  const langOptions = (status?.langs || []).map(l => ({ value: l.code, label: l.name }));
  const datasetOptions = (status?.datasets || []).map(d => ({ value: d.path, label: `${d.name} (${d.clips} clips, ${d.transcribed} with text)` }));
  const anyBusy = stt.running || tts.running || prep.running || env.running;

  const sttReason = !status?.ready.stt ? "The Python tools were not found (see the badges above)." : !status?.ready.ffmpeg ? "ffmpeg was not found on this PC." : !f.sttBase ? "Download or choose a Whisper model." : !ds || !ds.transcribed ? "The chosen folder has no clips with transcripts." : "";
  const ttsReason = !status?.ready.ttsEnv ? "Set up the voice training environment first." : !status?.ready.xttsModel ? "Download the XTTS-v2 model first." : !ds?.voiceReady ? "Prepare the clips for voice training first." : "";

  if (!status) return <div className="glass flex h-full flex-1 items-center justify-center rounded-[2.5rem] text-sm text-zinc-500"><Loader2 size={16} className="mr-2 animate-spin" />Loading...</div>;

  const clipsCards = (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Clip folder" info={INFO.folder} icon={<FolderOpen size={15} />} note="Recordings with a transcript beside each: clip01.wav and clip01.txt. Everything on this page works on this folder.">
          <SelectField label="Existing datasets" value={ds?.path || ""} onChange={v => set({ datasetDir: v })} options={datasetOptions} empty="No datasets yet" />
          <FolderField label="Or any folder" value={f.datasetDir} onChange={v => set({ datasetDir: v })} placeholder="C:\\path\\to\\recordings" />
          <div className="flex items-end gap-2"><div className="flex-1"><TextField label="New dataset" value={newName} onChange={setNewName} placeholder="e.g. hindi_office" /></div><button onClick={createDataset} disabled={!newName.trim()} className={btn}>Create</button></div>
          <SelectField label="Language spoken in the clips" value={f.language} onChange={v => set({ language: v })} options={langOptions} />
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={runCheck} disabled={!f.datasetDir || busy} className={btn}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}Check the folder</button>
            {check && <span className="text-[11px] text-zinc-400">{check.clips} clips, {check.withText} with text{check.minutes != null ? `, ${check.minutes} min` : ""}{check.tooShort ? `, ${check.tooShort} under 1 s` : ""}{check.tooLong ? `, ${check.tooLong} over 30 s` : ""}{check.unreadable ? `, ${check.unreadable} unreadable` : ""}</span>}
          </div>
        </Card>
        <Card title="Add recordings and transcripts" info={INFO.add} icon={<Upload size={15} />} note="Add your recordings, then give every clip its text: import a sheet, or let Whisper write drafts and correct them below.">
          <input ref={fileRef} type="file" multiple accept="audio/*,.wav,.mp3,.flac,.m4a,.ogg,.opus,.webm,.aac" hidden onChange={e => upload(e.target.files)} />
          <input ref={sheetRef} type="file" accept=".tsv,.csv,.txt" hidden onChange={e => importSheet(e.target.files?.[0])} />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => fileRef.current?.click()} disabled={busy || !f.datasetDir} className={btn}><Upload size={14} />Add recordings...</button>
            <button onClick={() => sheetRef.current?.click()} disabled={!f.datasetDir} className={btn}><FileText size={14} />Import transcripts (.tsv / .txt)...</button>
          </div>
          <SelectField label="Whisper model that writes drafts" value={f.draftModel} onChange={v => set({ draftModel: v })} options={sttBaseOptions} empty="Download a Whisper model in the Train step first" hint="Bigger models write better drafts. They are a first guess - read and correct them." />
          <CheckBox label="Also replace transcripts that already exist" checked={redo} onChange={setRedo} />
          <button onClick={() => start("speechprep", "/api/speech/draft/start", { datasetDir: f.datasetDir, model: f.draftModel, language: f.language, redo })} disabled={!f.datasetDir || !f.draftModel || prep.running || !status.ready.stt} className={btnPrimary + " self-start"}>{prep.running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}Write draft transcripts</button>
        </Card>
      </div>
      <Card title={`Clips and transcripts (${clips.length})`} info={INFO.clips} icon={<AudioLines size={15} />} note="Listen, and correct what is written. The text must be exactly what is said.">
        {!clips.length ? <p className="text-xs text-zinc-600">No clips yet - add recordings above.</p> : (
          <div className="max-h-[30rem] space-y-2 overflow-y-auto pr-1">
            {clips.map(c => (
              <div key={c.path} className="grid items-center gap-3 rounded-xl border border-white/5 p-2.5 md:grid-cols-[16rem_1fr_auto]">
                <div className="min-w-0"><p className="mb-1 truncate font-mono text-[10px] text-zinc-500">{c.name}</p><audio controls preload="none" src={`/api/speech/audio?path=${encodeURIComponent(c.path)}`} className="h-8 w-full" /></div>
                <textarea key={c.path + c.text.length} dir="auto" defaultValue={c.text} onBlur={e => saveText(c, e.target.value)} rows={2} placeholder="What is said in this clip" className={inputCls + " resize-none text-sm"} />
                <button onClick={() => removeClip(c)} title="Delete this clip" className="p-2 text-zinc-600 hover:text-rose-400"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );

  const sttTrain = (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Model and method" info={INFO.sttModel} icon={<Mic size={15} />}>
          <SelectField label="Base model (Whisper)" value={f.sttBase} onChange={v => set({ sttBase: v })} options={sttBaseOptions} empty="No Whisper model downloaded yet" />
          <SelectField label="Language" value={f.language} onChange={v => set({ language: v })} options={langOptions} />
          <SelectField label="Method" value={f.method} onChange={v => set({ method: v as "lora" | "full", learningRate: v === "lora" ? "1e-3" : "1e-5" })} options={[{ value: "lora", label: "LoRA - light, fits any size" }, { value: "full", label: "Full - all weights (tiny, base, small)" }]} />
          <TextField label="Save as (optional)" value={f.name} onChange={v => set({ name: v })} placeholder="e.g. hindi-office-v1" />
          <div className="rounded-xl border border-white/5 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-500"><Cloud size={12} />Need a Whisper model? (needs internet, once)</p>
            <div className="flex gap-2">
              <select value={repo} onChange={e => setRepo(e.target.value)} className={inputCls}>{status.whisperModels.map(m => <option key={m.repo} value={m.repo} className="bg-zinc-900">{m.repo.split("/")[1]}</option>)}</select>
              <button onClick={() => start("speechenv", "/api/speech/download", { repo })} disabled={env.running} className={btn}>{env.running ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}Download</button>
            </div>
            <p className="mt-1.5 text-[10px] text-zinc-600">{status.whisperModels.find(m => m.repo === repo)?.note}</p>
          </div>
        </Card>
        <Card title="Settings" info={INFO.sttSettings} icon={<Settings2 size={15} />} note="Defaults suit a small Whisper on an 8 GB card. The page scores the model on clips it never trained on, before and after.">
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Epochs" value={f.epochs} onChange={v => set({ epochs: v })} min={1} max={100} />
            <TextField label="Learning rate" value={f.learningRate} onChange={v => set({ learningRate: v })} />
            <NumberField label="Batch size" value={f.batchSize} onChange={v => set({ batchSize: v })} min={1} max={32} />
            <NumberField label="Accumulation" value={f.gradAccum} onChange={v => set({ gradAccum: v })} min={1} max={64} />
            <NumberField label="LoRA rank" value={f.rank} onChange={v => set({ rank: v })} min={4} max={128} />
            <NumberField label="Held back %" value={f.evalPercent} onChange={v => set({ evalPercent: v })} min={0} max={30} />
            <NumberField label="Stop after N steps" value={f.maxSteps} onChange={v => set({ maxSteps: v })} min={0} max={100000} hint="0 = full run" />
          </div>
        </Card>
      </div>
      <Card title="Trained speech-to-text models" info={INFO.trained} icon={<Check size={15} />} note={`In ${status.paths.outputs}`} right={<button onClick={reload} className="text-[11px] text-zinc-500 hover:text-white">Refresh</button>}>
        {!status.sttOutputs.length ? <p className="text-xs text-zinc-600">Nothing trained yet.</p> : (
          <div className="space-y-2">{status.sttOutputs.map(o => (
            <div key={o.path} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 p-3 text-xs">
              <span className="font-mono text-zinc-300">{o.name}</span>
              {o.run && <span className="text-[11px] text-zinc-500">{o.run.language} - {o.run.method} - {o.run.clips} clips - {o.run.metric.toUpperCase()} {pct(o.run.before)} to {pct(o.run.after)}</span>}
              <button onClick={() => set({ tryModel: o.path, mode: "stt", step: "try" })} className={btn + " ml-auto !py-1"}>Try it</button>
            </div>
          ))}</div>
        )}
      </Card>
    </>
  );

  const ttsTrain = (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Voice training tools" info={INFO.ttsTools} icon={<Wrench size={15} />} note="Text-to-speech training uses XTTS-v2, which speaks Hindi, Arabic and Chinese. It runs in its own Python environment.">
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-3"><Badge ok={status.ready.ttsEnv}>Environment {status.ready.ttsEnv ? "ready" : "missing"}</Badge>
              {!status.ready.ttsEnv && <button onClick={() => start("speechenv", "/api/speech/env/setup", {})} disabled={env.running} className={btnPrimary}>{env.running ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}Set up (about 4 GB)</button>}</div>
            <div className="flex items-center gap-3"><Badge ok={status.ready.xttsModel}>XTTS-v2 {status.ready.xttsModel ? "downloaded" : "missing"}</Badge>
              {!status.ready.xttsModel && <button onClick={() => start("speechenv", "/api/speech/download", { repo: status.xttsRepo })} disabled={env.running} className={btnPrimary}>{env.running ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}Download (about 2 GB)</button>}</div>
            <p className="text-[10px] text-zinc-600">XTTS-v2 is licensed for non-commercial use (Coqui Public Model License).</p>
          </div>
        </Card>
        <Card title="Prepare the clips" info={INFO.ttsPrep} icon={<AudioLines size={15} />} note="One speaker, clean recordings, each 1 to 11 seconds, with exact transcripts. Aim for 30 minutes or more.">
          <SelectField label="Dataset" value={ds?.path || ""} onChange={v => set({ datasetDir: v })} options={datasetOptions} empty="No datasets yet" />
          <SelectField label="Language" value={f.language} onChange={v => set({ language: v })} options={langOptions} />
          <div className="flex items-center gap-3">
            <button onClick={() => start("speechprep", "/api/speech/tts/prepare", { datasetDir: f.datasetDir })} disabled={!f.datasetDir || prep.running} className={btnPrimary}>{prep.running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}Prepare for voice training</button>
            <Badge ok={ds?.voiceReady ?? false}>{ds?.voiceReady ? "prepared" : "not prepared"}</Badge>
          </div>
        </Card>
      </div>
      <Card title="Settings" info={INFO.ttsSettings} icon={<Settings2 size={15} />}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NumberField label="Epochs" value={f.ttsEpochs} onChange={v => set({ ttsEpochs: v })} min={1} max={100} />
          <NumberField label="Batch size" value={f.ttsBatch} onChange={v => set({ ttsBatch: v })} min={1} max={8} />
          <NumberField label="Accumulation" value={f.ttsAccum} onChange={v => set({ ttsAccum: v })} min={1} max={128} />
          <TextField label="Learning rate" value={f.ttsLr} onChange={v => set({ ttsLr: v })} />
        </div>
        <TextField label="Save the voice as (optional)" value={f.name} onChange={v => set({ name: v })} placeholder="e.g. office-voice-hindi" />
      </Card>
      <Card title="Trained voices" info={INFO.trained} icon={<Check size={15} />} note={`In ${status.paths.outputs}`}>
        {!status.ttsOutputs.length ? <p className="text-xs text-zinc-600">No voice trained yet.</p> : (
          <div className="space-y-2">{status.ttsOutputs.map(o => (
            <div key={o.path} className="flex items-center gap-3 rounded-xl border border-white/5 p-3 text-xs"><span className="font-mono text-zinc-300">{o.name}</span>
              <button onClick={() => set({ tryVoice: o.path, mode: "tts", step: "try" })} className={btn + " ml-auto !py-1"}>Try it</button></div>
          ))}</div>
        )}
      </Card>
    </>
  );

  const sttTry = (
    <Card title="Try speech to text" info={INFO.trySpeech} icon={<Mic size={15} />} note="Record or load a clip, pick a model, and see what it hears. Switch the model and run it again to compare.">
      <input ref={tryRef} type="file" accept="audio/*" hidden onChange={e => { const file = e.target.files?.[0]; if (file) setTryAudio({ blob: file, name: file.name }); }} />
      <div className="flex flex-wrap items-center gap-2">
        {recording ? <button onClick={() => recording.stop()} className={btnDanger}><Square size={12} className="fill-current" />Stop recording</button> : <button onClick={startRecording} className={btn}><Mic size={14} />Record</button>}
        <button onClick={() => tryRef.current?.click()} className={btn}><Upload size={14} />Load a clip...</button>
        {tryAudio && <span className="text-[11px] text-zinc-400">{tryAudio.name}</span>}
      </div>
      {tryUrl && <audio controls src={tryUrl} className="h-9 w-full" />}
      <SelectField label="Model" value={f.tryModel} onChange={v => set({ tryModel: v })} options={tryModels} empty="No model yet" />
      <SelectField label="Language" value={f.language} onChange={v => set({ language: v })} options={langOptions} />
      <button onClick={transcribe} disabled={!tryAudio || !f.tryModel || busy || !status.ready.stt} className={btnPrimary + " self-start"}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}What does it hear?</button>
      {heard && <div className="rounded-xl border border-white/10 bg-black/30 p-3"><p className="mb-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">{heard.model}</p><p dir="auto" className="text-sm text-white">{heard.text}</p></div>}
    </Card>
  );

  const ttsTry = (
    <Card title="Try text to speech" info={INFO.tryVoice} icon={<Volume2 size={15} />} note="Type a sentence in the language you trained and hear the voice say it. The first run loads the model and takes a little while.">
      <SelectField label="Voice" value={f.tryVoice} onChange={v => set({ tryVoice: v, tryRef: "" })} options={voiceOptions} empty="No voice model yet" />
      {!voiceRef(f.tryVoice) && <SelectField label="Reference clip (the voice to copy)" value={f.tryRef} onChange={v => set({ tryRef: v })} options={clips.map(c => ({ value: c.path, label: c.name }))} empty="Choose a dataset with clips in the Clips step" hint="A few seconds of clean speech from the speaker." />}
      <SelectField label="Language" value={f.language} onChange={v => set({ language: v })} options={langOptions} />
      <Field label="Sentence"><textarea dir="auto" value={f.sayText} onChange={e => set({ sayText: e.target.value })} rows={3} placeholder="Type what the voice should say" className={inputCls + " resize-none"} /></Field>
      <button onClick={say} disabled={!f.tryVoice || !f.sayText.trim() || saying || !status.ready.ttsEnv} className={btnPrimary + " self-start"}>{saying ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}Say it</button>
      {spoken && <audio controls autoPlay src={spoken} className="h-9 w-full" />}
    </Card>
  );

  const body = f.step === "clips" ? clipsCards : f.step === "train" ? (f.mode === "stt" ? sttTrain : ttsTrain) : (f.mode === "stt" ? sttTry : ttsTry);
  const trainJob = f.mode === "stt" ? stt : tts;
  const trainReason = f.mode === "stt" ? sttReason : ttsReason;

  return (
    <div className="glass flex h-full flex-1 flex-col overflow-hidden rounded-[2.5rem]">
      <div className="flex h-20 shrink-0 items-center justify-between gap-4 border-b border-white/5 px-8">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5"><AudioLines size={22} className="text-violet-400" /></div>
          <div className="min-w-0"><h1 className="text-lg font-bold leading-none tracking-tight text-white">Train Speech</h1><p className="mt-1 truncate text-[11px] text-zinc-500">Teach Whisper to hear your language, or XTTS to speak in your voice</p></div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Tabs<Mode> value={f.mode} onChange={v => set({ mode: v })} tabs={[{ id: "stt", label: "Speech to text", busy: stt.running }, { id: "tts", label: "Text to speech", busy: tts.running }]} />
          <Badge ok={status.ready.stt} title={status.ready.stt ? "Whisper tools found" : "The Python environment with torch, transformers and peft was not found"}>Whisper {status.ready.stt ? "ready" : "missing"}</Badge>
          <Badge ok={status.ready.ffmpeg} title="Reads every audio format">ffmpeg {status.ready.ffmpeg ? "found" : "missing"}</Badge>
        </div>
      </div>

      <TrainProgress jobs={[{ title: "Speech-to-text training", job: stt }, { title: "Voice training", job: tts }, { title: "Preparing clips", job: prep }, { title: "Setup or download", job: env }]} />

      <div className="flex shrink-0 items-center justify-center border-b border-white/5 px-8 py-2">
        <Tabs<Step> value={f.step} onChange={v => set({ step: v })} tabs={[{ id: "clips", label: "1  Clips", busy: prep.running }, { id: "train", label: "2  Train", busy: trainJob.running || env.running }, { id: "try", label: "3  Try it" }]} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6"><div className="mx-auto max-w-6xl space-y-4">{body}</div></div>

      <div className="shrink-0 border-t border-white/5 p-4">
        <div className="mx-auto max-w-6xl">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            {f.step === "clips" && <><button onClick={() => set({ step: "train" })} className={btnPrimary}>Next: Train<ArrowRight size={14} /></button><span className="text-[11px] text-zinc-500">Language: {lang}. Every clip needs its transcript before training.</span></>}
            {f.step === "train" && <>
              <button onClick={() => f.mode === "stt"
                ? start("stt", "/api/speech/stt/start", { baseModel: f.sttBase, datasetDir: f.datasetDir, language: f.language, method: f.method, epochs: f.epochs, learningRate: f.learningRate, batchSize: f.batchSize, gradAccum: f.gradAccum, rank: f.rank, evalPercent: f.evalPercent, maxSteps: f.maxSteps, name: f.name })
                : start("tts", "/api/speech/tts/start", { modelDir: status.xttsModel?.path, datasetDir: f.datasetDir, language: f.language, epochs: f.ttsEpochs, batchSize: f.ttsBatch, gradAccum: f.ttsAccum, learningRate: f.ttsLr, name: f.name })}
                disabled={!!trainReason || anyBusy} title={trainReason} className={btnPrimary}>{trainJob.running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}{f.mode === "stt" ? "Start training" : "Start voice training"}</button>
              {trainJob.running && <button onClick={trainJob.stop} className={btnDanger}>Stop</button>}
              {trainReason ? <span className="text-[11px] text-amber-400">{trainReason}</span> : <span className="text-[11px] text-zinc-500">Ollama's and ComfyUI's models can use the GPU too; close them if training runs out of memory.</span>}
            </>}
          </div>
          <div className="mb-2 flex items-center gap-1.5">{([["speechprep", "Clips"], ["stt", "Speech to text"], ["tts", "Voice"], ["speechenv", "Setup and downloads"]] as const).map(([k, l]) => <button key={k} onClick={() => setConsoleKind(k)} className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${consoleKind === k ? "bg-white/10 text-white" : "text-zinc-600 hover:text-zinc-300"}`}>{l}{jobs[k].running ? " ..." : ""}</button>)}</div>
          <div className="h-48"><JobConsole job={jobs[consoleKind]} title={consoleKind === "stt" ? "Speech-to-text training" : consoleKind === "tts" ? "Voice training" : consoleKind === "speechenv" ? "Setup and downloads" : "Clip preparation"} /></div>
        </div>
      </div>
    </div>
  );
}
