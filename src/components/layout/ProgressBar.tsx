import React from "react";

/** Thin progress bar. value = 0..100, or null for "working, no percentage" (sliding bar). */
export function ProgressBar({ value, label, color = "bg-violet-500" }: { value: number | null; label?: string; color?: string }) {
  return (
    <div className="w-full">
      {label && <div className="flex justify-between text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-1.5"><span>{label}</span>{value !== null && <span>{Math.round(value)}%</span>}</div>}
      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden relative">
        {value === null
          ? <div className={`absolute inset-y-0 w-1/3 rounded-full ${color} animate-[cursed-slide_1.2s_ease-in-out_infinite]`} />
          : <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(100, Math.max(2, value))}%` }} />}
      </div>
    </div>
  );
}
