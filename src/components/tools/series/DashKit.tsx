import React from "react";
import { motion } from "motion/react";

/** A circular progress ring with the value in the middle (takes its colour from the surrounding text). */
export function Ring({ pct, size = 84, stroke = 6, label, sub }: { pct: number; size?: number; stroke?: number; label?: string; sub?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.14} strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - Math.min(1, pct / 100)) }} transition={{ duration: 0.9, ease: "easeOut" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-light tracking-tight" style={{ fontSize: size * 0.26 }}>{label ?? `${Math.round(pct)}%`}</span>
        {sub && <span className="text-[9px] opacity-55 mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

/** One card of a board. "dark" = charcoal, "frost" = frosted glass; a button when it has an onClick. */
export function Tile({ className = "", tone = "frost", onClick, title, heading, aside, children, delay = 0 }: {
  className?: string; tone?: "dark" | "frost"; onClick?: () => void; title?: string; heading?: string; aside?: React.ReactNode; children: React.ReactNode; delay?: number;
}) {
  const body = (
    <>
      {(heading || aside) && (
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-[13px] font-medium tracking-tight opacity-85">{heading}</p>
          {aside}
        </div>
      )}
      {children}
    </>
  );
  const common = `${className} ${tone === "dark" ? "sd-dark" : "sd-frost"} relative rounded-[1.6rem] border p-5 text-left overflow-hidden transition-colors`;
  if (!onClick) return <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }} className={common}>{body}</motion.div>;
  return (
    <motion.button initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }}
      onClick={onClick} title={title} className={`${common} cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-current block w-full`}>
      {body}
    </motion.button>
  );
}

export const hours = (min: number) => (min >= 90 ? `${Math.round(min / 60)} h` : `${Math.max(1, Math.round(min))} min`);

/** Big thin page title, like a poster. */
export function PageTitle({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <h1 className={`relative text-center font-extralight tracking-tight select-none ${small ? "text-3xl sm:text-5xl mb-4" : "text-4xl sm:text-6xl mb-5"}`}>{children}</h1>;
}
