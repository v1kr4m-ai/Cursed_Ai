import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { CheckCircle2, AlertTriangle, XCircle, X } from "lucide-react";
import { Notice } from "../../lib/notify";

interface Toast extends Notice { id: number }

const STYLE = {
  success: { border: "border-emerald-500/40", icon: <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />, ms: 5000 },
  warning: { border: "border-amber-500/50", icon: <AlertTriangle size={18} className="text-amber-400 shrink-0" />, ms: 8000 },
  error: { border: "border-red-500/60", icon: <XCircle size={18} className="text-red-400 shrink-0" />, ms: 10000 },
} as const;

/** Stack of popups at the bottom of the screen; click one to jump to the related tab. Errors and warnings stay longer. */
export function ToastHost({ activeTab, onNavigate }: { activeTab: string; onNavigate: (tab: string) => void }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const tabRef = React.useRef(activeTab);
  tabRef.current = activeTab;

  React.useEffect(() => {
    const onNotify = (e: Event) => {
      const n = (e as CustomEvent<Notice>).detail;
      const kind = n.kind || "success";
      const looking = !document.hidden && n.tab === tabRef.current;
      if (n.onlyIfAway && looking) return;
      // A desktop notification too when the window is in the background and the browser already allows it.
      if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try { new Notification("Cursed_Ai", { body: n.message }); } catch { /* not allowed here */ }
      }
      const id = Date.now() + Math.random();
      setToasts(prev => [...prev.filter(t => t.message !== n.message).slice(-3), { ...n, kind, id }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), STYLE[kind].ms);
    };
    window.addEventListener("cursed:notify", onNotify);
    return () => window.removeEventListener("cursed:notify", onNotify);
  }, []);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none max-w-[min(92vw,560px)]">
      <AnimatePresence>
        {toasts.map(t => {
          const st = STYLE[t.kind || "success"];
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }}
              className={`pointer-events-auto flex items-start gap-3 bg-zinc-900 border ${st.border} text-white text-sm font-semibold pl-4 pr-2 py-3 rounded-2xl shadow-2xl shadow-black/60`}
            >
              {st.icon}
              <button onClick={() => { if (t.tab) onNavigate(t.tab); setToasts(prev => prev.filter(x => x.id !== t.id)); }} className="text-left flex-1 break-words">{t.message}</button>
              <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} title="Dismiss" className="p-1 text-zinc-500 hover:text-white"><X size={14} /></button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
