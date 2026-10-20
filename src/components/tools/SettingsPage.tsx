import React from "react";
import { Bell, Bot, Cloud, Cpu, Download, FolderOpen, HardDrive, Image as ImageIcon, Info, Keyboard, Mic, Palette, Plug, RotateCcw, Search, Settings as SettingsIcon, Shield, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";
import { AppSettings, Chat } from "../../types";
import { AIService } from "../../services/aiService";
import { notify, notifyError } from "../../lib/notify";
import { MicTest } from "./MicTest";
import { VoiceSpeechSettings } from "./VoiceSpeechSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { ThemeSettings } from "./ThemeSettings";
import { GoogleConnectPanel, useGoogleStatus } from "../comfy/google";
import { nativeFolder, postJson, api } from "../comfy/types";

const CATEGORIES = [
  { id: "general", label: "General", icon: SettingsIcon },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "chat", label: "Chat & memory", icon: Bot },
  { id: "generation", label: "Generation", icon: SlidersHorizontal },
  { id: "voice", label: "Voice", icon: Mic },
  { id: "studio", label: "Image & video", icon: ImageIcon },
  { id: "models", label: "Models & compute", icon: Cpu },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "privacy", label: "Privacy & data", icon: Shield },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "about", label: "About & reset", icon: Info },
] as const;
type CatId = typeof CATEGORIES[number]["id"];

const fmtBytes = (n: number) => (n > 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n > 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const fmtUptime = (s: number) => (s > 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : s > 60 ? `${Math.floor(s / 60)} min` : `${s} s`);

/* ───────── building blocks ───────── */
function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] border-b border-white/5 pb-3 mb-1">{title}</h3>
      {note && <p className="text-xs text-zinc-600 mt-3 leading-relaxed">{note}</p>}
      <div className="glass rounded-[1.75rem] border-white/5 px-6 py-2 mt-4 divide-y divide-white/5">{children}</div>
    </section>
  );
}
function Row({ title, note, children, stack }: { title: string; note?: React.ReactNode; children: React.ReactNode; stack?: boolean }) {
  return (
    <div className={`py-4 ${stack ? "" : "flex items-center justify-between gap-6"}`}>
      <div className={`min-w-0 ${stack ? "mb-3" : ""}`}><p className="text-zinc-100 font-bold tracking-tight text-sm">{title}</p>{note && <p className="text-xs text-zinc-500 leading-snug mt-0.5">{note}</p>}</div>
      <div className={stack ? "" : "shrink-0"}>{children}</div>
    </div>
  );
}
function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <button disabled={disabled} onClick={() => onChange(!on)} role="switch" aria-checked={on} className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-violet-600" : "bg-white/10"}`}><span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${on ? "left-6" : "left-1"}`} /></button>;
}
function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return <div className="flex flex-wrap gap-1.5 justify-end">{options.map(o => <button key={String(o.value)} onClick={() => onChange(o.value)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${value === o.value ? "bg-violet-600 text-white" : "bg-white/5 text-zinc-500 hover:bg-white/10"}`}>{o.label}</button>)}</div>;
}
function Range({ value, min, max, step, onChange, display }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: string }) {
  return <div className="flex items-center gap-3 min-w-[16rem]"><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="flex-1 accent-violet-500" /><span className="text-violet-400 font-mono text-xs bg-violet-400/10 px-2 py-1 rounded-md min-w-[4.5rem] text-center">{display}</span></div>;
}
const btn = "flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold disabled:opacity-40 transition-colors";
const inputCls = "w-full bg-white/5 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500 placeholder:text-zinc-700";

interface Props { settings: AppSettings; setSettings: (s: AppSettings) => void; chats: Chat[]; onImportChats: (c: Chat[]) => number; onClearChats: () => void; modelsSection: React.ReactNode; onResetSettings: () => void }

export function SettingsPage({ settings, setSettings, chats, onImportChats, onClearChats, modelsSection, onResetSettings }: Props) {
  const set = (patch: Partial<AppSettings>) => setSettings({ ...settings, ...patch });
  const [cat, setCat] = React.useState<CatId>("general");
  const [query, setQuery] = React.useState("");
  const [stats, setStats] = React.useState<any>(null);
  const [data, setData] = React.useState<any>(null);
  const [about, setAbout] = React.useState<any>(null);
  const [perm, setPerm] = React.useState<string>(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const [google, reloadGoogle] = useGoogleStatus();
  const [gemini, setGemini] = React.useState<{ set: boolean; source: string | null } | null>(null);
  const [geminiKey, setGeminiKey] = React.useState("");
  const [dest, setDest] = React.useState<{ image: string; video: string; imageDefault: string; videoDefault: string }>({ image: "", video: "", imageDefault: "", videoDefault: "" });
  const importRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const load = async () => { const d = await AIService.getStats(); if (d) setStats(d); };
    load(); const t = setInterval(load, 5000); return () => clearInterval(t);
  }, []);
  React.useEffect(() => { fetch("/api/app/data-info").then(r => r.json()).then(setData).catch(() => {}); }, [chats.length]);
  React.useEffect(() => { fetch("/api/app/about").then(r => r.json()).then(setAbout).catch(() => {}); fetch("/api/gemini-key").then(r => r.json()).then(setGemini).catch(() => {}); }, []);
  const loadDest = React.useCallback(async () => {
    try {
      const [i, v] = await Promise.all([api<any>("/api/tool/state?kind=image"), api<any>("/api/tool/state?kind=video")]);
      setDest({ image: i.destination || "", video: v.destination || "", imageDefault: i.defaultDestination || "", videoDefault: v.defaultDestination || "" });
    } catch { /* tool state unavailable */ }
  }, []);
  React.useEffect(() => { loadDest(); }, [loadDest]);

  const updateEngineConfig = (patch: { threads?: number; kvCacheSize?: number }) => fetch("/api/engine-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).catch(() => {});
  const desktop = async (on: boolean) => {
    if (on && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const p = await Notification.requestPermission(); setPerm(p);
      if (p !== "granted") { notifyError("Windows notifications were not allowed for this window.", "settings"); return; }
    }
    set({ desktopNotify: on });
  };
  const exportChats = () => {
    const blob = new Blob([JSON.stringify(chats, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `cursed-chats-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const importChats = async (file?: File) => {
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      const list: Chat[] = (Array.isArray(d) ? d : d?.chats || []).filter((c: any) => c && typeof c.id === "string" && Array.isArray(c.messages));
      if (!list.length) throw new Error("That file has no chats in it.");
      const added = onImportChats(list);
      notify({ message: `Imported ${added} chat${added === 1 ? "" : "s"}`, tab: "settings" });
    } catch (e: any) { notifyError(e.message || "Could not read that file", "settings"); }
    finally { if (importRef.current) importRef.current.value = ""; }
  };
  const pickDest = async (kind: "image" | "video") => {
    const p = await nativeFolder(dest[kind] || dest[`${kind}Default` as "imageDefault"]);
    if (typeof p === "string") { await postJson("/api/tool/state", { kind, destination: p }); loadDest(); notify({ message: `${kind === "image" ? "Images" : "Videos"} now save to ${p}`, tab: "settings" }); }
  };
  const resetDest = async (kind: "image" | "video") => { await postJson("/api/tool/state", { kind, destination: "" }); loadDest(); };
  const saveGemini = async () => {
    try { const r = await fetch("/api/gemini-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: geminiKey }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setGemini(d); setGeminiKey(""); notify({ message: "Gemini key saved", tab: "settings" }); } catch (e: any) { notifyError(e.message, "settings"); }
  };
  const removeGemini = async () => { setGemini(await (await fetch("/api/gemini-key", { method: "DELETE" })).json()); };
  const confirmAnd = async (msg: string, fn: () => Promise<any>, done: string) => { if (!window.confirm(msg)) return; try { await fn(); notify({ message: done, tab: "settings" }); } catch (e: any) { notifyError(e.message || "Failed", "settings"); } };

  /* ───────── the sections ───────── */
  const sections: { id: string; cat: CatId; title: string; keywords: string; node: React.ReactNode }[] = [
    { id: "start", cat: "general", title: "Startup", keywords: "start page tab launch open sidebar collapsed status bar cpu ram", node: (
      <Group title="Startup & layout">
        <Row title="Page that opens at launch" note="Where you land when the app starts."><select value={settings.startTab} onChange={e => set({ startTab: e.target.value })} className="bg-white/5 rounded-lg px-3 py-2 text-xs text-white focus:outline-none">{[["chat", "Chat"], ["vision", "Vision"], ["image", "Image"], ["video", "Video"], ["models", "Models"], ["memory", "Memory"], ["engine", "Engine"]].map(([v, l]) => <option key={v} value={v} className="bg-zinc-900">{l}</option>)}</select></Row>
        <Row title="Start with the sidebar collapsed" note="Only icons show until you expand it."><Switch on={settings.sidebarCollapsed} onChange={v => set({ sidebarCollapsed: v })} /></Row>
        <Row title="Show the live status bar" note="The CPU, RAM, GPU, VRAM and temperature pills at the top right."><Switch on={settings.showStatusBar} onChange={v => set({ showStatusBar: v })} /></Row>
      </Group>) },
    { id: "bridge", cat: "general", title: "Network", keywords: "api bridge localhost network address gemini cloud", node: (
      <Group title="Local API & network" note="The app serves everything from this PC. Other devices on your network can reach it at the address below.">
        <Row title="Local inference bridge" note="Use the local server instead of Gemini cloud calls for chat."><Switch on={settings.apiEnabled} onChange={v => { set({ apiEnabled: v }); AIService.setMode(v); }} /></Row>
        <Row title="Reachable at" note="Open this from a phone or another PC on the same network."><span className="text-emerald-300 font-mono text-xs">{stats?.localAddress || `http://localhost:${settings.apiPort}/api/*`}</span></Row>
      </Group>) },

    { id: "ui", cat: "appearance", title: "Interface", keywords: "interface size font text motion animation theme themes colour color dark light global module", node: (
      <>
        <ThemeSettings settings={settings} set={set} />
        <AppearanceSettings />
        <Group title="Font & motion">
          <Row title="Font" note="Changes the typeface everywhere."><Seg value={settings.uiFont} onChange={v => set({ uiFont: v })} options={[{ value: "default", label: "Default" }, { value: "serif", label: "Serif" }, { value: "mono", label: "Mono" }]} /></Row>
          <Row title="Reduce motion" note="Turns off animations and transitions everywhere."><Switch on={settings.reduceMotion} onChange={v => set({ reduceMotion: v })} /></Row>
        </Group>
      </>) },

    { id: "chatbehaviour", cat: "chat", title: "Chat behaviour", keywords: "enter send shift ctrl system prompt read aloud speak delete confirm history limit messages", node: (
      <>
        <Group title="Writing & sending">
          <Row title="Default system prompt" note="Given to every NEW chat; a chat can still change its own from its menu." stack>
            <textarea value={settings.defaultSystemPrompt} onChange={e => set({ defaultSystemPrompt: e.target.value })} rows={3} placeholder="You are a concise, friendly assistant. Answer in the user's language." className={`${inputCls} resize-y`} />
          </Row>
          <Row title="Enter sends the message" note={settings.enterToSend ? "Shift+Enter starts a new line." : "Off: Ctrl+Enter sends and Enter starts a new line."}><Switch on={settings.enterToSend} onChange={v => set({ enterToSend: v })} /></Row>
          <Row title="Read replies aloud" note="Speaks every finished reply with the voice chosen under Voice."><Switch on={settings.autoSpeak} onChange={v => set({ autoSpeak: v })} /></Row>
          <Row title="Ask before deleting a chat"><Switch on={settings.confirmDelete} onChange={v => set({ confirmDelete: v })} /></Row>
        </Group>
        <Group title="What the model sees" note="Sending fewer past messages makes replies faster and keeps small models focused; the system prompt always goes along.">
          <Row title="Messages sent as history" note={settings.historyLimit ? `Only the latest ${settings.historyLimit} messages are sent.` : "The whole chat is sent."}><Range value={settings.historyLimit} min={0} max={60} step={2} onChange={v => set({ historyLimit: v })} display={settings.historyLimit ? String(settings.historyLimit) : "All"} /></Row>
        </Group>
      </>) },
    { id: "memory", cat: "chat", title: "Memory", keywords: "memory notes rag semantic retrieval", node: (
      <Group title="Semantic memory (notes)">
        <Row title="Use memory notes in replies" note="Relevant notes from the Memory tab are added to the prompt."><Switch on={settings.memoryEnabled} onChange={v => set({ memoryEnabled: v })} /></Row>
        <Row title="Notes added per reply" note="At most this many of the best-matching notes."><Range value={settings.memoryTopK} min={1} max={10} step={1} onChange={v => set({ memoryTopK: v })} display={String(settings.memoryTopK)} /></Row>
      </Group>) },

    { id: "sampling", cat: "generation", title: "Sampling", keywords: "temperature top p top k min p repeat penalty seed max tokens creative random", node: (
      <>
        <Group title="Core">
          <Row title="Temperature" note="Higher = more creative and random."><Range value={settings.temperature} min={0} max={2} step={0.05} onChange={v => set({ temperature: Math.round(v * 100) / 100 })} display={settings.temperature.toFixed(2)} /></Row>
          <Row title="Top P (nucleus sampling)" note="Keep only the most likely words that add up to this share."><Range value={settings.topP} min={0.05} max={1} step={0.01} onChange={v => set({ topP: v })} display={settings.topP.toFixed(2)} /></Row>
          <Row title="Max reply length" note="Limit on the number of tokens in one reply."><Range value={settings.maxTokens} min={64} max={8192} step={64} onChange={v => set({ maxTokens: v })} display={String(settings.maxTokens)} /></Row>
        </Group>
        <Group title="Advanced" note="0 / Off turns a control off. These apply to local models and to Ollama and LM Studio models.">
          <Row title="Top K" note="Only the K most likely next words are considered."><Range value={settings.topK} min={0} max={100} step={1} onChange={v => set({ topK: v })} display={settings.topK ? String(settings.topK) : "Off"} /></Row>
          <Row title="Min P" note="Drops words far less likely than the best one; 0.05 is a good value."><Range value={settings.minP} min={0} max={0.5} step={0.01} onChange={v => set({ minP: Math.round(v * 100) / 100 })} display={settings.minP ? settings.minP.toFixed(2) : "Off"} /></Row>
          <Row title="Repeat penalty" note="Discourages loops; above 1.3 answers get odd."><Range value={settings.repeatPenalty} min={1} max={2} step={0.05} onChange={v => set({ repeatPenalty: Math.round(v * 100) / 100 })} display={settings.repeatPenalty > 1 ? settings.repeatPenalty.toFixed(2) : "Off"} /></Row>
          <Row title="Seed" note="Fixed: the same question gives the same answer (best with low temperature)."><div className="flex items-center gap-2"><Seg value={settings.seedMode} onChange={v => set({ seedMode: v })} options={[{ value: "random", label: "Random" }, { value: "fixed", label: "Fixed" }]} />{settings.seedMode === "fixed" && <input type="number" min={0} value={settings.seed} onChange={e => set({ seed: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className="w-24 bg-white/5 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none" />}</div></Row>
          <div className="py-4"><button onClick={() => set({ temperature: 0.7, topP: 0.9, maxTokens: 1024, topK: 40, minP: 0.05, repeatPenalty: 1.1, seedMode: "random", seed: 42 })} className="flex items-center gap-2 text-[11px] font-bold text-zinc-500 hover:text-white"><RotateCcw size={13} /> Reset generation settings</button></div>
        </Group>
      </>) },

    { id: "voice", cat: "voice", title: "Voice", keywords: "voice microphone whisper speech assistant dictation tts speed", node: (
      <Group title="Voice & microphone">
        <Row title="Voice features" note="Dictation and the Cursed_Pirate assistant."><Switch on={settings.voiceEnabled} onChange={v => set({ voiceEnabled: v })} /></Row>
        <Row title="Let the assistant open the studios" note={'Say "create an image of a red fox", "make a video of waves" or "open the video generator" and Cursed_Pirate opens the studio with your prompt; "generate it" starts it.'}><Switch on={settings.assistantStudio} onChange={v => set({ assistantStudio: v })} /></Row>
        {settings.voiceEnabled && (
          <>
            <Row title="Speech recognition" stack note={settings.voiceEngine === "whisper" ? "Always the local Whisper model: every browser, fully offline (first use downloads ~40 MB)." : settings.voiceEngine === "browser" ? "The browser's built-in recognizer (Chrome / Edge, needs internet); Whisper is the fallback." : "Automatic: the browser's live recognizer when it is available and online, otherwise offline Whisper."}>
              <Seg value={settings.voiceEngine} onChange={v => set({ voiceEngine: v })} options={[{ value: "auto", label: "Auto" }, { value: "browser", label: "Browser" }, { value: "whisper", label: "Offline" }]} />
            </Row>
            <div className="py-2 -mx-6"><MicTest pref={settings.voiceEngine} /></div>
            <div className="py-2 -mx-6"><VoiceSpeechSettings /></div>
          </>
        )}
      </Group>) },

    { id: "studiodefaults", cat: "studio", title: "Studio defaults", keywords: "image video studio local cloud default size duration instances quick", node: (
      <Group title="Defaults for new jobs">
        <Row title="Open with" note="Which side of the Image and Video pages opens first (your last choice there is remembered)."><Seg value={settings.defaultSource} onChange={v => set({ defaultSource: v })} options={[{ value: "local", label: "Local" }, { value: "cloud", label: "Cloud" }]} /></Row>
        <Row title="Runs per Generate" note="How many times each prompt runs (every one with a new seed)."><Range value={settings.defaultInstances} min={1} max={20} step={1} onChange={v => set({ defaultInstances: v })} display={`×${settings.defaultInstances}`} /></Row>
        <Row title="Quick image size" note="Starting picture size for Local → Quick image."><select value={settings.imageSizeIdx} onChange={e => set({ imageSizeIdx: Number(e.target.value) })} className="bg-white/5 rounded-lg px-3 py-2 text-xs text-white focus:outline-none">{["512×512", "768×768", "1024×1024", "1024×576 (wide)"].map((l, i) => <option key={l} value={i} className="bg-zinc-900">{l}</option>)}</select></Row>
        <Row title="Quick video length" note="Starting clip length for Local → Quick video."><Range value={settings.videoSeconds} min={1} max={20} step={1} onChange={v => set({ videoSeconds: v })} display={`${settings.videoSeconds} s`} /></Row>
      </Group>) },
    { id: "studiofolders", cat: "studio", title: "Output folders", keywords: "save folder output images videos destination outputs", node: (
      <Group title="Where results are saved" note="Finished pictures and clips go here (and show up in History).">
        {(["image", "video"] as const).map(k => (
          <Row key={k} title={k === "image" ? "Images" : "Videos"} stack note={<span className="break-all">{dest[k] || `${dest[`${k}Default` as "imageDefault"] || "outputs"} (default)`}</span>}>
            <div className="flex gap-2"><button onClick={() => pickDest(k)} className={btn}><FolderOpen size={14} /> Choose folder</button>{dest[k] && <button onClick={() => resetDest(k)} className={btn}><RotateCcw size={14} /> Use default</button>}</div>
          </Row>
        ))}
      </Group>) },

    { id: "compute", cat: "models", title: "Compute", keywords: "gpu vulkan threads kv cache context engine acceleration resource monitor", node: (
      <>
        {stats && (
          <Group title="Right now">
            <Row title="Engine" note={stats.model?.active ? `Model: ${stats.model.active}` : "No model loaded"}><span className={`text-[10px] font-black uppercase tracking-widest ${stats.model?.status === "busy" ? "text-amber-400" : "text-emerald-400"}`}>{stats.model?.status || "idle"}</span></Row>
            <Row title="App memory (heap)"><span className="text-violet-400 font-mono text-xs">{stats.ram?.heapUsed || "---"}</span></Row>
          </Group>
        )}
        <Group title="Acceleration" note="The full set of engine controls (GPU layers, batch, flash attention, keep-alive) is on the Engine page.">
          <Row title="Vulkan GPU backend" note="Use the graphics chip for the model when one is found."><Switch on={settings.vulkanEnabled} onChange={v => set({ vulkanEnabled: v })} /></Row>
          <Row title="Inference threads" note="Applied on the next reply."><Range value={settings.threads} min={1} max={32} step={1} onChange={v => { set({ threads: v }); updateEngineConfig({ threads: v }); }} display={`${settings.threads} cores`} /></Row>
          <Row title="Context size" note="Applied on the next model load."><Range value={settings.kvCacheSize} min={1024} max={32768} step={1024} onChange={v => { set({ kvCacheSize: v }); updateEngineConfig({ kvCacheSize: v }); }} display={`${settings.kvCacheSize}`} /></Row>
        </Group>
      </>) },
    { id: "modelfolders", cat: "models", title: "Model locations", keywords: "models folder directory download lm studio ollama gguf location storage", node: <div>{modelsSection}</div> },

    { id: "popups", cat: "notifications", title: "Popups", keywords: "popup notification sound chime windows desktop duration", node: (
      <Group title="Popups & sound">
        <Row title="Popups" note="A small message when an image, video or reply is ready. Errors and warnings always show."><Switch on={settings.popups} onChange={v => set({ popups: v })} /></Row>
        <Row title="How long popups stay" note="Success popups only; errors stay longer."><Range value={settings.popupSeconds} min={2} max={15} step={1} onChange={v => set({ popupSeconds: v })} display={`${settings.popupSeconds} s`} /></Row>
        <Row title="Play a sound when work finishes" note="A short chime for finished images, videos and uploads."><Switch on={settings.soundOnDone} onChange={v => set({ soundOnDone: v })} /></Row>
        <Row title="Windows notifications" note={perm === "denied" ? "Blocked for this window - allow notifications for it in Windows settings." : perm === "unsupported" ? "Not supported here." : "Also notify when the window is in the background."}><Switch on={settings.desktopNotify && perm === "granted"} onChange={desktop} /></Row>
      </Group>) },

    { id: "gemini", cat: "integrations", title: "Gemini", keywords: "gemini key api cloud imagen veo google", node: (
      <Group title="Gemini (cloud image & video)" note="Only the Cloud mode of Image and Video uses this key. Chat, voice and local generation never do.">
        <Row title="API key" stack note={gemini?.set ? (gemini.source === "env" ? "A key is set through the GEMINI_API_KEY environment variable." : "A key is saved on this PC (stored in config.json, never sent back to the browser).") : "No key yet - get a free one at aistudio.google.com."}>
          <div className="flex gap-2"><input type="password" value={geminiKey} onChange={e => setGeminiKey(e.target.value)} placeholder={gemini?.set ? "Paste a new key to replace it" : "Paste your key"} autoComplete="off" spellCheck={false} className={`${inputCls} font-mono`} /><button onClick={saveGemini} disabled={!geminiKey.trim()} className={btn}>Save</button>{gemini?.source === "saved" && <button onClick={removeGemini} className={btn}><Trash2 size={14} /></button>}</div>
        </Row>
      </Group>) },
    { id: "gdrive", cat: "integrations", title: "Google Drive", keywords: "google drive sheets docs oauth upload automatically folder connect", node: (
      <Group title="Google Drive & Sheets" note="Read prompts from Drive / Sheets / Docs and save every result to Drive automatically.">
        {!google ? <Row title="Loading..."><span /></Row> : !google.connected ? (
          <div className="py-4"><GoogleConnectPanel status={google} onChange={reloadGoogle} field={inputCls} /></div>
        ) : (
          <>
            <Row title="Connected" note={google.email || "Your Google account"}><button onClick={() => postJson("/api/google/disconnect", {}).then(() => reloadGoogle())} className={btn}>Disconnect</button></Row>
            <Row title="Save every result to Drive" note={google.folder ? `Folder: ${google.folder.name}` : "Folder: Cursed_Ai (created in My Drive)"}><Switch on={google.autosave} onChange={v => postJson("/api/google/settings", { autosave: v }).then(() => reloadGoogle())} /></Row>
            <Row title="Upload folder" note="Pick it with the Drive button in the Image or Video top bar."><span /></Row>
          </>
        )}
      </Group>) },
    { id: "services", cat: "integrations", title: "Services", keywords: "ollama lm studio comfyui address url service", node: (
      <Group title="Other services" note="Ollama and LM Studio are found on their default addresses (11434 and 1234). The ComfyUI address and start-at-launch are on the Engine page.">
        <Row title="Ollama" note="Models appear in the Models tab when it is running."><span className="text-xs text-zinc-500 font-mono">http://127.0.0.1:11434</span></Row>
        <Row title="LM Studio" note="Its local server must be switched on."><span className="text-xs text-zinc-500 font-mono">http://127.0.0.1:1234</span></Row>
      </Group>) },

    { id: "data", cat: "privacy", title: "Data", keywords: "data storage chats export import delete folder size backup", node: (
      <Group title="What the app keeps on this PC">
        {data && data.items.map((i: any) => <Row key={i.file} title={i.name} note={i.files !== undefined ? `${i.files} file${i.files === 1 ? "" : "s"}` : i.file}><span className="text-zinc-200 font-mono text-xs">{fmtBytes(i.bytes)}</span></Row>)}
        {data && <div className="py-3 text-[11px] text-zinc-600 break-all">{data.dir}</div>}
        <div className="py-4 flex flex-wrap gap-2">
          <button onClick={() => fetch("/api/app/open-data", { method: "POST" })} className={btn}><FolderOpen size={14} /> Open data folder</button>
          <button onClick={exportChats} disabled={!chats.length} className={btn}><Download size={14} /> Export chats</button>
          <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={e => importChats(e.target.files?.[0])} />
          <button onClick={() => importRef.current?.click()} className={btn}><Upload size={14} /> Import chats</button>
        </div>
      </Group>) },
    { id: "clear", cat: "privacy", title: "Clear", keywords: "delete clear wipe forget chats memory library recent documents history", node: (
      <Group title="Clear things" note="Each asks first. Pictures and videos on disk are never touched here.">
        <Row title="All chats" note={`${chats.length} saved`}><button disabled={!chats.length} onClick={() => confirmAnd(`Delete all ${chats.length} chats? This can't be undone (export them first if you might want them back).`, async () => onClearChats(), "All chats deleted")} className={btn}><Trash2 size={14} /> Delete</button></Row>
        <Row title="Memory notes" note="The notes in the Memory tab."><button onClick={() => confirmAnd("Delete every memory note? This can't be undone.", () => fetch("/api/memory", { method: "DELETE" }), "Memory notes deleted")} className={btn}><Trash2 size={14} /> Delete</button></Row>
        <Row title="Prompt library" note="Prompts saved with your generated pictures (the files stay)."><button onClick={() => confirmAnd("Remove every prompt from the library? The pictures and videos stay on disk.", () => fetch("/api/prompts", { method: "DELETE" }), "Prompt library cleared")} className={btn}><Trash2 size={14} /> Clear</button></Row>
        <Row title="Recent documents" note="The remembered prompt files and sheets."><button onClick={() => confirmAnd("Forget the recent documents list?", () => fetch("/api/tool/recent-docs", { method: "DELETE" }), "Recent documents forgotten")} className={btn}><Trash2 size={14} /> Forget</button></Row>
      </Group>) },

    { id: "keys", cat: "shortcuts", title: "Shortcuts", keywords: "keyboard shortcuts keys hotkeys ctrl", node: (
      <Group title="Keyboard">
        <Row title="Keyboard shortcuts" note="Turn all of the shortcuts below on or off."><Switch on={settings.shortcuts} onChange={v => set({ shortcuts: v })} /></Row>
        {[["Ctrl + K", "Start a new chat"], ["Ctrl + /", "Jump to the message box"], [settings.enterToSend ? "Enter" : "Ctrl + Enter", "Send the message"], [settings.enterToSend ? "Shift + Enter" : "Enter", "New line in the message box"], ["Esc", "Stop a reply that is being written"], ["Ctrl + Enter", "Generate, in the Image / Video prompt box"]].map(([k, d]) => (
          <div key={d} className="py-3 flex items-center justify-between gap-6"><span className="text-sm text-zinc-300">{d}</span><kbd className="px-2.5 py-1 rounded-lg bg-white/10 text-zinc-200 text-[11px] font-mono border border-white/10">{k}</kbd></div>
        ))}
      </Group>) },

    { id: "about", cat: "about", title: "About", keywords: "about version log node platform uptime desktop app", node: (
      <Group title="About this app">
        <Row title="Cursed_Ai" note="Offline-first local AI studio."><span className="text-zinc-200 font-mono text-xs">{about?.version ? `v${about.version}` : ""}</span></Row>
        {about && <>
          <Row title="Running as"><span className="text-zinc-300 text-xs">{about.desktopApp ? "Desktop app window" : "Browser tab"} · port {about.port}</span></Row>
          <Row title="System"><span className="text-zinc-300 text-xs text-right">{about.platform}<br />Node {about.node}</span></Row>
          <Row title="Server uptime"><span className="text-zinc-300 text-xs">{fmtUptime(about.uptimeSec)}</span></Row>
          <Row title="Log file" note="Everything the server prints goes to app.log."><button disabled={!about.log} onClick={() => fetch("/api/app/open-log", { method: "POST" })} className={btn}><FolderOpen size={14} /> Show</button></Row>
        </>}
      </Group>) },
    { id: "reset", cat: "about", title: "Reset", keywords: "reset defaults restore settings factory", node: (
      <Group title="Reset" note="Puts every setting on this page back to its default. Chats, memory and files are not touched.">
        <Row title="Reset all settings"><button onClick={() => { if (window.confirm("Reset every setting to its default?")) { onResetSettings(); notify({ message: "Settings reset", tab: "settings" }); } }} className={btn}><RotateCcw size={14} /> Reset</button></Row>
      </Group>) },
  ];

  const q = query.trim().toLowerCase();
  const visible = q ? sections.filter(s => (s.title + " " + s.keywords + " " + CATEGORIES.find(c => c.id === s.cat)!.label).toLowerCase().includes(q)) : sections.filter(s => s.cat === cat);

  return (
    <div className="flex-1 bg-transparent p-6 h-full overflow-hidden">
      <div className="max-w-6xl mx-auto h-full flex flex-col">
        <header className="mb-6 mt-4 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-black text-white tracking-tighter flex items-center gap-3"><SettingsIcon className="text-violet-500" size={30} /> Settings</h1>
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-[0.2em] mt-1.5">Everything is saved automatically</p>
          </div>
          <div className="relative w-full sm:w-72"><Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search settings..." className={`${inputCls} !pl-9 !pr-8`} />{query && <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"><X size={14} /></button>}</div>
        </header>

        <div className="flex-1 min-h-0 grid md:grid-cols-[210px_1fr] gap-6">
          <nav className="md:overflow-y-auto flex md:flex-col gap-1 overflow-x-auto pb-2 md:pb-0">
            {CATEGORIES.map(c => (
              <button key={c.id} onClick={() => { setCat(c.id); setQuery(""); }} className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold whitespace-nowrap transition-colors text-left ${!q && cat === c.id ? "bg-violet-600/20 text-violet-300" : "text-zinc-500 hover:text-zinc-200 hover:bg-white/5"}`}><c.icon size={16} className="shrink-0" /> {c.label}</button>
            ))}
          </nav>
          <div className="min-h-0 overflow-y-auto pr-2 pb-16">
            {q && <p className="text-xs text-zinc-500 mb-5">{visible.length ? `${visible.length} result${visible.length === 1 ? "" : "s"} for "${query}"` : `Nothing matches "${query}".`}</p>}
            {visible.map(s => <div key={s.id}>{q && <p className="text-[10px] font-black uppercase tracking-widest text-violet-400/70 mb-2">{CATEGORIES.find(c => c.id === s.cat)!.label}</p>}{s.node}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
