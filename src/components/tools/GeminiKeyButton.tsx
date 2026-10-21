import React from "react";
import { KeyRound, Check, Loader2, Eye, EyeOff, Trash2 } from "lucide-react";
import { notify, notifyError } from "../../lib/notify";

/**
 * Small key icon for the Cloud mode of Image / Video. Amber when no Gemini key is set; opens a popover to paste one.
 * The key is typed into a password field (shown as dots, with an eye toggle) and is never sent back by the server.
 */
export function GeminiKeyButton({ tab, accent }: { tab: string; accent: "pink" | "orange" }) {
  const [state, setState] = React.useState<{ set: boolean; source: string | null } | null>(null);
  const [open, setOpen] = React.useState(false);
  const [key, setKey] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(() => fetch("/api/gemini-key").then(r => r.json()).then(setState).catch(() => {}), []);
  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/gemini-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not save the key");
      setState(d); setKey(""); setShow(false); setOpen(false); window.dispatchEvent(new Event("cursed:models-changed"));
      notify({ message: "Gemini key saved", tab });
    } catch (e: any) { notifyError(e.message, tab); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    setBusy(true);
    try { setState(await (await fetch("/api/gemini-key", { method: "DELETE" })).json()); window.dispatchEvent(new Event("cursed:models-changed")); notify({ message: "Gemini key removed", tab }); }
    catch (e: any) { notifyError(e.message, tab); }
    finally { setBusy(false); }
  };

  const missing = state ? !state.set : false;
  const ring = accent === "pink" ? "focus:ring-pink-500" : "focus:ring-orange-500";
  const solid = accent === "pink" ? "bg-pink-600 hover:bg-pink-500" : "bg-orange-600 hover:bg-orange-500";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title={missing ? "Add your Gemini API key" : "Gemini API key"}
        className={`relative p-2 rounded-xl transition-colors ${missing ? "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25" : "bg-white/5 text-zinc-400 hover:bg-white/10"}`}
      >
        <KeyRound size={14} />
        {missing && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
      </button>
      {open && (
        <div className="absolute z-50 left-0 mt-2 w-80 glass border border-white/15 rounded-2xl p-4 space-y-3 shadow-2xl shadow-black/60 bg-zinc-950/95">
          <div>
            <p className="text-sm font-bold text-white">Gemini API key</p>
            <p className="text-[11px] text-zinc-500">
              {state?.set ? (state.source === "env" ? "A key is set through GEMINI_API_KEY." : "A key is saved on this PC.") : "Cloud image and video need a key. Get one free at aistudio.google.com."} Chat, voice and local generation never use it.
            </p>
          </div>
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={key}
              onChange={e => setKey(e.target.value)}
              onKeyDown={e => e.key === "Enter" && key.trim() && save()}
              placeholder={state?.set ? "Paste a new key to replace it" : "Paste your key"}
              autoComplete="off" spellCheck={false}
              className={`w-full bg-white/5 border-none rounded-xl pl-3.5 pr-10 py-2.5 text-sm text-white font-mono focus:outline-none focus:ring-1 ${ring} placeholder:font-sans placeholder:text-zinc-700`}
            />
            <button onClick={() => setShow(s => !s)} title={show ? "Hide" : "Show"} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={busy || !key.trim()} className={`flex-1 flex items-center justify-center gap-2 ${solid} text-white text-xs font-bold py-2.5 rounded-xl disabled:opacity-40 transition-colors`}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save key
            </button>
            {state?.source === "saved" && <button onClick={clear} disabled={busy} title="Remove the saved key" className="px-3 rounded-xl bg-white/5 hover:bg-red-500/20 text-zinc-400 hover:text-red-400 transition-colors"><Trash2 size={14} /></button>}
          </div>
        </div>
      )}
    </div>
  );
}
