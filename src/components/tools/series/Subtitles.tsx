import React from "react";
import { Captions, Loader2, Plus, Trash2, Flame, Wand2 } from "lucide-react";
import { api, fileUrl, type Cue, type Episode, type Project, type SubStyle } from "./api";
import { notifyError, notify } from "../../../lib/notify";

const FONTS = ["Arial", "Segoe UI", "Verdana", "Trebuchet MS", "Tahoma", "Georgia", "Times New Roman", "Impact", "Arial Black", "Comic Sans MS", "Courier New", "Consolas", "Bahnschrift", "Calibri", "Cambria"];
const DEFAULT: SubStyle = { font: "Arial", size: 5.2, color: "#ffffff", outlineColor: "#000000", outlineWidth: 0.35, bold: true, italic: false, uppercase: false, position: "bottom", box: false, boxOpacity: 0.55, maxWords: 4 };
const SOURCES = [
  { id: "script", label: "From the script", note: "Uses the narration lines you wrote; timing follows the speech in each clip." },
  { id: "offline", label: "Offline (Whisper)", note: "Listens to each clip on this PC, no internet. English only." },
  { id: "online", label: "Online (Gemini)", note: "Listens with Google Gemini - any language, needs a key and internet." },
] as const;

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
const field = "bg-transparent border border-neutral-700 rounded-md px-2 py-1 text-xs focus:outline-none focus:border-neutral-500";

/** Captions for one joined episode: make them, fix them, choose a look, burn them in. */
export function SubtitlesPanel({ project, episode, onChanged }: { project: Project; episode: Episode; onChanged: (p: Project) => void }) {
  const subs = episode.subtitles;
  const [style, setStyle] = React.useState<SubStyle>({ ...DEFAULT, ...(subs?.style || {}) });
  const [cues, setCues] = React.useState<Cue[]>(subs?.cues || []);
  const [source, setSource] = React.useState<(typeof SOURCES)[number]["id"]>("script");
  const [busy, setBusy] = React.useState<"" | "gen" | "burn" | "save">("");
  const [now, setNow] = React.useState(0);
  const [vh, setVh] = React.useState(0);
  const [dirty, setDirty] = React.useState(false);
  const video = React.useRef<HTMLVideoElement>(null);

  // Take on the saved version when it changes from outside (after generating).
  React.useEffect(() => { setCues(subs?.cues || []); setStyle({ ...DEFAULT, ...(subs?.style || {}) }); setDirty(false); }, [subs?.updatedAt]);

  const measure = () => setVh(video.current?.clientHeight || 0);
  React.useEffect(() => { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }, []);

  const active = cues.find(c => now >= c.start && now < c.end);
  const edit = (next: Cue[]) => { setCues(next); setDirty(true); };
  const look = (patch: Partial<SubStyle>) => { setStyle(s => ({ ...s, ...patch })); setDirty(true); };

  async function run<T>(kind: "gen" | "burn" | "save", fn: () => Promise<T>) {
    setBusy(kind);
    try { return await fn(); } catch (e: any) { notifyError(e?.message || String(e), "series"); } finally { setBusy(""); }
  }
  const redoScene = (sceneId: string) => run("gen", async () => { onChanged(await api.redoSceneSubtitles(project.id, episode.id, sceneId, source)); });
  // Scene windows in the joined episode, so the list can be grouped and a scene redone on its own.
  const windows = React.useMemo(() => {
    let t = 0;
    return [...episode.scenes].sort((a, b) => a.number - b.number).map(s => { const w = { id: s.id, number: s.number, from: t, to: t + (s.durationS || 7) }; t = w.to; return w; });
  }, [episode.scenes]);
  const generate = () => run("gen", async () => { onChanged(await api.generateSubtitles(project.id, episode.id, source)); notify({ message: "Subtitles ready - check them below", tab: "series" }); });
  const save = () => run("save", async () => { onChanged(await api.saveSubtitles(project.id, episode.id, { cues, style })); setDirty(false); });
  const burn = () => run("burn", async () => {
    if (dirty) await api.saveSubtitles(project.id, episode.id, { cues, style });
    onChanged(await api.burnSubtitles(project.id, episode.id));
    notify({ message: "Subtitled video saved next to the episode", tab: "series" });
  });

  const shadow = style.outlineWidth > 0 ? `0 0 ${Math.max(1, style.outlineWidth * vh / 100 * 1.5)}px ${style.outlineColor}, 0 0 ${Math.max(1, style.outlineWidth * vh / 100)}px ${style.outlineColor}` : undefined;
  const overlayStyle: React.CSSProperties = {
    fontFamily: `"${style.font}", sans-serif`, fontSize: (style.size / 100) * vh, color: style.color, fontWeight: style.bold ? 700 : 400, fontStyle: style.italic ? "italic" : "normal",
    textTransform: style.uppercase ? "uppercase" : "none", textShadow: shadow, WebkitTextStroke: style.outlineWidth > 0 ? `${Math.max(0.5, style.outlineWidth * vh / 100)}px ${style.outlineColor}` : undefined, paintOrder: "stroke fill",
    background: style.box ? `rgba(0,0,0,${style.boxOpacity})` : undefined, padding: style.box ? "0.15em 0.4em" : undefined, borderRadius: style.box ? "0.2em" : undefined,
    lineHeight: 1.15, textAlign: "center", maxWidth: "88%",
  };
  const pos = style.position === "top" ? { top: "9%" } : style.position === "middle" ? { top: "50%", transform: "translateY(-50%)" } : { bottom: "9%" };

  return (
    <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium"><Captions size={15} className="text-sky-400" /> Subtitles
        {subs && <span className="ml-auto text-[10px] opacity-50">{cues.length} lines - {subs.source}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={source} onChange={e => setSource(e.target.value as any)} className={`${field} [&_*]:bg-white [&_*]:text-black`} title={SOURCES.find(s => s.id === source)?.note}>
          {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button onClick={generate} disabled={!!busy} className="flex items-center gap-1.5 rounded-md bg-sky-600/80 hover:bg-sky-600 disabled:opacity-40 px-3 py-1.5 text-xs font-medium text-white">
          {busy === "gen" ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}{subs ? "Make them again" : "Make subtitles"}
        </button>
        <span className="text-[11px] opacity-55">{SOURCES.find(s => s.id === source)?.note}</span>
      </div>

      {subs && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,260px)_1fr]">
          {/* preview with the look applied */}
          <div className="space-y-2">
            <div className="relative mx-auto w-full max-w-[260px] overflow-hidden rounded bg-black">
              <video ref={video} src={fileUrl(episode.exportPath!)} controls onLoadedMetadata={measure} onTimeUpdate={e => setNow(e.currentTarget.currentTime)} onSeeked={e => setNow(e.currentTarget.currentTime)} className="block w-full" />
              {active && <div className="pointer-events-none absolute inset-x-0 flex justify-center" style={pos}><span style={overlayStyle}>{active.text}</span></div>}
            </div>
          </div>

          <div className="space-y-3 min-w-0">
            {/* the look */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] sm:grid-cols-3">
              <label className="space-y-1"><span className="opacity-60">Font</span>
                <select value={style.font} onChange={e => look({ font: e.target.value })} className={`${field} w-full [&_*]:bg-white [&_*]:text-black`}>{FONTS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}</select></label>
              <label className="space-y-1"><span className="opacity-60">Size {style.size.toFixed(1)}%</span>
                <input type="range" min={2.5} max={10} step={0.1} value={style.size} onChange={e => look({ size: Number(e.target.value) })} className="w-full accent-sky-500" /></label>
              <label className="space-y-1"><span className="opacity-60">Words per line {style.maxWords}</span>
                <input type="range" min={1} max={10} step={1} value={style.maxWords} onChange={e => look({ maxWords: Number(e.target.value) })} className="w-full accent-sky-500" /></label>
              <label className="space-y-1"><span className="opacity-60">Text colour</span>
                <input type="color" value={style.color} onChange={e => look({ color: e.target.value })} className="h-7 w-full rounded bg-transparent" /></label>
              <label className="space-y-1"><span className="opacity-60">Outline colour</span>
                <input type="color" value={style.outlineColor} onChange={e => look({ outlineColor: e.target.value })} className="h-7 w-full rounded bg-transparent" /></label>
              <label className="space-y-1"><span className="opacity-60">Outline {style.outlineWidth.toFixed(2)}%</span>
                <input type="range" min={0} max={1} step={0.05} value={style.outlineWidth} onChange={e => look({ outlineWidth: Number(e.target.value) })} className="w-full accent-sky-500" /></label>
              <label className="space-y-1"><span className="opacity-60">Position</span>
                <select value={style.position} onChange={e => look({ position: e.target.value as any })} className={`${field} w-full [&_*]:bg-white [&_*]:text-black`}><option value="bottom">Bottom</option><option value="middle">Middle</option><option value="top">Top</option></select></label>
              <div className="col-span-2 flex flex-wrap items-end gap-3 sm:col-span-2">
                {([["bold", "Bold"], ["italic", "Italic"], ["uppercase", "CAPS"], ["box", "Box"]] as const).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={style[k]} onChange={e => look({ [k]: e.target.checked } as any)} className="accent-sky-500" />{l}</label>
                ))}
                {style.box && <label className="flex items-center gap-1.5"><span className="opacity-60">Box</span><input type="range" min={0.1} max={1} step={0.05} value={style.boxOpacity} onChange={e => look({ boxOpacity: Number(e.target.value) })} className="w-20 accent-sky-500" /></label>}
              </div>
            </div>

            {/* the words, editable */}
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {cues.map((c, i) => {
                const win = windows.find(w => (c.start + c.end) / 2 >= w.from && (c.start + c.end) / 2 < w.to);
                const first = win && cues.findIndex(x => { const m = (x.start + x.end) / 2; return m >= win.from && m < win.to; }) === i;
                return (
                <React.Fragment key={c.id}>
                {first && win && (
                  <div className="flex items-center gap-2 pt-1 text-[10px] opacity-60">
                    <span className="font-semibold">Scene {win.number}</span><span className="font-mono">{fmt(win.from)}-{fmt(win.to)}</span>
                    <button onClick={() => redoScene(win.id)} disabled={!!busy} title="Make the subtitles of this scene again with the source above; other scenes stay as they are" className="ml-auto rounded border border-neutral-700 px-2 py-0.5 hover:opacity-100 disabled:opacity-40">Redo this scene</button>
                  </div>
                )}
                <div className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 ${active?.id === c.id ? "bg-sky-500/15" : ""}`}>
                  <button onClick={() => { if (video.current) { video.current.currentTime = c.start; video.current.play().catch(() => {}); } }} title="Jump to this line" className="w-12 shrink-0 text-left font-mono text-[10px] opacity-55 hover:opacity-100">{fmt(c.start)}</button>
                  <input type="number" step={0.05} value={c.start} onChange={e => edit(cues.map((x, j) => j === i ? { ...x, start: Number(e.target.value) } : x))} className={`${field} w-16`} title="Start (seconds)" />
                  <input type="number" step={0.05} value={c.end} onChange={e => edit(cues.map((x, j) => j === i ? { ...x, end: Number(e.target.value) } : x))} className={`${field} w-16`} title="End (seconds)" />
                  <input value={c.text} onChange={e => edit(cues.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} className={`${field} min-w-0 flex-1`} />
                  <button onClick={() => edit(cues.filter((_, j) => j !== i))} title="Delete this line" className="opacity-50 hover:opacity-100"><Trash2 size={12} /></button>
                </div>
                </React.Fragment>
                );
              })}
              <button onClick={() => { const t = video.current?.currentTime ?? 0; edit([...cues, { id: "n" + Date.now().toString(36), start: t, end: t + 1.5, text: "New line" }].sort((a, b) => a.start - b.start)); }} className="flex items-center gap-1 text-[11px] opacity-60 hover:opacity-100"><Plus size={12} /> Add a line at the playhead</button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={save} disabled={!!busy || !dirty} className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1.5 text-xs disabled:opacity-40">{busy === "save" ? <Loader2 size={13} className="animate-spin" /> : null}Save edits</button>
              <button onClick={burn} disabled={!!busy || !cues.length} className="flex items-center gap-1.5 rounded-md bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-40 px-3 py-1.5 text-xs font-medium text-white">
                {busy === "burn" ? <Loader2 size={13} className="animate-spin" /> : <Flame size={13} />}Burn into the video
              </button>
              {episode.subtitles?.outPath && <span className="truncate text-[10px] opacity-50">{episode.subtitles.outPath}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
