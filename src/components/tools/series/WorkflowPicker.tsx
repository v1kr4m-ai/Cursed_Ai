import React from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { api, type Project } from "./api";
import { fetchWorkflows, findWorkflow, judgeImage, judgeVideo, maxSceneRefs, suggestions, wantsPhoto, type Verdict, type WfInfo } from "./workflows";

const ICON = { ok: CheckCircle2, warn: AlertTriangle, bad: XCircle } as const;
const TONE = { ok: "text-emerald-300", warn: "text-amber-300", bad: "text-rose-300" } as const;

/** The workflows of one kind, the verdict on the chosen one and a verdict-aware list of alternatives. */
function useCheck(project: Project, kind: "image" | "video", path: string) {
  const [list, setList] = React.useState<WfInfo[] | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const load = React.useCallback((force = false) => {
    setLoading(true);
    fetchWorkflows(kind, force).then(l => { setList(l); setError(""); }).catch(e => setError(e?.message || String(e))).finally(() => setLoading(false));
  }, [kind]);
  React.useEffect(() => { load(); }, [load]);
  const photo = wantsPhoto(project), needed = maxSceneRefs(project);
  const verdict: Verdict | null = list
    ? (kind === "image" ? judgeImage(findWorkflow(list, path), path, photo) : judgeVideo(findWorkflow(list, path), path, needed))
    : null;
  const better = list && verdict && verdict.level !== "ok" ? suggestions(list, kind, { photo, needed }) : [];
  return { list, error, loading, load, verdict, better };
}

function VerdictLine({ verdict, loading, error }: { verdict: Verdict | null; loading: boolean; error: string }) {
  if (error) return <p className="text-[11px] text-amber-300">Could not read the workflow folder: {error}</p>;
  if (!verdict) return <p className="flex items-center gap-1.5 text-[11px] text-neutral-500"><Loader2 size={11} className="animate-spin" /> Checking the workflow...</p>;
  const Icon = ICON[verdict.level];
  return <p className={`flex items-start gap-1.5 text-[11px] leading-relaxed ${TONE[verdict.level]}`}>{loading ? <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin" /> : <Icon size={12} className="mt-0.5 shrink-0" />}<span>{verdict.text}</span></p>;
}

/** A workflow dropdown with its check underneath, plus one-click alternatives when the choice does not fit the series. */
export function WorkflowPicker({ project, kind, value, onChange, label }: { project: Project; kind: "image" | "video"; value: string; onChange: (path: string) => void; label: string }) {
  const { list, error, loading, load, verdict, better } = useCheck(project, kind, value);
  const current = list ? findWorkflow(list, value) : undefined;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="block text-[11px] text-neutral-500">{label}</label>
        <button onClick={() => load(true)} className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-200" title="Read the workflow folder again"><RefreshCw size={10} /> refresh</button>
      </div>
      <select value={current ? current.path : "__custom"}
        onChange={e => { if (e.target.value !== "__custom") onChange(e.target.value); }}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-100 focus:outline-none [&_*]:bg-white [&_*]:text-black">
        {!current && <option value="__custom">{value ? "Custom: " + value : "Choose a workflow..."}</option>}
        {(list || []).map(w => <option key={w.path} value={w.path}>{w.name}{w.isRunnable ? "" : "  (cannot run)"}{w.refImageCount ? `  [${w.refImageCount} ref]` : ""}</option>)}
      </select>
      <VerdictLine verdict={verdict} loading={loading} error={error} />
      {better.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
          <span>Use instead:</span>
          {better.map(w => <button key={w.path} onClick={() => onChange(w.path)} className="rounded-full border border-neutral-700 px-2.5 py-0.5 text-neutral-300 hover:border-sky-500 hover:text-sky-200" title={w.path}>{w.name.split("/").pop()} ({w.refImageCount} ref)</button>)}
        </div>
      )}
    </div>
  );
}

/** The same checks as a banner, for the places where a photo is attached or a render starts. Renders nothing while everything fits. */
export function WorkflowCheck({ project, onChanged, onOpenSettings }: { project: Project; onChanged: (p: Project) => void; onOpenSettings?: () => void }) {
  const img = useCheck(project, "image", project.settings.imageWorkflow);
  const vid = useCheck(project, "video", project.settings.videoWorkflow);
  const rows = [
    { key: "imageWorkflow" as const, title: "Stills", c: img },
    { key: "videoWorkflow" as const, title: "Clips", c: vid },
  ].filter(r => r.c.verdict && r.c.verdict.level !== "ok");
  if (!rows.length) return null;
  const pick = async (key: "imageWorkflow" | "videoWorkflow", path: string) => onChanged(await api.patch(project.id, { settings: { ...project.settings, [key]: path } }));
  return (
    <div className="space-y-2 rounded-xl border border-amber-700/50 bg-amber-950/20 p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-amber-200"><AlertTriangle size={14} /> The workflows do not fit this series yet</div>
      {rows.map(({ key, title, c }) => (
        <div key={key} className="space-y-1">
          <div className="text-[11px] text-neutral-400"><b className="text-neutral-200">{title}</b> - {project.settings[key].split(/[\\/]/).pop() || "none chosen"}</div>
          <VerdictLine verdict={c.verdict} loading={false} error="" />
          {c.better.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
              <span>Use instead:</span>
              {c.better.map(w => <button key={w.path} onClick={() => pick(key, w.path)} className="rounded-full border border-neutral-700 px-2.5 py-0.5 text-neutral-300 hover:border-sky-500 hover:text-sky-200" title={w.path}>{w.name.split("/").pop()} ({w.refImageCount} ref)</button>)}
            </div>
          )}
        </div>
      ))}
      {onOpenSettings && <button onClick={onOpenSettings} className="text-[11px] text-sky-300 hover:underline">Open the workflow settings</button>}
    </div>
  );
}
