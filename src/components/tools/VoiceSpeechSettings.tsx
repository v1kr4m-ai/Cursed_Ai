import React from "react";
import { Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTtsPrefs, setTtsPrefs, makeUtterance, onVoices } from "../../services/tts";

/** Settings row: which voice reads replies aloud, and how fast. Works offline (voices installed on this PC). */
export function VoiceSpeechSettings() {
  const [voices, setVoices] = React.useState<SpeechSynthesisVoice[]>([]);
  const [prefs, setPrefs] = React.useState(getTtsPrefs);
  React.useEffect(() => onVoices(setVoices), []);

  const update = (p: Partial<typeof prefs>) => { setTtsPrefs(p); setPrefs(getTtsPrefs()); };
  const test = () => {
    const synth = window.speechSynthesis;
    synth.cancel();
    synth.speak(makeUtterance("Hello, this is how I sound. Arrr, matey."));
  };

  return (
    <div className="p-6 flex flex-col gap-4 hover:bg-white/[0.02] transition-all">
      <div className="space-y-1">
        <p className="text-zinc-100 font-bold tracking-tight">Speaking voice</p>
        <p className="text-xs text-zinc-500">Used by the read-aloud button and the Cursed_Pirate assistant. These are the voices installed on this PC, so they work offline.</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <select
          value={prefs.voiceURI}
          onChange={(e) => update({ voiceURI: e.target.value })}
          className="h-10 min-w-[240px] max-w-full rounded-xl bg-zinc-900 border border-white/10 text-zinc-100 text-xs px-3"
        >
          <option value="">Default voice</option>
          {voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang}){v.localService ? "" : " - online"}</option>)}
        </select>
        <label className="flex items-center gap-3 text-xs text-zinc-400">
          Speed
          <input type="range" min={0.6} max={1.6} step={0.1} value={prefs.rate} onChange={(e) => update({ rate: Number(e.target.value) })} className="w-36 accent-violet-500" />
          <span className="w-8 text-zinc-200 tabular-nums">{prefs.rate.toFixed(1)}x</span>
        </label>
        <Button onClick={test} variant="ghost" className="bg-white/5 hover:bg-white/10 text-zinc-300 font-bold text-xs h-9"><Volume2 size={14} className="mr-2" />Test voice</Button>
      </div>
      {voices.length === 0 && <p className="text-[11px] text-amber-400">This browser reports no installed voices - the default voice will be used.</p>}
    </div>
  );
}
