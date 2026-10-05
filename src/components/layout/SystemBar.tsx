import React from "react";

interface Live {
  cpu: number;
  ram: number;
  ramUsedGB: number;
  ramTotalGB: number;
  gpu: { name: string; util: number; vramUsedMB: number; vramTotalMB: number; tempC: number } | null;
}

function Tile({ label, value, text, color, hint }: { label: string; value: number | null; text: string; color: string; hint?: string }) {
  const pct = value === null ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div title={hint} className="relative h-11 min-w-[78px] flex-1 max-w-[120px] rounded-lg bg-white/[0.06] border border-white/5 overflow-hidden">
      <div className={`absolute inset-y-0 left-0 transition-all duration-700 ${color}`} style={{ width: `${pct}%`, opacity: 0.85 }} />
      <span className="absolute right-2 top-1 text-sm font-bold text-white drop-shadow">{text}</span>
      <span className="absolute left-2 bottom-1 text-[10px] font-medium text-white/80 drop-shadow">{label}</span>
    </div>
  );
}

/** Real-time CPU / RAM / GPU / VRAM / temperature readings, refreshed every 2 seconds. */
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
  const hot = (v: number, warn: number, bad: number, ok: string) => v >= bad ? "bg-red-500" : v >= warn ? "bg-amber-500" : ok;

  return (
    <div className={`flex items-center gap-2 mb-2 shrink-0 ${offline ? "opacity-40" : ""}`}>
      <Tile label="CPU" value={live.cpu} text={`${live.cpu}%`} color={hot(live.cpu, 70, 90, "bg-emerald-600")} hint="Processor load" />
      <Tile label="RAM" value={live.ram} text={`${live.ram}%`} color={hot(live.ram, 80, 92, "bg-emerald-600")} hint={`${live.ramUsedGB.toFixed(1)} of ${live.ramTotalGB.toFixed(1)} GB in use`} />
      <Tile label="GPU" value={g ? g.util : null} text={g ? `${g.util}%` : "n/a"} color={hot(g?.util ?? 0, 70, 90, "bg-violet-600")} hint={g ? g.name : "No NVIDIA GPU reading available"} />
      <Tile label="VRAM" value={vramPct} text={vramPct === null ? "n/a" : `${vramPct}%`} color={hot(vramPct ?? 0, 80, 92, "bg-sky-600")} hint={g ? `${(g.vramUsedMB / 1024).toFixed(1)} of ${(g.vramTotalMB / 1024).toFixed(1)} GB video memory in use` : undefined} />
      <Tile label="Temp" value={g ? Math.min(100, g.tempC) : null} text={g ? `${g.tempC}°` : "n/a"} color={hot(g?.tempC ?? 0, 75, 85, "bg-yellow-600")} hint="GPU temperature" />
    </div>
  );
}
