import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Mic, Globe, WifiOff, Wand2, Check, ChevronDown, Loader2 } from "lucide-react";
import { VoiceEnginePref, browserSpeechAvailable, isOnline, resolveEngine } from "../../services/voiceEngine";

const MODES = {
  browser: { label: "Browser mic (online)", note: "Live words - Chrome / Edge, needs internet", color: "text-sky-400", badge: <Globe size={9} />, badgeBg: "bg-sky-500" },
  whisper: { label: "Offline mic (Whisper)", note: "Works anywhere, no internet, runs on this PC", color: "text-emerald-400", badge: <WifiOff size={9} />, badgeBg: "bg-emerald-500" },
  auto: { label: "Automatic", note: "Online when possible, otherwise offline", color: "text-violet-400", badge: <Wand2 size={9} />, badgeBg: "bg-violet-500" },
} as const;

interface Props {
  pref: VoiceEnginePref;
  onSelect: (pref: VoiceEnginePref) => void;
  /** Primary action (start/stop listening). Omit for a selector-only button that just opens the menu. */
  onClick?: () => void;
  active?: boolean;            // listening right now
  busy?: boolean;              // transcribing
  disabled?: boolean;
  title?: string;
  ringPx?: number;             // loudness ring while listening offline
  /** Which side the popup grows from. */
  placement?: "top" | "bottom";
  className?: string;
}

/**
 * Microphone button whose look shows the chosen mic type (colour + badge) and whose menu pops out of the
 * button itself, then folds back into it when you pick something or click anywhere else.
 * Open it with the small arrow, a right-click, or - on a selector-only button - a plain click.
 */
export function MicModeButton({ pref, onSelect, onClick, active, busy, disabled, title, ringPx = 0, placement = "top", className = "" }: Props) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const mode = MODES[pref];
  const speech = browserSpeechAvailable();
  const using = resolveEngine(pref);
  const secure = typeof window !== "undefined" && window.isSecureContext;
  const up = placement === "top";

  const items: { id: VoiceEnginePref; disabled?: boolean; note: string }[] = [
    { id: "browser", disabled: !speech, note: !speech ? "Not available in this browser" : !isOnline() ? "No internet right now" : MODES.browser.note },
    { id: "whisper", note: MODES.whisper.note },
    { id: "auto", note: MODES.auto.note },
  ];

  return (
    <div ref={wrapRef} className={`relative inline-flex items-center ${className}`}>
      <button
        onClick={() => (onClick ? onClick() : setOpen(o => !o))}
        onContextMenu={(e) => { e.preventDefault(); setOpen(o => !o); }}
        disabled={disabled}
        title={title}
        style={active && ringPx ? { boxShadow: `0 0 0 ${Math.round(ringPx)}px rgba(239,68,68,0.35)` } : undefined}
        className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${active ? "bg-red-500/20 text-red-400" : `hover:bg-white/5 ${mode.color}`} ${busy ? "opacity-70 cursor-wait" : ""}`}
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}
        <span className={`absolute bottom-1 right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center text-white ${mode.badgeBg}`}>{mode.badge}</span>
      </button>
      {onClick && (
        <button onClick={() => setOpen(o => !o)} title="Choose microphone type" className="-ml-1 w-4 h-6 rounded-md flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/10">
          <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.4 }}
            transition={{ type: "spring", stiffness: 520, damping: 34 }}
            style={{ transformOrigin: up ? "bottom left" : "top left" }}
            className={`absolute left-0 ${up ? "bottom-full mb-2" : "top-full mt-2"} w-[272px] z-50 bg-zinc-950 border border-white/15 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden py-1.5`}
          >
            <p className="px-4 pt-1 pb-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-500">Microphone type</p>
            {items.map(it => {
              const m = MODES[it.id];
              return (
                <button
                  key={it.id}
                  disabled={it.disabled}
                  onClick={() => { onSelect(it.id); setOpen(false); }}
                  className="w-full flex items-start gap-3 px-4 py-2 text-left hover:bg-white/5 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <span className={`mt-0.5 relative ${m.color}`}><Mic size={16} /><span className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full flex items-center justify-center text-white ${m.badgeBg}`}>{m.badge}</span></span>
                  <span className="flex-1">
                    <span className="block text-sm font-semibold text-zinc-100">{m.label}</span>
                    <span className="block text-[11px] text-zinc-500">{it.note}</span>
                  </span>
                  {pref === it.id && <Check size={15} className="mt-0.5 text-emerald-400" />}
                </button>
              );
            })}
            <div className="mt-1 pt-2 px-4 pb-1.5 border-t border-white/10 text-[11px] text-zinc-500 space-y-0.5">
              <p>Using now: <span className="text-zinc-300">{using === "browser" ? "browser mic (online)" : "offline Whisper"}</span></p>
              {!secure && <p className="text-amber-400">This page isn't secure: the microphone only works on http://localhost or https.</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
