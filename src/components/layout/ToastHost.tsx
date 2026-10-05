import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { CheckCircle2 } from "lucide-react";
import { Notice } from "../../lib/notify";

interface Toast extends Notice { id: number }

/** Stack of popups at the bottom of the screen; click one to jump to the related tab. */
export function ToastHost({ activeTab, onNavigate }: { activeTab: string; onNavigate: (tab: string) => void }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const tabRef = React.useRef(activeTab);
  tabRef.current = activeTab;

  React.useEffect(() => {
    const onNotify = (e: Event) => {
      const n = (e as CustomEvent<Notice>).detail;
      const looking = !document.hidden && n.tab === tabRef.current;
      if (n.onlyIfAway && looking) return;
      // A desktop notification too when the window is in the background and the browser already allows it.
      if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try { new Notification("Cursed_Ai", { body: n.message }); } catch { /* not allowed here */ }
      }
      const id = Date.now() + Math.random();
      setToasts(prev => [...prev.slice(-3), { ...n, id }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
    };
    window.addEventListener("cursed:notify", onNotify);
    return () => window.removeEventListener("cursed:notify", onNotify);
  }, []);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.button
            key={t.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }}
            onClick={() => { if (t.tab) onNavigate(t.tab); setToasts(prev => prev.filter(x => x.id !== t.id)); }}
            className="pointer-events-auto flex items-center gap-3 bg-zinc-900 border border-emerald-500/40 text-white text-sm font-bold pl-4 pr-5 py-3 rounded-2xl shadow-2xl shadow-black/60"
          >
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />{t.message}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
