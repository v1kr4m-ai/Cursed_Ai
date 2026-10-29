import React from "react";
import { Music, Loader2, Trash2, Upload, Wand2, Crosshair } from "lucide-react";
import { api, fileUrl, type AudioTrack, type Episode, type Project } from "./api";
import { notify, notifyError } from "../../../lib/notify";
import { MusicMaker } from "./MusicMaker";

const field = "bg-transparent border border-neutral-700 rounded-md px-2 py-1 text-xs focus:outline-none focus:border-neutral-500";
const COLORS = ["bg-violet-500", "bg-amber-500", "bg-rose-500", "bg-teal-500", "bg-sky-500"];
const fmt = (s: number) => `${Math.floor(Math.abs(s) / 60)}:${(Math.abs(s) % 60).toFixed(1).padStart(4, "0")}`;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Sound for an episode: add a file (or a video's sound), place it on a timeline, hear it against the video, then mix it in. */
export function AudioPanel({ project, episode, onChanged, wantSubtitles }: { project: Project; episode: Episode; onChanged: (p: Project) => void; wantSubtitles: boolean }) {
  const saved = episode.audio;
  const [tracks, setTracks] = React.useState<AudioTrack[]>(saved?.tracks || []);
  const [keep, setKeep] = React.useState(saved?.keepOriginal ?? true);
  const [origGain, setOrigGain] = React.useState(saved?.originalGain ?? 1);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState<"" | "upload" | "save" | "render">("");
  const [scene, setScene] = React.useState("start");
  const [total, setTotal] = React.useState(0);
  const [now, setNow] = React.useState(0);
  const video = React.useRef<HTMLVideoElement>(null);
  const audios = React.useRef<Record<string, HTMLAudioElement | null>>({});
  const fileRef = React.useRef<HTMLInputElement>(null);
  const bar = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => { setTracks(saved?.tracks || []); setKeep(saved?.keepOriginal ?? true); setOrigGain(saved?.originalGain ?? 1); setDirty(false); }, [saved?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const windows = React.useMemo(() => {
    let t = 0;
    return [...episode.scenes].sort((a, b) => a.number - b.number).map(s => { const w = { id: s.id, number: s.number, from: t, to: t + (s.durationS || 7) }; t = w.to; return w; });
  }, [episode.scenes]);
  const length = total || windows[windows.length - 1]?.to || 60;
  const startOf = scene === "start" ? 0 : windows.find(w => w.id === scene)?.from ?? 0;

  // Hear the tracks against the video: each audio element follows the video's clock minus the track's offset.
  React.useEffect(() => {
    const v = video.current;
    if (!v) return;
    const sync = () => {
      v.volume = keep ? clamp(origGain, 0, 1) : 0;
      for (const t of tracks) {
        const a = audios.current[t.id];
        if (!a) continue;
        const at = v.currentTime - t.offset;
        a.volume = clamp(t.gain, 0, 1);
        if (v.paused || at < 0 || at > t.duration) { if (!a.paused) a.pause(); if (at >= 0 && at <= t.duration && Math.abs(a.currentTime - at) > 0.05) a.currentTime = at; continue; }
        if (Math.abs(a.currentTime - at) > 0.2) a.currentTime = at;
        if (a.paused) a.play().catch(() => {});
      }
      setNow(v.currentTime);
    };
    const events = ["play", "pause", "seeked", "timeupdate", "ratechange", "loadedmetadata"];
    events.forEach(e => v.addEventListener(e, sync));
    const timer = window.setInterval(sync, 250);
    sync();
    return () => { events.forEach(e => v.removeEventListener(e, sync)); clearInterval(timer); Object.values(audios.current).forEach(a => a?.pause()); };
  }, [tracks, keep, origGain]);

  const edit = (id: string, patch: Partial<AudioTrack>) => { setTracks(ts => ts.map(t => (t.id === id ? { ...t, ...patch } : t))); setDirty(true); };

  async function guard<T>(kind: "upload" | "save" | "render", fn: () => Promise<T>) {
    setBusy(kind);
    try { return await fn(); } catch (e: any) { notifyError(e?.message || String(e), "series"); } finally { setBusy(""); }
  }
  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    guard("upload", async () => {
      let p: Project | null = null;
      for (const f of Array.from(files)) p = await api.uploadAudio(project.id, episode.id, f, startOf);
      if (p) { onChanged(p); notify({ message: "Audio added - drag it on the timeline to time it", tab: "series" }); }
    });
    if (fileRef.current) fileRef.current.value = "";
  };
  const save = () => guard("save", async () => { onChanged(await api.saveAudio(project.id, episode.id, { tracks, keepOriginal: keep, originalGain: origGain })); setDirty(false); });
  const remove = (id: string) => guard("save", async () => { onChanged(await api.deleteAudio(project.id, episode.id, id)); });
  const render = (withSubs: boolean) => guard("render", async () => {
    if (dirty) await api.saveAudio(project.id, episode.id, { tracks, keepOriginal: keep, originalGain: origGain });
    onChanged(await api.renderEpisode(project.id, episode.id, { subtitles: withSubs, audio: true }));
    notify({ message: withSubs ? "Subtitles and audio rendered" : "Audio rendered", tab: "series" });
  });

  // Dragging a track on the timeline changes its start.
  const dragTrack = (e: React.PointerEvent, t: AudioTrack) => {
    e.preventDefault();
    const w = bar.current?.clientWidth || 1, x0 = e.clientX, o0 = t.offset;
    const move = (ev: PointerEvent) => edit(t.id, { offset: Math.round(clamp(o0 + ((ev.clientX - x0) / w) * length, -t.duration + 0.5, length - 0.5) * 20) / 20 });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const toPlayhead = (t: AudioTrack) => edit(t.id, { offset: Math.round((video.current?.currentTime ?? 0) * 20) / 20 });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select value={scene} onChange={e => setScene(e.target.value)} className={`${field} [&_*]:bg-white [&_*]:text-black`} title="Where a new track starts">
          <option value="start">Start at the beginning</option>
          {windows.map(w => <option key={w.id} value={w.id}>Start at scene {w.number} ({fmt(w.from)})</option>)}
        </select>
        <input ref={fileRef} type="file" multiple accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.mp4,.mov,.mkv,.webm" hidden onChange={e => addFiles(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="flex items-center gap-1.5 rounded-md bg-violet-600/80 hover:bg-violet-600 disabled:opacity-40 px-3 py-1.5 font-medium text-white">
          {busy === "upload" ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}Add audio or a video's sound...
        </button>
        <span className="opacity-55">Pick a sound file, or a video - its sound is pulled out.</span>
      </div>
      <MusicMaker project={project} episode={episode} length={length} startAt={startOf} onChanged={onChanged} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,260px)_1fr]">
        <div className="space-y-2">
          <div className="mx-auto w-full max-w-[260px] overflow-hidden rounded bg-black">
            <video ref={video} src={fileUrl(episode.exportPath!)} controls onLoadedMetadata={e => setTotal(e.currentTarget.duration || 0)} className="block w-full" />
          </div>
          <p className="text-center text-[10px] opacity-55">Plays with your tracks so you can hear the timing.</p>
          {tracks.map(t => <audio key={t.id} ref={el => { audios.current[t.id] = el; }} src={fileUrl(t.file)} preload="auto" />)}
        </div>

        <div className="min-w-0 space-y-3">
          {/* the timeline */}
          <div>
            <div ref={bar} className="relative h-6 rounded bg-current/10">
              {windows.map(w => <span key={w.id} className="absolute top-0 h-full border-l border-current/20 pl-0.5 text-[8px] opacity-45" style={{ left: `${(w.from / length) * 100}%` }}>{w.number}</span>)}
              <span className="absolute top-0 h-full w-px bg-rose-500" style={{ left: `${clamp(now / length, 0, 1) * 100}%` }} />
            </div>
            {tracks.map((t, i) => (
              <div key={t.id} className="relative mt-1 h-6 overflow-hidden rounded bg-current/5">
                <div onPointerDown={e => dragTrack(e, t)} title="Drag to time it" className={`absolute top-0 flex h-full cursor-ew-resize touch-none items-center overflow-hidden rounded px-1.5 text-[10px] font-medium text-white ${COLORS[i % COLORS.length]}`}
                  style={{ left: `${(t.offset / length) * 100}%`, width: `${(t.duration / length) * 100}%`, opacity: 0.35 + clamp(t.gain, 0, 1) * 0.65 }}>
                  <span className="truncate">{t.name}</span>
                </div>
              </div>
            ))}
            {!tracks.length && <p className="mt-2 text-[11px] opacity-55">No audio yet - add a file above.</p>}
          </div>

          {/* each track */}
          {tracks.map((t, i) => (
            <div key={t.id} className="space-y-1.5 rounded-lg border border-neutral-800 p-2 text-[11px]">
              <div className="flex items-center gap-2">
                <Music size={13} className={["text-violet-400", "text-amber-400", "text-rose-400", "text-teal-400", "text-sky-400"][i % 5]} />
                <input value={t.name} onChange={e => edit(t.id, { name: e.target.value })} className={`${field} min-w-0 flex-1`} />
                <span className="font-mono opacity-55">{fmt(t.duration)} long</span>
                <button onClick={() => remove(t.id)} title="Remove this track" className="opacity-50 hover:opacity-100"><Trash2 size={13} /></button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="opacity-60">Starts at</span>
                <button onClick={() => edit(t.id, { offset: Math.round((t.offset - 0.5) * 20) / 20 })} className={`${field} px-1.5`}>-0.5</button>
                <button onClick={() => edit(t.id, { offset: Math.round((t.offset - 0.1) * 20) / 20 })} className={`${field} px-1.5`}>-0.1</button>
                <input type="number" step={0.05} value={t.offset} onChange={e => edit(t.id, { offset: Number(e.target.value) })} className={`${field} w-20`} title="Seconds from the start of the episode (negative skips the start of the track)" />
                <button onClick={() => edit(t.id, { offset: Math.round((t.offset + 0.1) * 20) / 20 })} className={`${field} px-1.5`}>+0.1</button>
                <button onClick={() => edit(t.id, { offset: Math.round((t.offset + 0.5) * 20) / 20 })} className={`${field} px-1.5`}>+0.5</button>
                <button onClick={() => toPlayhead(t)} title="Start the track where the video is now" className={`${field} flex items-center gap-1`}><Crosshair size={11} />At playhead</button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5"><span className="opacity-60">Volume {Math.round(t.gain * 100)}%</span><input type="range" min={0} max={2} step={0.05} value={t.gain} onChange={e => edit(t.id, { gain: Number(e.target.value) })} className="w-24 accent-violet-500" /></label>
                <label className="flex items-center gap-1.5"><span className="opacity-60">Fade in</span><input type="number" min={0} step={0.5} value={t.fadeIn} onChange={e => edit(t.id, { fadeIn: Number(e.target.value) })} className={`${field} w-14`} />s</label>
                <label className="flex items-center gap-1.5"><span className="opacity-60">Fade out</span><input type="number" min={0} step={0.5} value={t.fadeOut} onChange={e => edit(t.id, { fadeOut: Number(e.target.value) })} className={`${field} w-14`} />s</label>
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={keep} onChange={e => { setKeep(e.target.checked); setDirty(true); }} className="accent-violet-500" />Keep the video's own sound</label>
            {keep && <label className="flex items-center gap-1.5"><span className="opacity-60">Its volume {Math.round(origGain * 100)}%</span><input type="range" min={0} max={2} step={0.05} value={origGain} onChange={e => { setOrigGain(Number(e.target.value)); setDirty(true); }} className="w-24 accent-violet-500" /></label>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={save} disabled={!!busy || !dirty} className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs disabled:opacity-40">Save timing</button>
            <button onClick={() => render(false)} disabled={!!busy || (!tracks.length && keep)} className="flex items-center gap-1.5 rounded-md bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-40 px-3 py-1.5 text-xs font-medium text-white">
              {busy === "render" ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}Mix into the video
            </button>
            <button onClick={() => render(true)} disabled={!!busy || (!tracks.length && keep) || !wantSubtitles} title={wantSubtitles ? "Burn the subtitles in during the same pass" : "Make subtitles first"} className="flex items-center gap-1.5 rounded-md border border-emerald-600/60 px-3 py-1.5 text-xs font-medium disabled:opacity-40">
              Mix in + burn the subtitles
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
