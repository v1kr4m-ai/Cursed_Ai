import React from "react";

interface Live {
  cpu: number;
  ram: number;
  ramUsedGB: number;
  ramTotalGB: number;
  gpu: { name: string; util: number; vramUsedMB: number; vramTotalMB: number; tempC: number | null; memory: "dedicated" | "shared"; detail: string } | null;
}

/** One small pill: a soft fill shows the level behind "LABEL value". */
function Pill({ label, value, text, color, hint }: { label: string; value: number | null; text: string; color: string; hint?: string }) {
  const pct = value === null ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div title={hint} className="relative h-6 px-2.5 rounded-full bg-white/[0.04] border border-white/10 overflow-hidden flex items-center gap-1.5 text-[10px] leading-none">
      <div className={`absolute inset-y-0 left-0 opacity-30 transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      <span className="relative font-semibold text-zinc-400 tracking-wide">{label}</span>
      <span className="relative font-bold text-zinc-100 tabular-nums">{text}</span>
    </div>
  );
}

/** Real-time CPU / RAM / GPU / VRAM / temperature readings, refreshed every 2 seconds. Small, top-right. */
export function SystemBar() {
  const [live, setLive] = React.useState<Live | null>(null);
  const [offline, setOffline] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const data = await (await fetch("/api/system/live")).json();
        if (alive) { setLive(data); setOffline(false); }
      } catch { if (alive) setOffline(true); }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!live) return null;
  const g = live.gpu;
  const vramPct = g && g.vramTotalMB ? Math.round((g.vramUsedMB / g.vramTotalMB) * 100) : null;
  const level = (v: number, warn: number, bad: number, ok: string) => v >= bad ? "bg-red-500" : v >= warn ? "bg-amber-500" : ok;

  return (
    <div className={`flex items-center justify-end gap-1.5 px-1 mb-1.5 shrink-0 ${offline ? "opacity-40" : ""}`}>
      <Pill label="CPU" value={live.cpu} text={`${live.cpu}%`} color={level(live.cpu, 70, 90, "bg-emerald-500")} hint="Processor load" />
      <Pill label="RAM" value={live.ram} text={`${live.ram}%`} color={level(live.ram, 80, 92, "bg-emerald-500")} hint={`${live.ramUsedGB.toFixed(1)} of ${live.ramTotalGB.toFixed(1)} GB in use`} />
      <Pill label="GPU" value={g ? g.util : null} text={g ? `${g.util}%` : "n/a"} color={level(g?.util ?? 0, 70, 90, "bg-violet-500")} hint={g ? g.detail : "No GPU reading available"} />
      <Pill label="VRAM" value={vramPct} text={vramPct === null ? "n/a" : `${vramPct}%`} color={level(vramPct ?? 0, 80, 92, "bg-sky-500")} hint={g ? `${(g.vramUsedMB / 1024).toFixed(1)} of ${(g.vramTotalMB / 1024).toFixed(1)} GB ${g.memory === "shared" ? "shared GPU memory (borrowed from RAM)" : "video memory"} in use` : undefined} />
      <Pill label="TEMP" value={g?.tempC != null ? Math.min(100, g.tempC) : null} text={g?.tempC != null ? `${g.tempC}°` : "n/a"} color={level(g?.tempC ?? 0, 75, 85, "bg-yellow-500")} hint="NVIDIA GPU temperature" />
    </div>
  );
}
