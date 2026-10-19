import React from "react";
import { Download, FolderOpen, RotateCcw, Trash2, Upload } from "lucide-react";
import { AppSettings, Chat } from "../../types";
import { notify, notifyError } from "../../lib/notify";

const heading = "text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] border-b border-white/5 pb-3";
const card = "glass p-6 rounded-[2rem] border-white/5";

function Row({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0"><p className="text-zinc-100 font-bold tracking-tight text-sm">{title}</p>{note && <p className="text-xs text-zinc-500 leading-snug mt-0.5">{note}</p>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
function Switch2({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button onClick={() => onChange(!on)} role="switch" aria-checked={on} className={`relative w-11 h-6 rounded-full transition-colors ${on ? "bg-violet-600" : "bg-white/10"}`}><span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${on ? "left-6" : "left-1"}`} /></button>;
}
function Slide({ label, value, min, max, step, onChange, display, note }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: string; note: string }) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex justify-between items-center mb-3"><p className="text-zinc-100 font-bold text-sm tracking-tight">{label}</p><span className="text-violet-400 font-mono text-xs bg-violet-400/10 px-2 py-1 rounded-md">{display}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full accent-violet-500" />
      <p className="text-xs text-zinc-500 leading-snug mt-2">{note}</p>
    </div>
  );
}
const fmtBytes = (n: number) => (n > 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n > 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** More of Settings: advanced sampling, chat behaviour, notifications and motion, and the data the app keeps. */
export function MoreSettings({ settings, setSettings, chats, onImportChats, onClearChats }: { settings: AppSettings; setSettings: (s: AppSettings) => void; chats: Chat[]; onImportChats: (c: Chat[]) => number; onClearChats: () => void }) {
  const set = (patch: Partial<AppSettings>) => setSettings({ ...settings, ...patch });
  const [data, setData] = React.useState<{ dir: string; items: { name: string; file: string; bytes: number; files?: number }[] } | null>(null);
  const importRef = React.useRef<HTMLInputElement>(null);
  const [perm, setPerm] = React.useState<string>(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  React.useEffect(() => { fetch("/api/app/data-info").then(r => r.json()).then(setData).catch(() => {}); }, [chats.length]);

  const desktop = async (on: boolean) => {
    if (on && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      setPerm(p);
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
      const data = JSON.parse(await file.text());
      const list: Chat[] = (Array.isArray(data) ? data : data?.chats || []).filter((c: any) => c && typeof c.id === "string" && Array.isArray(c.messages));
      if (!list.length) throw new Error("That file has no chats in it.");
      const added = onImportChats(list);
      notify({ message: `Imported ${added} chat${added === 1 ? "" : "s"}`, tab: "settings" });
    } catch (e: any) { notifyError(e.message || "Could not read that file", "settings"); }
    finally { if (importRef.current) importRef.current.value = ""; }
  };

  return (
    <>
      <section className="space-y-6">
        <h3 className={heading}>Advanced sampling</h3>
        <div className={`${card} divide-y divide-white/5`}>
          <Slide label="Top K" value={settings.topK} min={0} max={100} step={1} onChange={v => set({ topK: v })} display={settings.topK ? String(settings.topK) : "Off"} note="Only the K most likely next words are considered. Lower is more predictable. 0 turns it off." />
          <Slide label="Min P" value={settings.minP} min={0} max={0.5} step={0.01} onChange={v => set({ minP: Math.round(v * 100) / 100 })} display={settings.minP ? settings.minP.toFixed(2) : "Off"} note="Drops words that are far less likely than the best one. A modern alternative to Top P; 0.05 is a good value." />
          <Slide label="Repeat penalty" value={settings.repeatPenalty} min={1} max={2} step={0.05} onChange={v => set({ repeatPenalty: Math.round(v * 100) / 100 })} display={settings.repeatPenalty > 1 ? settings.repeatPenalty.toFixed(2) : "Off"} note="Discourages loops and repeated phrases. 1.1 is gentle; above 1.3 answers get odd." />
          <div className="py-4 last:pb-0">
            <Row title="Seed" note="Fixed makes the same question give the same answer (best with a low temperature).">
              <div className="flex items-center gap-2">
                {(["random", "fixed"] as const).map(m => <button key={m} onClick={() => set({ seedMode: m })} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${settings.seedMode === m ? "bg-violet-600 text-white" : "bg-white/5 text-zinc-500 hover:bg-white/10"}`}>{m}</button>)}
                {settings.seedMode === "fixed" && <input type="number" min={0} value={settings.seed} onChange={e => set({ seed: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className="w-24 bg-white/5 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none" />}
              </div>
            </Row>
          </div>
          <div className="pt-4"><button onClick={() => set({ topK: 40, minP: 0.05, repeatPenalty: 1.1, seedMode: "random", seed: 42, temperature: 0.7, topP: 0.9, maxTokens: 1024 })} className="flex items-center gap-2 text-[11px] font-bold text-zinc-500 hover:text-white"><RotateCcw size={13} /> Reset all generation settings</button></div>
        </div>
      </section>

      <section className="space-y-6">
        <h3 className={heading}>Chat</h3>
        <div className={`${card} divide-y divide-white/5`}>
          <div className="pb-4">
            <p className="text-zinc-100 font-bold text-sm tracking-tight">Default system prompt</p>
            <p className="text-xs text-zinc-500 mt-0.5 mb-3">Given to every new chat (a chat can still change its own from its menu). Leave empty for none.</p>
            <textarea value={settings.defaultSystemPrompt} onChange={e => set({ defaultSystemPrompt: e.target.value })} rows={3} placeholder="You are a concise, friendly assistant. Answer in the user's language." className="w-full bg-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500 placeholder:text-zinc-700 resize-y" />
          </div>
          <div className="pt-4">
            <Row title="Enter sends the message" note={settings.enterToSend ? "Shift+Enter starts a new line." : "Off: Ctrl+Enter sends and Enter starts a new line."}><Switch2 on={settings.enterToSend} onChange={v => set({ enterToSend: v })} /></Row>
            <Row title="Read replies aloud automatically" note="Uses the voice and speed chosen under Voice."><Switch2 on={settings.autoSpeak} onChange={v => set({ autoSpeak: v })} /></Row>
            <Row title="Ask before deleting a chat"><Switch2 on={settings.confirmDelete} onChange={v => set({ confirmDelete: v })} /></Row>
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <h3 className={heading}>Notifications & motion</h3>
        <div className={`${card} divide-y divide-white/5`}>
          <Row title="Popups" note="A small message when an image, video or reply is ready. Errors and warnings always show."><Switch2 on={settings.popups} onChange={v => set({ popups: v })} /></Row>
          <div className="pt-3.5"><Row title="Windows notifications" note={perm === "denied" ? "Blocked for this window - allow notifications for it in Windows settings." : perm === "unsupported" ? "Not supported here." : "Also notify when the window is in the background."}><Switch2 on={settings.desktopNotify && perm === "granted"} onChange={desktop} /></Row></div>
          <div className="pt-3.5"><Row title="Reduce motion" note="Turns off animations and transitions everywhere."><Switch2 on={settings.reduceMotion} onChange={v => set({ reduceMotion: v })} /></Row></div>
        </div>
      </section>

      <section className="space-y-6">
        <h3 className={heading}>Data & storage</h3>
        <div className={card}>
          {data && (
            <div className="mb-5 space-y-2">
              {data.items.map(i => <div key={i.file} className="flex justify-between text-[13px]"><span className="text-zinc-400">{i.name}{i.files !== undefined ? ` (${i.files} file${i.files === 1 ? "" : "s"})` : ""}</span><span className="text-zinc-200 font-mono">{fmtBytes(i.bytes)}</span></div>)}
              <p className="text-[11px] text-zinc-600 break-all pt-1">{data.dir}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => fetch("/api/app/open-data", { method: "POST" })} className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold"><FolderOpen size={14} /> Open data folder</button>
            <button onClick={exportChats} disabled={!chats.length} className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold disabled:opacity-40"><Download size={14} /> Export chats</button>
            <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={e => importChats(e.target.files?.[0])} />
            <button onClick={() => importRef.current?.click()} className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold"><Upload size={14} /> Import chats</button>
            <button onClick={() => { if (chats.length && window.confirm(`Delete all ${chats.length} chats? This can't be undone. (Export them first if you might want them back.)`)) onClearChats(); }} disabled={!chats.length} className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/5 hover:bg-red-500/15 text-zinc-300 hover:text-red-300 text-xs font-bold disabled:opacity-40"><Trash2 size={14} /> Delete all chats</button>
          </div>
        </div>
      </section>
    </>
  );
}
