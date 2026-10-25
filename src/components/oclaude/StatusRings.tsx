import React from "react";

/** One small ring with a value in the middle and a word under it, like a status line you can glance at. */
function Ring({ pct, value, label, title, tone = "violet" }: { pct: number | null; value: string; label: string; title: string; tone?: "violet" | "amber" | "rose" | "emerald" | "sky" }) {
  const r = 13, c = 2 * Math.PI * r, p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const color = { violet: "#a78bfa", amber: "#fbbf24", rose: "#fb7185", emerald: "#34d399", sky: "#38bdf8" }[tone];
  return (
    <div title={title} className="flex flex-col items-center gap-0.5">
      <div className="relative h-8 w-8">
        <svg viewBox="0 0 32 32" className="h-8 w-8 -rotate-90">
          <circle cx="16" cy="16" r={r} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={3} />
          {pct !== null && <circle cx="16" cy="16" r={r} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} style={{ transition: "stroke-dashoffset .5s ease" }} />}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-zinc-200">{value}</span>
      </div>
      <span className="text-[8px] uppercase tracking-wider text-zinc-500">{label}</span>
    </div>
  );
}

export interface StatusInfo {
  ctxTokens: number; ctxMax: number | null; model: string; permission: string; folder: string;
  filesChanged: number; tools: number; turns: number; running: boolean; elapsed: number; lastMs: number;
}

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

/** The status line of a session as rings: context used, run time, tools used, files changed; then model, folder and mode. */
export function StatusRings({ s }: { s: StatusInfo }) {
  const ctxPct = s.ctxMax ? (s.ctxTokens / s.ctxMax) * 100 : null;
  const ctxTone = ctxPct === null ? "violet" : ctxPct > 85 ? "rose" : ctxPct > 60 ? "amber" : "emerald";
  const secs = s.running ? s.elapsed : Math.round(s.lastMs / 1000);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 px-1">
      <Ring pct={ctxPct} value={ctxPct === null ? k(s.ctxTokens) : `${Math.round(ctxPct)}%`} label="context" tone={ctxTone}
        title={`Context: ${k(s.ctxTokens)} tokens used${s.ctxMax ? ` of ${k(s.ctxMax)}` : ""}. Type /compact to shrink it when it gets full.`} />
      <Ring pct={s.running ? (s.elapsed % 60) / 0.6 : null} value={secs >= 60 ? `${Math.floor(secs / 60)}m` : `${secs}s`} label={s.running ? "running" : "last run"} tone="sky"
        title={s.running ? `Working for ${secs} s` : `The last run took ${secs} s`} />
      <Ring pct={null} value={String(s.tools)} label="tools" title={`${s.tools} tool calls in this session, over ${s.turns} turns in the last run`} />
      <Ring pct={null} value={String(s.filesChanged)} label="files" tone="amber" title={`${s.filesChanged} files changed in this session`} />
      <div className="ml-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px]">
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-violet-300">{s.model || "no model"}</span>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-zinc-300">{s.permission}</span>
        <span className="max-w-[14rem] truncate rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-zinc-400" title={s.folder}>{s.folder.split(/[\\/]/).pop()}</span>
      </div>
    </div>
  );
}
