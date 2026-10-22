import React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** A picture that opens full size over the page when clicked; Esc, the X or a click outside closes it. */
export function ZoomImage({ src, alt, className, caption }: { src: string; alt: string; className?: string; caption?: string }) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  return (
    <>
      <img src={src} alt={alt} title={`${alt} - click to enlarge`} className={`${className || ""} cursor-zoom-in`} onClick={e => { e.stopPropagation(); e.preventDefault(); setOpen(true); }} />
      {open && createPortal(
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }} onClick={e => e.stopPropagation()}>
          <button onClick={() => setOpen(false)} aria-label="Close" className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><X size={18} /></button>
          <figure className="flex max-h-full max-w-full flex-col items-center gap-2">
            <img src={src} alt={alt} className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl" />
            <figcaption className="text-xs text-neutral-300">{caption || alt}</figcaption>
          </figure>
        </div>,
        document.body,
      )}
    </>
  );
}
