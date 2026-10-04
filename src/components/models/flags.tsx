import React from "react";
import { Brain, Code2, Globe, Eye, Wrench, Layers } from "lucide-react";

export const FLAG_STYLE: Record<string, { cls: string; icon: React.ReactNode }> = {
  Reasoning: { cls: "bg-fuchsia-500/20 text-fuchsia-200", icon: <Brain size={10} /> },
  Coding: { cls: "bg-emerald-500/20 text-emerald-200", icon: <Code2 size={10} /> },
  Multilingual: { cls: "bg-sky-500/20 text-sky-200", icon: <Globe size={10} /> },
  Vision: { cls: "bg-amber-500/20 text-amber-200", icon: <Eye size={10} /> },
  Tools: { cls: "bg-indigo-500/20 text-indigo-200", icon: <Wrench size={10} /> },
  Embedding: { cls: "bg-zinc-500/25 text-zinc-200", icon: <Layers size={10} /> },
};

export function FlagChip({ flag }: { flag: string }) {
  const s = FLAG_STYLE[flag] || FLAG_STYLE.Embedding;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${s.cls}`}>
      {s.icon}{flag}
    </span>
  );
}

export function formatBytes(n: number) {
  if (!n) return "";
  const gb = n / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`;
}

const FIT_STYLE = {
  ok: "bg-emerald-500/20 text-emerald-300",
  tight: "bg-amber-500/20 text-amber-300",
  no: "bg-red-500/20 text-red-300",
} as const;

/** Small "Fits your RAM / Tight fit / Too big" pill with the numbers in its tooltip. */
export function FitBadge({ fit }: { fit: { level: "ok" | "tight" | "no"; label: string; detail: string } | null }) {
  if (!fit) return null;
  return (
    <span title={fit.detail} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold cursor-help ${FIT_STYLE[fit.level]}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />{fit.label}
    </span>
  );
}
