import React from "react";
import { CloudUpload, Check, ChevronRight, ExternalLink, File as FileIcon, FileSpreadsheet, FileText, Folder, FolderPlus, Loader2, LogOut, Presentation, Search, X, Image as ImageLucide, Film } from "lucide-react";
import { notify, notifyError } from "../../lib/notify";
import { iconBtn } from "./shared";
import { api, postJson } from "./types";

export interface GoogleStatus {
  configured: boolean; connected: boolean; email: string; autosave: boolean; folder: { id: string; name: string } | null;
  lastUpload: { at: number; file: string; ok: boolean; url?: string; error?: string } | null; redirectUri: string;
}
export interface DriveFile { id: string; name: string; mimeType: string; modifiedTime?: string; size?: string }

const FOLDER = "application/vnd.google-apps.folder";
const READABLE = /^(text\/|application\/pdf|application\/vnd\.(openxmlformats|google-apps\.(document|spreadsheet|presentation)|ms-excel|oasis)|application\/msword|application\/rtf|image\/(png|jpe?g|webp|bmp))/;

/** Status of the Google connection, polled so the toolbar can announce uploads that finish in the background. */
export function useGoogleStatus(announce = false) {
  const [st, setSt] = React.useState<GoogleStatus | null>(null);
  const lastAt = React.useRef<number | null>(null);
  const load = React.useCallback(() => api<GoogleStatus>("/api/google/status").then(s => {
    setSt(s);
    if (announce && s.lastUpload) {
      if (lastAt.current !== null && s.lastUpload.at !== lastAt.current) {
        if (s.lastUpload.ok) notify({ message: `Saved to Google Drive - ${s.lastUpload.file}`, tab: "image" });
        else notifyError(`Google Drive upload failed (${s.lastUpload.file}): ${s.lastUpload.error}`, "image");
      }
      lastAt.current = s.lastUpload.at;
    } else if (lastAt.current === null) lastAt.current = s.lastUpload?.at ?? 0;
  }).catch(() => {}), [announce]);
  React.useEffect(() => { load(); if (!announce) return; const t = setInterval(load, 5000); return () => clearInterval(t); }, [load, announce]);
  return [st, load, setSt] as const;
}

/** Client ID / secret form and the Connect button - the one-time setup with the person's own Google Cloud project. */
export function GoogleConnectPanel({ status, onChange, field }: { status: GoogleStatus; onChange: () => void; field: string }) {
  const [clientId, setClientId] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [waiting, setWaiting] = React.useState(false);
  React.useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => api<GoogleStatus>("/api/google/status").then(s => { if (s.connected) { setWaiting(false); onChange(); notify({ message: `Connected to Google${s.email ? " as " + s.email : ""}`, tab: "image" }); } }).catch(() => {}), 2000);
    const stop = setTimeout(() => setWaiting(false), 5 * 60_000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [waiting, onChange]);

  const saveClient = async () => {
    setBusy(true);
    try { await postJson("/api/google/client", { clientId, clientSecret: secret }); setSecret(""); onChange(); } catch (e: any) { notifyError(e.message, "image"); } finally { setBusy(false); }
  };
  const connect = async () => {
    setBusy(true);
    try { const { url } = await api<{ url: string }>("/api/google/connect"); window.open(url, "_blank"); setWaiting(true); } catch (e: any) { notifyError(e.message, "image"); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      {!status.configured ? (
        <>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            One-time setup with your own Google account (nothing is shared with anyone): in <b>console.cloud.google.com</b> create a project, turn on the <b>Google Drive API</b>, then <b>Credentials → Create credentials → OAuth client ID → Desktop app</b>. Paste the client ID and secret here.
          </p>
          <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Client ID" autoComplete="off" spellCheck={false} className={field} />
          <div className="relative">
            <input type={show ? "text" : "password"} value={secret} onChange={e => setSecret(e.target.value)} placeholder="Client secret" autoComplete="off" spellCheck={false} className={`${field} pr-10`} />
            <button onClick={() => setShow(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 hover:text-zinc-300">{show ? "hide" : "show"}</button>
          </div>
          <button onClick={saveClient} disabled={busy || !clientId.trim() || !secret.trim()} className="w-full py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-bold disabled:opacity-40">Save</button>
        </>
      ) : (
        <>
          <p className="text-[11px] text-zinc-400">Sign in once to read your Drive files and save results to it.</p>
          <button onClick={connect} disabled={busy || waiting} className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold disabled:opacity-60 flex items-center justify-center gap-2">
            {(busy || waiting) && <Loader2 size={13} className="animate-spin" />} {waiting ? "Waiting for you to finish in the browser..." : "Connect Google"}
          </button>
          <p className="text-[10px] text-zinc-600">If Google says the app is not verified, choose Advanced → continue: it is your own project.</p>
        </>
      )}
    </div>
  );
}

const iconFor = (f: DriveFile) => {
  if (f.mimeType === FOLDER) return <Folder size={16} className="text-amber-400" />;
  if (f.mimeType.includes("spreadsheet") || f.mimeType.includes("excel")) return <FileSpreadsheet size={16} className="text-emerald-400" />;
  if (f.mimeType.includes("presentation")) return <Presentation size={16} className="text-orange-400" />;
  if (f.mimeType.startsWith("image/")) return <ImageLucide size={16} className="text-pink-400" />;
  if (f.mimeType.startsWith("video/")) return <Film size={16} className="text-violet-400" />;
  if (f.mimeType.includes("document") || f.mimeType.includes("word") || f.mimeType.startsWith("text/") || f.mimeType.includes("pdf")) return <FileText size={16} className="text-sky-400" />;
  return <FileIcon size={16} className="text-zinc-500" />;
};

/** Browse / search Google Drive. file mode: pick a document to read prompts from. folder mode: pick where results go. */
export function DrivePicker({ open, mode, onClose, onPickFile, onPickFolder, field }: { open: boolean; mode: "file" | "folder"; onClose: () => void; onPickFile?: (f: DriveFile) => void; onPickFolder?: (f: { id: string; name: string }) => void; field: string }) {
  const [status, reload] = useGoogleStatus();
  const [stack, setStack] = React.useState<{ id: string; name: string }[]>([{ id: "root", name: "My Drive" }]);
  const [q, setQ] = React.useState("");
  const [files, setFiles] = React.useState<DriveFile[]>([]);
  const [next, setNext] = React.useState<string | undefined>();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const here = stack[stack.length - 1];

  const load = React.useCallback(async (more = false) => {
    setLoading(true); setError(null);
    try {
      const d = await api<{ files: DriveFile[]; nextPageToken?: string }>(`/api/google/files?parent=${encodeURIComponent(here.id)}&q=${encodeURIComponent(q)}&foldersOnly=${mode === "folder" ? 1 : 0}${more && next ? `&pageToken=${encodeURIComponent(next)}` : ""}`);
      setFiles(prev => more ? [...prev, ...d.files] : d.files); setNext(d.nextPageToken);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [here.id, q, mode, next]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (!open || !status?.connected) return; const t = setTimeout(() => load(false), q ? 250 : 0); return () => clearTimeout(t); }, [open, status?.connected, here.id, q, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (open) { setStack([{ id: "root", name: "My Drive" }]); setQ(""); } }, [open]);

  const newFolder = async () => {
    const name = window.prompt("Name of the new folder", "Cursed_Ai")?.trim();
    if (!name) return;
    try { await postJson("/api/google/folder", { name, parent: here.id === "root" ? undefined : here.id }); load(false); } catch (e: any) { notifyError(e.message, "image"); }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <p className="text-sm font-bold text-white flex-1">{mode === "folder" ? "Choose a Google Drive folder" : "Pick a file from Google Drive"}</p>
          <button onClick={onClose} className={iconBtn}><X size={14} /></button>
        </div>
        {!status ? <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-zinc-500" /></div> : !status.connected ? (
          <div className="p-5"><GoogleConnectPanel status={status} onChange={reload} field={field} /></div>
        ) : (
          <>
            <div className="px-5 pt-3 space-y-2">
              <div className="relative"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search all of Drive..." className={`${field} !pl-8`} /></div>
              {!q && (
                <div className="flex items-center flex-wrap gap-1 text-[11px] text-zinc-400">
                  {stack.map((s, i) => (
                    <React.Fragment key={s.id}>
                      {i > 0 && <ChevronRight size={11} className="text-zinc-600" />}
                      <button onClick={() => setStack(st => st.slice(0, i + 1))} className="hover:text-white">{s.name}</button>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 min-h-[220px] overflow-y-auto px-2 py-2">
              {error && <p className="px-3 py-2 text-xs text-red-400">{error}</p>}
              {!loading && !error && files.length === 0 && <p className="px-3 py-8 text-center text-xs text-zinc-600">{q ? "Nothing found." : "This folder is empty."}</p>}
              {files.map(f => {
                const isFolder = f.mimeType === FOLDER;
                const ok = isFolder || (mode === "file" && READABLE.test(f.mimeType));
                return (
                  <button key={f.id} disabled={!ok} onClick={() => { if (isFolder) { setQ(""); setStack(st => [...st, { id: f.id, name: f.name }]); } else onPickFile?.(f); }} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent">
                    {iconFor(f)}
                    <span className="flex-1 min-w-0 truncate text-[13px] text-zinc-200">{f.name}</span>
                    {f.modifiedTime && <span className="text-[10px] text-zinc-600 shrink-0">{new Date(f.modifiedTime).toLocaleDateString()}</span>}
                  </button>
                );
              })}
              {loading && <div className="py-4 flex justify-center"><Loader2 size={16} className="animate-spin text-zinc-500" /></div>}
              {next && !loading && <button onClick={() => load(true)} className="w-full py-2 text-xs text-zinc-400 hover:text-white">Load more</button>}
            </div>
            {mode === "folder" && (
              <div className="flex items-center gap-2 px-5 py-3 border-t border-white/10">
                <button onClick={newFolder} className={`${iconBtn} flex items-center gap-1.5 text-[11px] font-semibold`}><FolderPlus size={14} /> New folder</button>
                <button onClick={() => { onPickFolder?.({ id: here.id === "root" ? "root" : here.id, name: here.name }); onClose(); }} className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold"><Check size={13} /> Use “{here.name}”</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Toolbar button: Google Drive connection, automatic saving of every result, and the folder they go to. */
export function GoogleDriveButton() {
  const [st, reload] = useGoogleStatus(true);
  const [open, setOpen] = React.useState(false);
  const [picker, setPicker] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const field = "w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2 text-[13px] text-white focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-zinc-700";
  React.useEffect(() => {
    if (!open || picker) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, picker]);

  const set = (body: object) => postJson("/api/google/settings", body).then(() => reload()).catch((e: any) => notifyError(e.message, "image"));
  const on = !!st?.connected && st.autosave;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} title={st?.connected ? (on ? "Google Drive: saving results automatically" : "Google Drive: connected") : "Google Drive"} className={`relative ${iconBtn} !p-2.5 ${on ? "!text-emerald-400" : ""}`}>
        <CloudUpload size={15} />
        {on && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400" />}
      </button>
      {open && st && (
        <div className="absolute z-50 right-0 mt-2 w-80 rounded-2xl border border-white/15 bg-zinc-950/95 backdrop-blur p-4 space-y-3 shadow-2xl shadow-black/60">
          <p className="text-sm font-bold text-white">Google Drive</p>
          {!st.connected ? <GoogleConnectPanel status={st} onChange={reload} field={field} /> : (
            <>
              <p className="text-[11px] text-zinc-500 truncate">Connected{st.email ? ` as ${st.email}` : ""}</p>
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={st.autosave} onChange={e => set({ autosave: e.target.checked })} className="mt-0.5" />
                <span><span className="block text-[13px] text-zinc-200">Save every result to Drive automatically</span><span className="block text-[10px] text-zinc-600">Images and videos are uploaded in the background once they are made.</span></span>
              </label>
              <div className="rounded-xl bg-white/[0.04] p-2.5 flex items-center gap-2">
                <Folder size={14} className="text-amber-400 shrink-0" />
                <span className="flex-1 min-w-0 truncate text-[12px] text-zinc-300">{st.folder ? st.folder.name : "Cursed_Ai (created in My Drive)"}</span>
                <button onClick={() => setPicker(true)} className="text-[11px] text-blue-400 hover:text-blue-300">Change</button>
                {st.folder && <button onClick={() => set({ folder: null })} title="Back to the default folder" className="text-zinc-500 hover:text-white"><X size={12} /></button>}
              </div>
              {st.lastUpload && <p className={`text-[11px] flex items-center gap-1.5 ${st.lastUpload.ok ? "text-zinc-500" : "text-red-400"}`}>{st.lastUpload.ok ? <>Last: {st.lastUpload.file}{st.lastUpload.url && <a href={st.lastUpload.url} target="_blank" rel="noreferrer" className="text-blue-400"><ExternalLink size={11} /></a>}</> : st.lastUpload.error}</p>}
              <button onClick={() => postJson("/api/google/disconnect", {}).then(() => reload())} className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-red-400"><LogOut size={12} /> Disconnect</button>
            </>
          )}
        </div>
      )}
      <DrivePicker open={picker} mode="folder" field={field} onClose={() => setPicker(false)} onPickFolder={f => set({ folder: f })} />
    </div>
  );
}
