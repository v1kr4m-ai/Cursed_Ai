import React from "react";
import { Mic, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveEngine, VoiceEnginePref, browserSpeechAvailable, isOnline } from "../../services/voiceEngine";

/** Settings helper: shows which speech engine is active right now and a live microphone level so you can see it works. */
export function MicTest({ pref }: { pref: VoiceEnginePref }) {
  const [testing, setTesting] = React.useState(false);
  const [level, setLevel] = React.useState(0);
  const [device, setDevice] = React.useState("");
  const [result, setResult] = React.useState<"ok" | "silent" | "error" | null>(null);
  const [error, setError] = React.useState("");

  const engine = resolveEngine(pref);
  const engineText = engine === "browser"
    ? "Right now: online browser speech (live words as you talk)."
    : !browserSpeechAvailable()
      ? "Right now: offline Whisper - this browser has no built-in speech recognition."
      : !isOnline() ? "Right now: offline Whisper - no internet connection." : "Right now: offline Whisper (selected in this setting).";

  const run = async () => {
    setTesting(true); setResult(null); setError(""); setLevel(0);
    let stream: MediaStream | null = null, ctx: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setDevice(stream.getAudioTracks()[0]?.label || "default microphone");
      const AudioCtx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      ctx = new AudioCtx();
      await ctx.resume().catch(() => {});
      const an = ctx.createAnalyser(); an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      let peak = 0;
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let sum = 0; for (const v of buf) sum += v * v;
          const rms = Math.sqrt(sum / buf.length);
          peak = Math.max(peak, rms);
          setLevel(Math.min(1, rms * 8));
          if (performance.now() - t0 > 6000) { clearInterval(timer); resolve(); }
        }, 60);
      });
      setResult(peak > 0.02 ? "ok" : "silent");
    } catch (e: any) {
      setError(/permission|denied|notallowed/i.test(String(e?.name) + String(e?.message)) ? "Microphone blocked - allow it for this site (lock icon in the address bar)." : e?.message || String(e));
      setResult("error");
    } finally {
      stream?.getTracks().forEach(t => t.stop());
      ctx?.close();
      setTesting(false); setLevel(0);
    }
  };

  return (
    <div className="p-6 flex items-center justify-between gap-6 hover:bg-white/[0.02] transition-all">
      <div className="space-y-1 min-w-0">
        <p className="text-zinc-100 font-bold tracking-tight">Microphone test</p>
        <p className="text-xs text-zinc-500">{engineText} Click test and say something for 6 seconds.</p>
        {device && <p className="text-[10px] text-zinc-600 font-mono truncate">Using: {device}</p>}
        {result === "ok" && <p className="text-xs text-emerald-400 flex items-center gap-1.5"><CheckCircle2 size={13} /> Your voice is coming through.</p>}
        {result === "silent" && <p className="text-xs text-amber-400 flex items-center gap-1.5"><AlertTriangle size={13} /> No sound heard - check the microphone chosen in the browser and that it is not muted.</p>}
        {result === "error" && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={13} /> {error}</p>}
      </div>
      <div className="flex items-center gap-4 shrink-0">
        {testing && <div className="w-28 h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-emerald-400 transition-all duration-75" style={{ width: `${Math.max(3, level * 100)}%` }} /></div>}
        <Button onClick={run} disabled={testing} variant="ghost" className="bg-white/5 hover:bg-white/10 text-zinc-300 font-bold text-xs h-9"><Mic size={14} className="mr-2" />{testing ? "Listening..." : "Test"}</Button>
      </div>
    </div>
  );
}
