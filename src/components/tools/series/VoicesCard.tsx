import React from "react";
import { Clapperboard, Loader2, Mic, Play, RefreshCw, X, AlertTriangle, FolderOpen } from "lucide-react";
import { useJob } from "../../train/trainApi";
import { api, fileUrl, type Episode, type Project } from "./api";
import { planEpisode, voiceStamp } from "../../../../seriesTool/voiceTrack";
import { usesAiVoice } from "../../../../seriesTool/voices";
import { notifyError } from "../../../lib/notify";
import { MINUTES_PER_RENDER, isMultiSpeaker, isTalking, pickTalkingPicture, pickTurnPicture, planTurnRenders, talkingStale } from "../../../../seriesTool/talking";

/** Develop: one person's voice sample to copy. Dia uses it for [S1] only (one sample per scene); XTTS uses every person's own. */
export function VoiceSample({ project, name, onSaved }: { project: Project; name: string; onSaved: (p: Project) => void }) {
  const key = Object.keys(project.people || {}).find(k => k.toLowerCase() === name.toLowerCase()) || name;
  const cur = project.people?.[key] || {};
  const save = async (change: { refAudio?: string; refText?: string }) => {
    const entry = { ...cur, ...change };
    if (!entry.refAudio) { delete entry.refAudio; delete entry.refText; }
    if (!entry.refText) delete entry.refText;
    const people = { ...(project.people || {}), [key]: entry };
    if (!Object.keys(entry).length) delete people[key];
    onSaved(await api.patch(project.id, { people }));
  };
  const pick = async () => {
    try {
      const r = await fetch("/api/tool/native-pick", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "files", filter: "Audio|*.wav;*.mp3;*.flac;*.m4a;*.ogg" }) });
      const d = await r.json();
      if (d.paths?.[0]) await save({ refAudio: d.paths[0] });
    } catch (e) { notifyError(e); }
  };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={pick} className="flex items-center gap-1 rounded-md border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800" title={project.voiceEngine === "xtts" ? "A clean clip (6-30 s) of the voice to copy, in any language" : "A short clip (5-15 s) of the voice to copy, in English"}><FolderOpen size={11} /> {cur.refAudio ? "Change voice sample" : "Voice sample to copy (optional)"}</button>
        {cur.refAudio && <>
          <span className="max-w-[10rem] truncate text-[10px] text-neutral-500" title={cur.refAudio}>{cur.refAudio.split(/[\\/]/).pop()}</span>
          <audio controls preload="none" src={`/api/voice/media?path=${encodeURIComponent(cur.refAudio)}`} className="h-6" />
          <button onClick={() => save({ refAudio: "" })} className="text-neutral-500 hover:text-neutral-200" title="Remove the sample"><X size={12} /></button>
        </>}
      </div>
      {cur.refAudio && project.voiceEngine !== "xtts" && <input key={cur.refText || ""} defaultValue={cur.refText || ""} placeholder="Exactly what the sample says (needed for a good copy)" onBlur={e => e.target.value.trim() !== (cur.refText || "") && save({ refText: e.target.value.trim() })} className="w-full rounded-md border border-neutral-700 bg-transparent px-2 py-1 text-[11px] focus:outline-none focus:border-sky-600" />}
    </div>
  );
}

/** Develop, Look and voice: who speaks. */
export function VoiceEnginePicker({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  const engine = project.voiceEngine === "dia" || project.voiceEngine === "xtts" ? project.voiceEngine : "model";
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">Who speaks</div>
      <div className="flex flex-wrap gap-1.5">
        {([["model", "The video model's own voice"], ["dia", "Dia (English, made in Produce)"], ["xtts", "XTTS (Hindi + more, made in Produce)"]] as const).map(([v, label]) => (
          <button key={v} onClick={async () => onSaved(await api.patch(project.id, { voiceEngine: v === "model" ? undefined : v }))}
            className={"rounded-full border px-3 py-1 text-xs transition " + (v === engine ? "border-emerald-500 bg-emerald-500/15 text-emerald-200" : "border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500")}>{label}</button>
        ))}
      </div>
      {engine === "xtts" && <p className="text-[11px] leading-relaxed text-neutral-500">XTTS speaks Hindi, English, Arabic, Chinese and 13 more languages, picked per line from its script (Devanagari is Hindi; Hindi in Latin letters is read as English, so write Hindi in Devanagari). Every person can have a voice sample (6-30 s, any language) and speaks in their own copied voice, otherwise a built-in voice; each speaker's turn is made separately and joined, so any number of speakers works. It uses the graphics card and loads the model once per episode. Voices are made in Produce and mixed in when you join in Assemble; the model's own speech in the clip is turned down to 20% and it is no longer asked to speak. A copied voice is a likeness, not exact; nobody has listened to it for you, so check each scene.</p>}
      {engine === "dia" && <p className="text-[11px] leading-relaxed text-neutral-500">Dia speaks English only, uses the graphics card, and takes about a minute for every 10 seconds of speech (plus a model load for each scene). Voices are made per episode in Produce and mixed in when you join in Assemble; the model's own speech in the clip is turned down to 20%. Without a voice sample a person sounds a little different in every scene; with one, the copy is used for the first speaker of a scene only.</p>}
    </div>
  );
}

/** Produce: make, hear and redo the Dia voice of one episode. */
export function VoicesCard({ project, episode, onChanged }: { project: Project; episode: Episode; onChanged: (p: Project) => void }) {
  const job = useJob("seriesvoice");
  const [status, setStatus] = React.useState<{ dia: { ready: boolean; missing: string[] }; xtts?: { ready: boolean; missing: string[] }; running: boolean } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const plans = React.useMemo(() => planEpisode(project, episode), [project, episode]);
  const running = job.running;
  const xt = project.voiceEngine === "xtts";
  const eng = xt ? status?.xtts : status?.dia;
  const label = xt ? "XTTS" : "Dia";
  const wasRunning = React.useRef(false);
  React.useEffect(() => { fetch("/api/voice/status").then(r => r.json()).then(setStatus).catch(() => setStatus(null)); }, [running]);
  React.useEffect(() => {
    if (running) { const t = setInterval(() => api.get(project.id).then(onChanged).catch(() => {}), 4000); return () => clearInterval(t); }
    if (wasRunning.current) api.get(project.id).then(onChanged).catch(() => {});
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { wasRunning.current = running; }, [running]);

  const start = async (sceneId?: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/series/projects/${project.id}/episodes/${episode.id}/voice`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sceneId ? { sceneId } : {}) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
    } catch (e) { notifyError(e); } finally { setBusy(false); }
  };
  const sceneOf = (id: string) => episode.scenes.find(s => s.id === id)!;
  const [talk, setTalk] = React.useState<{ ready: boolean; reason: string; warning: string } | null>(null);
  const refreshTalk = React.useCallback(() => { api.talkingStatus().then(setTalk).catch(() => setTalk({ ready: false, reason: "Could not reach the app server.", warning: "" })); }, []);
  React.useEffect(() => {
    refreshTalk();
    // ComfyUI may be started after this page opened: look again every 15 s while the button is off, and when the window is used again.
    const t = setInterval(() => { if (!document.hidden) setTalk(cur => { if (!cur?.ready) refreshTalk(); return cur; }); }, 15000);
    window.addEventListener("focus", refreshTalk);
    return () => { clearInterval(t); window.removeEventListener("focus", refreshTalk); };
  }, [episode.id, refreshTalk]);
  // The picture is picked on the server with the same function; here it only decides whether the button can work.
  // Several speakers: with XTTS turns each speaker's turn is its own render with their picture; otherwise (Dia, or a voice made before turns were kept) one picture, the first speaker's.
  const turnPlan = (sc: Episode["scenes"][number]) => (isMultiSpeaker(sc.voiceTurns) ? planTurnRenders(sc.voiceTurns!) : null);
  const manySpeakers = (sc: Episode["scenes"][number]) => new Set((sc.lines || []).map(l => (l.speaker || "").trim().toLowerCase()).filter(Boolean)).size >= 2;
  const noPicture = (id: string) => {
    const sc = sceneOf(id), tp = turnPlan(sc);
    if (tp) {
      if ("reason" in tp) return tp.reason;
      for (const r of tp.renders) { const pr = pickTurnPicture(episode.refs, sc, r.speaker, () => true); if ("reason" in pr) return pr.reason; }
      return "";
    }
    const r = pickTalkingPicture(episode.refs, sc, () => true); return "reason" in r ? r.reason : "";
  };
  const renderNote = (sc: Episode["scenes"][number]) => {
    const tp = turnPlan(sc);
    if (tp && !("reason" in tp)) return `This scene has several speakers: ${tp.renders.length} renders, one per speaker turn with that speaker's picture, about ${MINUTES_PER_RENDER} minutes each (roughly ${tp.renders.length * MINUTES_PER_RENDER} minutes in all).`;
    return manySpeakers(sc) ? `Several speakers need XTTS voices (the voice is made per turn, so the turns can be timed): this clip uses one picture, the first speaker's, for the whole scene. 1 render, about ${MINUTES_PER_RENDER} minutes.${xt ? " Make the voice again to keep the turns." : ""}` : "";
  };
  const makeTalking = async (id: string) => {
    const note = renderNote(sceneOf(id));
    if (talk?.warning && !window.confirm(`${talk.warning}${note ? `

${note}` : ""}

Make the talking video for this scene?`)) return;
    setBusy(true);
    try { await api.makeTalking(project.id, id); onChanged(await api.get(project.id)); } catch (e) { notifyError(e); } finally { setBusy(false); }
  };
  const backToNormal = async (id: string) => { try { await api.revertTalking(project.id, id); onChanged(await api.get(project.id)); } catch (e) { notifyError(e); } };
  const speakable = plans.filter(x => !x.skipped);
  const missing = speakable.filter(x => !sceneOf(x.sceneId).voiceFile).length;
  const stale = (id: string) => { const s = sceneOf(id); return !!s.voiceFile && s.voiceText !== voiceStamp(project, episode, s); };
  const tail = job.lines.filter(l => l.startsWith("[voice]") || l.startsWith("[dia]") || l.startsWith("[xtts]")).slice(-5);
  const mine = running && job.state?.label.includes(`episode ${episode.number}`);

  return (
    <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/40 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Mic size={13} className="text-emerald-400" />
        <h4 className="text-[11px] uppercase tracking-wide text-neutral-400">Voices ({label})</h4>
        <span className="text-[11px] text-neutral-500">{speakable.filter(x => sceneOf(x.sceneId).voiceFile).length} of {speakable.length} scenes voiced</span>
        <div className="flex-1" />
        {running
          ? <button onClick={() => job.stop()} className="flex items-center gap-1 rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800"><X size={12} /> Stop</button>
          : <button disabled={busy || !speakable.length || (status ? !eng?.ready : false)} onClick={() => start()} className="flex items-center gap-1 rounded-md bg-emerald-600/80 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-40">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />} {missing === 0 && speakable.length ? "Make all voices again" : "Make voices"}
          </button>}
      </div>
      {status && !eng?.ready && <div className="flex items-start gap-1.5 text-[11px] text-amber-300"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {label} is not set up: missing {(eng?.missing || ["the engine (restart the app)"]).join(", ")}.</div>}
      {running && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] text-sky-200"><Loader2 size={12} className="animate-spin" /> {job.state?.label}{job.progress?.text ? ` - ${job.progress.text}` : ""}{!mine && " (another episode)"}</div>
          <div className="h-1.5 overflow-hidden rounded bg-neutral-800"><div className="h-full rounded bg-gradient-to-r from-emerald-500 to-teal-400 transition-all" style={{ width: `${Math.max(3, job.progress?.pct || 0)}%` }} /></div>
        </div>
      )}
      {(running || tail.length > 0) && <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-1.5 text-[10px] leading-snug text-neutral-500">{tail.join("\n") || "starting..."}</pre>}
      {!running && job.state?.failed && <div className="text-[11px] text-rose-300">The last run failed - see the lines above.</div>}
      <ul className="space-y-1">
        {plans.map(x => {
          const sc = sceneOf(x.sceneId);
          return (
            <li key={x.sceneId} className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="w-12 shrink-0 text-neutral-500">Scene {x.number}</span>
              {x.skipped ? <span className="text-neutral-500">skipped: {x.skipped}</span> : <>
                {sc.voiceFile ? <audio controls preload="none" src={`${fileUrl(sc.voiceFile)}&v=${encodeURIComponent(project.updatedAt)}`} className="h-7" /> : <span className="text-neutral-500"><Play size={10} className="mr-1 inline" />not made yet (about {x.seconds} s)</span>}
                {stale(x.sceneId) && <span className="text-amber-300" title="The words, speakers or voice samples changed since this was made">out of date</span>}
                <button disabled={running || busy || sc.status === "queued" || sc.status === "running"} title={sc.status === "queued" || sc.status === "running" ? "This scene is being rendered; wait for it" : undefined} onClick={() => start(x.sceneId)} className="flex items-center gap-1 rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"><RefreshCw size={10} /> {sc.voiceFile ? "Redo" : "Make"}</button>
                {x.notes.map((n, i) => <span key={i} className="text-neutral-500">- {n}</span>)}
                {sc.voiceFile && (() => {
                  const working = sc.status === "queued" || sc.status === "running";
                  const why = !talk ? "Checking ComfyUI..." : !talk.ready ? talk.reason : noPicture(x.sceneId);
                  return <>
                    <button disabled={!!why || working || running || busy} onClick={() => makeTalking(x.sceneId)} title={why || "Make this scene a talking video: the character's picture speaks this voice with lip-sync (Wan 2.2 S2V, slow)"} className="flex items-center gap-1 rounded border border-violet-700/60 px-1.5 py-0.5 text-violet-200 hover:bg-violet-900/30 disabled:opacity-40"><Clapperboard size={10} /> {isTalking(sc) ? "Talking video again" : "Make talking video"}</button>
                    {isTalking(sc) && <span className="text-violet-300">talking clip in use</span>}
                    {talkingStale(sc) && <span className="text-amber-300">talking clip has the old voice - make it again</span>}
                    {isTalking(sc) && sc.clipBeforeTalking && <button disabled={working} onClick={() => backToNormal(x.sceneId)} className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40">Back to normal clip</button>}
                    {working && sc.promptId !== undefined && <span className="text-sky-300"><Loader2 size={10} className="mr-1 inline animate-spin" />{sc.status === "queued" ? "waiting for the graphics card" : "making the clip (see the scene card for progress)"}</span>}
                    {why && !working && <span className="text-neutral-500">{why}</span>}
                    {!why && manySpeakers(sc) && !turnPlan(sc) && <span className="text-amber-300/80">several speakers in one talking clip need XTTS voices (per-turn timing): only the first speaker's picture is used{xt ? "; redo the voice to keep the turns" : ""}</span>}
                    {!why && !!turnPlan(sc) && <span className="text-neutral-500">{renderNote(sc)}</span>}
                  </>;
                })()}
              </>}
            </li>
          );
        })}
      </ul>
      <p className="text-[10px] leading-relaxed text-neutral-600">"Make talking video" is optional and always your choice per scene: it turns the character's picture into a clip that speaks this voice with lip-sync (Wan 2.2 S2V 14B in ComfyUI). It is slow on an 8 GB card and uses the whole graphics card; such a clip already has the voice in it, so joining does not mix the voice again.</p>
      <p className="text-[10px] leading-relaxed text-neutral-600">Voices are mixed over the clips when you join the episode in Assemble (join again after making or redoing voices). The clip's own sound is turned down to 20%; a voice longer than its clip holds the last frame.</p>
    </div>
  );
}
