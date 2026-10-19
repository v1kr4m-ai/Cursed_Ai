import React from "react";
import { Share2, Send, Mail, Copy, MonitorSmartphone, MessageCircle, Instagram, Youtube, Clapperboard, Twitter } from "lucide-react";
import { notify, notifyError } from "../../lib/notify";
import { iconBtn } from "./shared";
import { Kind } from "./types";

interface Props {
  kind: Kind;
  /** Where the browser can load the file from (gallery URL, data URL, tool file URL). */
  url: string;
  /** Text that goes with it: the prompt, usually. */
  caption?: string;
  /** Selects the file in Windows Explorer, for the sites that need it dragged in. */
  onReveal?: () => void;
  tab: string;
}

const ext = (mime: string) => (mime.includes("mp4") ? "mp4" : mime.includes("webm") ? "webm" : mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : mime.includes("png") ? "png" : mime.split("/")[1] || "bin");

/**
 * Share button. The Windows share sheet is the one that really attaches the file (WhatsApp, Telegram, Mail, Quick Share /
 * Nearby Share... whatever is installed). The per-site entries open that site's own page; websites do not let another
 * app hand them a file, so for those the file is also selected in Explorer, ready to drag in.
 */
export function ShareMenu({ kind, url, caption = "", onReveal, tab }: Props) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const text = caption.trim().slice(0, 240);
  const getFile = async (): Promise<File> => {
    const blob = await (await fetch(url)).blob();
    return new File([blob], `cursed-${kind}-${Date.now()}.${ext(blob.type)}`, { type: blob.type });
  };

  const systemShare = async (): Promise<boolean> => {
    try {
      const file = await getFile();
      if (typeof navigator.share !== "function" || !navigator.canShare?.({ files: [file] })) return false;
      await navigator.share({ files: [file], text, title: "Cursed_Ai" });
      return true;
    } catch (e: any) {
      if (e?.name === "AbortError") return true; // the person closed the sheet
      return false;
    }
  };

  const run = async (fn: () => Promise<void> | void) => { setOpen(false); setBusy(true); try { await fn(); } catch (e: any) { notifyError(e?.message || "Could not share", tab); } finally { setBusy(false); } };

  const viaSheet = () => run(async () => {
    if (await systemShare()) return;
    onReveal?.();
    notify({ message: "This browser cannot open the Windows share sheet - the file is selected in its folder instead.", kind: "warning", tab });
  });

  const copyImage = () => run(async () => {
    const blob = await (await fetch(url)).blob();
    let png = blob;
    if (blob.type !== "image/png") {
      const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height; c.getContext("2d")!.drawImage(bmp, 0, 0);
      png = await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error("Could not convert the image"))), "image/png"));
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    notify({ message: "Image copied - paste it into any chat (Ctrl+V)", tab });
  });

  const site = (name: string, link: string, hint: string) => run(async () => {
    window.open(link, "_blank", "noopener");
    onReveal?.();
    notify({ message: `${name} opened. ${hint}`, tab });
  });
  const enc = encodeURIComponent;

  const isImage = kind === "image";
  const Row = ({ icon, label, note, onClick }: { icon: React.ReactNode; label: string; note?: string; onClick: () => void }) => (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/5 transition-colors">
      <span className="text-zinc-400 shrink-0">{icon}</span>
      <span className="min-w-0"><span className="block text-[13px] text-zinc-200">{label}</span>{note && <span className="block text-[10px] text-zinc-600 truncate">{note}</span>}</span>
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} disabled={busy} title="Share" className={`${iconBtn} flex items-center gap-1.5 text-[11px] font-semibold ${open ? "!bg-white/15 !text-white" : ""}`}><Share2 size={14} /> Share</button>
      {open && (
        <div className="absolute z-50 right-0 bottom-full mb-2 w-72 max-h-[70vh] overflow-y-auto rounded-2xl border border-white/15 bg-zinc-950/95 backdrop-blur shadow-2xl shadow-black/60 py-1.5">
          <Row icon={<MonitorSmartphone size={16} />} label="Windows share sheet" note="Attaches the file: WhatsApp, Telegram, Mail, Quick Share..." onClick={viaSheet} />
          <Row icon={<Send size={16} />} label="Quick Share / Nearby Share" note="Send to a phone or PC nearby" onClick={viaSheet} />
          {isImage && <Row icon={<Copy size={16} />} label="Copy image" note="Then paste into any chat" onClick={copyImage} />}
          <p className="px-3 pt-2 pb-1 text-[10px] font-black uppercase tracking-widest text-zinc-600">Open a site (file is selected for dragging)</p>
          <Row icon={<MessageCircle size={16} />} label="WhatsApp" onClick={() => site("WhatsApp", `https://wa.me/?text=${enc(text)}`, "Attach the file from the folder that opened.")} />
          <Row icon={<Send size={16} />} label="Telegram" onClick={() => site("Telegram", `https://t.me/share/url?url=${enc(" ")}&text=${enc(text)}`, "Attach the file from the folder that opened.")} />
          <Row icon={<Mail size={16} />} label="Email" onClick={() => run(() => { window.location.href = `mailto:?subject=${enc("From Cursed_Ai")}&body=${enc(text)}`; onReveal?.(); notify({ message: "Email draft opened. Attach the file from the folder that opened.", tab }); })} />
          <Row icon={<Twitter size={16} />} label="X (Twitter)" onClick={() => site("X", `https://twitter.com/intent/tweet?text=${enc(text)}`, "Attach the file in the post.")} />
          <Row icon={<Instagram size={16} />} label="Instagram" onClick={() => site("Instagram", "https://www.instagram.com/", "Use the + button and pick the file.")} />
          <Row icon={<Youtube size={16} />} label="YouTube" onClick={() => site("YouTube Studio", "https://studio.youtube.com/", "Use Create > Upload videos and pick the file.")} />
          <Row icon={<Clapperboard size={16} />} label="YouTube Shorts" note="Vertical clips up to 60 s" onClick={() => site("YouTube Studio", "https://studio.youtube.com/", "Upload the file; vertical clips under 60 s become Shorts.")} />
        </div>
      )}
    </div>
  );
}
