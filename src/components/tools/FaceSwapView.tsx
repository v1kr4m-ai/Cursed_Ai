import React from "react";
import { FolderOpen, Play, ScanFace, X } from "lucide-react";
import { api, useJob } from "../train/trainApi";
import { Badge, Card, Check, JobConsole, SelectField, TrainProgress, btn, btnPrimary } from "../train/ui";

interface Status { ready: boolean; missing: string[]; swappers: string[]; enhancers: string[]; outputDir: string; results: string[]; running: boolean }

const KEY = "cursed.faceswap";
const VIDEO_RE = /\.(mp4|webm|mov|mkv|avi)$/i;
const media = (p: string) => `/api/faceswap/media?path=${encodeURIComponent(p)}`;
const name = (p: string) => p.split(/[\\/]/).pop() || p;

/** Windows' own file window; returns the picked paths (none on a phone, where there is no dialog). */
async function pick(filter: string, multi: boolean): Promise<string[]> {
  try {
    const d = await api<{ paths?: string[] }>("/api/tool/native-pick", { mode: "files", filter });
    return multi ? d.paths || [] : (d.paths || []).slice(0, 1);
  } catch { return []; }
}

function Thumb({ path, onRemove }: { path: string; onRemove?: () => void }) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/30" title={path}>
      {VIDEO_RE.test(path)
        ? <video src={media(path)} className="h-40 w-full object-contain" muted controls />
        : <img src={media(path)} alt={name(path)} className="h-40 w-full object-contain" />}
      <p className="truncate px-2 py-1 text-[10px] text-zinc-500">{name(path)}</p>
      {onRemove && <button onClick={onRemove} aria-label={`Remove ${name(path)}`} className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-zinc-300 opacity-0 hover:text-white group-hover:opacity-100"><X size={12} /></button>}
    </div>
  );
}

/** Face swap: the face from one or more photos onto a picture or a video, with FaceFusion running inside the app. */
export function FaceSwapView() {
  const [status, setStatus] = React.useState<Status | null>(null);
  const load = React.useCallback(async () => { try { setStatus(await api<Status>("/api/faceswap/status")); } catch { /* server restarting */ } }, []);
  React.useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } })();
  const [sources, setSources] = React.useState<string[]>(saved.sources || []);
  const [target, setTarget] = React.useState<string>(saved.target || "");
  const [model, setModel] = React.useState<string>(saved.model || "");
  const [enhancer, setEnhancer] = React.useState<string>(saved.enhancer || "");
  const [allFaces, setAllFaces] = React.useState<boolean>(!!saved.allFaces);
  const [error, setError] = React.useState("");
  React.useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ sources, target, model, enhancer, allFaces })); } catch { /* storage blocked */ } }, [sources, target, model, enhancer, allFaces]);
  const job = useJob("faceswap");
  const wasRunning = React.useRef(false);
  React.useEffect(() => { if (wasRunning.current && !job.running) load(); wasRunning.current = job.running; }, [job.running, load]);

  const start = async () => {
    setError("");
    try { await api("/api/faceswap/start", { sources, target, model: model || undefined, enhancer: enhancer || undefined, allFaces }); }
    catch (e: any) { setError(e.message); }
  };
  const swappers = status?.swappers || [];
  const latest = status?.results?.[0];

  return (
    <div className="glass flex h-full flex-1 flex-col overflow-hidden rounded-[2.5rem]">
      <div className="flex h-20 shrink-0 items-center justify-between gap-4 border-b border-white/5 px-8">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5"><ScanFace size={22} className="text-violet-400" /></div>
          <div className="min-w-0"><h1 className="text-lg font-bold leading-none tracking-tight text-white">Face Swap</h1><p className="mt-1 truncate text-[11px] text-zinc-500">Put a face from your photos onto a picture or a video (FaceFusion, on your GPU)</p></div>
        </div>
        <Badge ok={status ? status.ready : null} title={status?.missing.length ? `Missing: ${status.missing.join(", ")}` : "FaceFusion and its environment were found"}>{status ? (status.ready ? "ready" : "not set up") : "checking"}</Badge>
      </div>
      <TrainProgress jobs={[{ title: "Face swap", job }]} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-6 xl:grid-cols-2">
        <div className="space-y-4">
          <Card title="1 The face to use" right={<button className={btn} onClick={async () => { const p = await pick("Images|*.png;*.jpg;*.jpeg;*.webp;*.bmp", true); if (p.length) setSources(s => [...new Set([...s, ...p])]); }}><FolderOpen size={14} />Add photos</button>}
            info={{ job: "The person whose face is put in.", why: "Several clear photos of the same face (front, a little to the side) give a steadier, more like-for-like result than one." }}>
            {sources.length ? <div className="grid grid-cols-3 gap-2">{sources.map(p => <Thumb key={p} path={p} onRemove={() => setSources(s => s.filter(x => x !== p))} />)}</div>
              : <p className="text-xs text-zinc-500">No photo yet. Add one or more photos of the face.</p>}
          </Card>
          <Card title="2 Put it on" right={<button className={btn} onClick={async () => { const p = await pick("Pictures and videos|*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.mp4;*.webm;*.mov;*.mkv;*.avi", false); if (p[0]) setTarget(p[0]); }}><FolderOpen size={14} />Choose picture or video</button>}
            info={{ job: "The picture or video whose face is replaced.", why: "Everything else - hair, body, background, motion and sound - stays as it is." }}>
            {target ? <Thumb path={target} onRemove={() => setTarget("")} /> : <p className="text-xs text-zinc-500">Nothing chosen yet.</p>}
          </Card>
          <Card title="3 Settings" info={{ job: "How the swap is done.", why: "The model decides sharpness; the enhancer cleans up the new face.", settings: [
            ["Swap model", "hyperswap_1a_256 works at 256 px and keeps the most detail; inswapper_128 is softer but very steady on video."],
            ["Face enhancer", "Sharpens the swapped face (GFPGAN / CodeFormer). Only offered when its model file is in faceswap/facefusion/.assets/models; it makes skin smoother and the run slower."],
            ["Every face", "Off: only the first face found is replaced. On: every face in the picture gets the new face."],
          ] }}>
            <div className="space-y-3">
              <SelectField label="Swap model" value={model || swappers[0] || ""} onChange={setModel} options={swappers.map(m => ({ value: m, label: m }))} empty="No swap model found" />
              <SelectField label="Face enhancer" value={enhancer} onChange={setEnhancer} options={[{ value: "", label: "None" }, ...(status?.enhancers || []).map(m => ({ value: m, label: m }))]} />
              <Check label="Replace every face, not just the first" checked={allFaces} onChange={setAllFaces} />
              <div className="flex items-center gap-3">
                <button className={btnPrimary} disabled={!status?.ready || !sources.length || !target || job.running} onClick={start}><Play size={14} />Swap face</button>
                <span className="text-[11px] text-zinc-500">A picture takes about 30 s (the very first run longer); a video about 1-3 s per frame.</span>
              </div>
              {error && <p className="text-xs text-rose-400">{error}</p>}
              {status && !status.ready && <p className="text-xs text-amber-300">Missing: {status.missing.join(", ")}. See the README section on Face Swap for setting it up.</p>}
            </div>
          </Card>
        </div>
        <div className="flex min-h-0 flex-col gap-4">
          <Card title="Result" right={status?.outputDir && <button className={btn} onClick={() => api("/api/faceswap/open-folder", {}).catch(() => {})}><FolderOpen size={14} />Open folder</button>}>
            {latest ? (VIDEO_RE.test(latest)
              ? <video key={latest} src={media(latest)} className="max-h-[50vh] w-full rounded-xl object-contain" controls />
              : <img key={latest} src={media(latest)} alt="Latest face swap" className="max-h-[50vh] w-full rounded-xl object-contain" />)
              : <p className="text-xs text-zinc-500">Results show up here and are saved in outputs/faceswap.</p>}
            {(status?.results.length || 0) > 1 && <div className="mt-3 grid grid-cols-4 gap-2">{status!.results.slice(1, 13).map(p => <Thumb key={p} path={p} />)}</div>}
          </Card>
          <JobConsole job={job} title="Log" idle="What FaceFusion prints shows up here." />
        </div>
      </div>
    </div>
  );
}
