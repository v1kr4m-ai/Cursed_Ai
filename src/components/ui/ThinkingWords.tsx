import React from "react";
import { AnimatePresence, motion } from "motion/react";

const WORDS = [
  "Thinking", "Pondering", "Mulling it over", "Connecting the dots", "Weaving words", "Consulting the model",
  "Brewing a reply", "Sketching ideas", "Untangling thoughts", "Warming up the neurons", "Choosing words",
  "Following a hunch", "Polishing a sentence", "Chasing a thought", "Stirring the cauldron", "Almost there",
];

/**
 * What the model is "doing" while you wait: a changing word, bouncing dots and the seconds so far. A model that is
 * still loading can take a minute, so after a while the text says so.
 */
export function ThinkingWords({ className = "" }: { className?: string }) {
  const [i, setI] = React.useState(() => Math.floor(Math.random() * WORDS.length));
  const [secs, setSecs] = React.useState(0);
  React.useEffect(() => {
    const word = setInterval(() => setI(n => (n + 1) % WORDS.length), 2200);
    const clock = setInterval(() => setSecs(s => s + 1), 1000);
    return () => { clearInterval(word); clearInterval(clock); };
  }, []);
  return (
    <span className={"inline-flex items-center gap-2 " + className}>
      <span className="inline-flex gap-1" aria-hidden>
        {[0, 1, 2].map(d => <motion.span key={d} className="h-1.5 w-1.5 rounded-full bg-current" animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 0.9, delay: d * 0.15 }} />)}
      </span>
      <span className="relative inline-block min-w-[9.5rem]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={i} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.25 }} className="inline-block italic">{WORDS[i]}...</motion.span>
        </AnimatePresence>
      </span>
      <span className="text-[10px] opacity-50 tabular-nums">{secs}s{secs >= 20 ? " - a model that was not loaded yet can take a minute or two" : ""}</span>
    </span>
  );
}
