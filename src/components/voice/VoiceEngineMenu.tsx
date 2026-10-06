import React from "react";
import { Globe, WifiOff, Wand2, Check } from "lucide-react";
import { VoiceEnginePref, browserSpeechAvailable, isOnline, resolveEngine } from "../../services/voiceEngine";

interface Props {
  x: number;
  y: number;
  pref: VoiceEnginePref;
  onSelect: (pref: VoiceEnginePref) => void;
  onClose: () => void;
}

/** Right-click menu on any microphone button: choose the online browser mic or the offline Whisper mic. */
export function VoiceEngineMenu({ x, y, pref, onSelect, onClose }: Props) {
  React.useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", onKey); window.removeEventListener("blur", close); };
  }, [onClose]);

  const speech = browserSpeechAvailable();
  const secure = typeof window !== "undefined" && window.isSecureContext;
  const active = resolveEngine(pref);
  const items: { id: VoiceEnginePref; icon: React.ReactNode; title: string; note: string; disabled?: boolean }[] = [
    { id: "browser", icon: <Globe size={15} />, title: "Browser mic (online)", note: speech ? (isOnline() ? "Live words, Chrome / Edge, needs internet" : "No internet right now") : "Not available in this browser", disabled: !speech },
    { id: "whisper", icon: <WifiOff size={15} />, title: "Offline mic (Whisper)", note: "Works anywhere, no internet, runs on this PC" },
    { id: "auto", icon: <Wand2 size={15} />, title: "Automatic", note: "Online when possible, otherwise offline" },
  ];
  // keep the menu inside the window
  const left = Math.min(x, window.innerWidth - 290);
  const top = Math.min(y, window.innerHeight - 230);

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left, top }}
      className="fixed z-[70] w-[280px] bg-zinc-950 border border-white/15 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden py-1.5"
    >
      <p className="px-4 pt-1 pb-2 text-[10px] font-black uppercase tracking-widest text-zinc-500">Microphone</p>
      {items.map(it => (
        <button
          key={it.id}
          disabled={it.disabled}
          onClick={() => { onSelect(it.id); onClose(); }}
          className="w-full flex items-start gap-3 px-4 py-2 text-left hover:bg-white/5 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span className="mt-0.5 text-zinc-300">{it.icon}</span>
          <span className="flex-1">
            <span className="block text-sm font-semibold text-zinc-100">{it.title}</span>
            <span className="block text-[11px] text-zinc-500">{it.note}</span>
          </span>
          {pref === it.id && <Check size={15} className="mt-0.5 text-emerald-400" />}
        </button>
      ))}
      <div className="mt-1 pt-2 px-4 pb-1.5 border-t border-white/10 text-[11px] text-zinc-500 space-y-0.5">
        <p>Using now: <span className="text-zinc-300">{active === "browser" ? "browser mic (online)" : "offline Whisper"}</span></p>
        {!secure && <p className="text-amber-400">This page isn't secure: the microphone only works on http://localhost or https.</p>}
      </div>
    </div>
  );
}
