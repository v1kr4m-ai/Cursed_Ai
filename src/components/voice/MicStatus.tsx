import { AnimatePresence, motion } from "motion/react";
import { Loader2 } from "lucide-react";

export type MicPhase = "loading" | "waiting" | "hearing" | "transcribing";

const STEPS: { id: MicPhase; label: string }[] = [
  { id: "loading", label: "Loading" },
  { id: "waiting", label: "Waiting" },
  { id: "hearing", label: "Hearing" },
  { id: "transcribing", label: "Transcribing" },
];

/** Where the microphone is right now: Loading -> Waiting for speech -> Hearing you -> Transcribing. */
export function micPhase(opts: { listening: boolean; transcribing: boolean; ready: boolean; heard: boolean }): MicPhase | null {
  if (opts.transcribing) return "transcribing";
  if (!opts.listening) return null;
  return !opts.ready ? "loading" : opts.heard ? "hearing" : "waiting";
}

export function MicStatus({ phase, level = 0 }: { phase: MicPhase | null; level?: number }) {
  return (
    <AnimatePresence>
      {phase && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
          <div className="flex items-center gap-1.5 px-1 pb-1.5 text-[9px] font-black uppercase tracking-widest" role="status" aria-live="polite">
            {STEPS.map(s => {
              const on = s.id === phase;
              return (
                <span key={s.id} className={`flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors ${on ? (s.id === "hearing" ? "bg-emerald-500 text-white" : s.id === "transcribing" ? "bg-amber-500 text-white" : "bg-violet-500 text-white") : "bg-white/5 text-zinc-600"}`}>
                  {on && (s.id === "loading" || s.id === "transcribing") && <Loader2 size={9} className="animate-spin" />}
                  {s.label}
                </span>
              );
            })}
            {phase === "hearing" && <span className="ml-1 h-1.5 rounded-full bg-emerald-400 transition-all" style={{ width: 6 + level * 40 }} />}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
