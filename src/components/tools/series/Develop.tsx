import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Send, Sparkles, Loader2, FileJson, Lightbulb, Users, Palette, StickyNote, Bot, User, ImagePlus, FileText, Wand2, Cpu, Cloud, Tag, Type, Brush, Clapperboard, Plus } from "lucide-react";
import { SERIES_FORMATS, formatOf, type SeriesFormat } from "../../../../seriesTool/formats";
import type { AIModel } from "../../../types";
import { MicStatus } from "../../voice/MicStatus";
import { MicModeButton } from "../../voice/MicModeButton";
import { useDictation } from "../../../services/useDictation";
import { savedSetting } from "../../../lib/settingsStore";
import { notify } from "../../../lib/notify";
import { api, askModel, extractJson, fileUrl, type Project } from "./api";
import { RefDrop } from "./RefDrop";
import { seriesPhotos, syncPhotos } from "./photos";
import { kindOf, refKindInfo } from "../../../../seriesTool/refKinds";
import { WorkflowCheck } from "./WorkflowPicker";
import { planProblems, tidyPlan } from "./planCheck";
import { StorySources } from "./StorySources";
import { DIGEST_THRESHOLD, digestDocument, type DigestProgress } from "./chunk";

/**
 * Stage 1. Describe the idea, argue it out with a model (local or cloud), then turn the
 * conversation into a structured plan of episodes and scenes.
 *
 * The discussion is saved with the project, so the reasoning behind the series is still there
 * months later when an episode needs rewriting.
 */

const EPISODE_SHAPE = `{
    "number": 1,
    "title": "Episode title",
    "era": "what this episode covers",
    "hookOut": "closing line that pulls the viewer to the next episode",
    "refs": [
      { "name": "style_plate", "role": "style", "prompt": "image prompt for the look of this episode", "negative": "what to avoid" },
      { "name": "character_name", "role": "character", "prompt": "image prompt for this character", "negative": "what to avoid" }
    ],
    "scenes": [
      { "number": 1, "vo": "(write this scene's own line here)", "shot": "(write this scene's own shot here)", "textCard": "", "refs": ["style_plate", "character_name"] }
    ]
  }`;

function rulesFor(fmt: SeriesFormat) {
  const lineRule = fmt.speech === "none"
    ? `- The "vo" line is only a short note (${fmt.lineWords} words) for the editor: nothing is spoken in the clip.`
    : `- Every "vo" line is ${fmt.lineWords} words: it is ${fmt.speech === "voiceover" ? "spoken over" : fmt.speech === "sung" ? "sung during" : "said on camera in"} one short clip.`;
  return `Video style: ${fmt.label}. ${fmt.plan}
Rules:
- Every episode gets exactly one ref with role "style" named "style_plate", listed first in every scene's refs.
- 8 scenes per episode unless we agreed otherwise.
${lineRule}
- A good shot looks like this (do not copy it, write your own for every scene): "${fmt.shotExample}". The "vo" is: ${fmt.lineHint}
- Every scene needs a real, specific "shot" (what the camera sees and what the person does) and a real "vo". Never leave them empty and never repeat the same text in two fields.
- Always leave "textCard" empty. Subtitles and captions are added later by the editor, never inside the clips.
- Image prompts should describe a photographic still, with lighting and grade, not a character sheet.
- If a person must look exactly like an attached reference photo, give them a "character" ref and mention the photo in its prompt.
- Scene "refs" lists ref names from the same episode, style_plate first.`;
}

/** Asks for the whole plan: every episode of the season, or exactly `count` of them. */
function planInstruction(fmt: SeriesFormat, count: number) {
  return `Turn our discussion into a production plan and reply with JSON only - no commentary, no code fences.
${count > 0 ? `Write exactly ${count} episode${count > 1 ? "s" : ""}.` : "Write every episode we discussed."}

Shape - a JSON array of episodes:
[
  ${EPISODE_SHAPE}
]

${rulesFor(fmt)}`;
}

/** Asks for one more episode that carries on from the ones already planned. */
function nextEpisodeInstruction(fmt: SeriesFormat, project: Project, direction: string) {
  const number = (project.episodes[project.episodes.length - 1]?.number || 0) + 1;
  const recap = project.episodes.map(e => `Episode ${e.number} "${e.title}" (${e.era || "no period"}): ${e.scenes.slice(0, 2).map(sc => sc.vo).filter(Boolean).join(" / ")}${e.hookOut ? ` - ends with: ${e.hookOut}` : ""}`).join("\n");
  return `Write the NEXT episode, number ${number}, and reply with JSON only - no commentary, no code fences.
Carry on from what is already planned, and pick up the closing hook of the last episode.

Already planned:
${recap || "(nothing yet)"}

${direction.trim() ? `What I want in this episode: ${direction.trim()}
` : ""}
Shape - one JSON object (a single episode, not an array):
${EPISODE_SHAPE.replace('"number": 1', `"number": ${number}`)}

${rulesFor(fmt)}`;
}

/** The plan the page already holds, written back in the shape the planner uses, so one more episode can be added without losing renders. */
function planJson(project: Project) {
  return project.episodes.map(e => ({
    number: e.number, title: e.title, era: e.era, hookOut: e.hookOut,
    refs: e.refs.map(r => ({ name: r.name, role: r.role, prompt: r.prompt, negative: r.negative, seed: r.seed })),
    scenes: e.scenes.map(sc => ({ number: sc.number, vo: sc.vo, shot: sc.shot, textCard: sc.textCard, seed: sc.seed, refs: sc.refIds.map(id => e.refs.find(r => r.id === id)?.name).filter(Boolean) })),
  }));
}

const field = "w-full bg-neutral-900/60 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-500 transition-colors";

const IDEA_FIELDS = [
  { key: "logline" as const, icon: Lightbulb, color: "text-amber-400", placeholder: "Logline - what is this series, in one line?" },
  { key: "audience" as const, icon: Users, color: "text-sky-400", placeholder: "Audience" },
  { key: "tone" as const, icon: Palette, color: "text-violet-400", placeholder: "Tone (e.g. cold documentary)" },
];

const FILL_INSTRUCTION = `From our discussion, fill in the series details and reply with JSON only - no commentary.
{
  "title": "short series title",
  "niche": "the niche or subject area, a few words",
  "logline": "what the series is, in one line",
  "audience": "who it is for",
  "tone": "tone / mood in a few words",
  "style": "the visual style: look, lighting, colour grade, camera feel - one or two sentences",
  "notes": "constraints, things to avoid, anything else we agreed"
}
Use what we actually agreed. Use an empty string for anything we have not discussed.`;

const REFUSAL = /^(i'?m sorry|i am sorry|sorry,|i can('|no)?t (assist|help|do that|comply)|i cannot (assist|help|comply))/i;

const TALK_MODEL_KEY = "cursed.series.talkModel";

export function Develop({ project, modelId, models, onSaved, focusAdd }: { project: Project; modelId?: string; models?: AIModel[]; onSaved: (p: Project) => void; focusAdd?: boolean }) {
  const episodesCard = React.useRef<HTMLDivElement>(null);
  // Arriving from "Add the next episode" on the Produce board: bring that card into view.
  React.useEffect(() => { if (focusAdd) setTimeout(() => episodesCard.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 350); }, [focusAdd]);
  const [talkModel, setTalkModel] = React.useState<string>(() => { try { return localStorage.getItem(TALK_MODEL_KEY) || ""; } catch { return ""; } });
  const ready = (models || []).filter(m => m.isDownloaded);
  const isOnline = (m: AIModel) => /[:-]cloud$/i.test(m.id) || m.source === "gemini" || !!m.tags?.some(t => /^cloud$/i.test(t));
  const offline = ready.filter(m => !isOnline(m)).map(m => ({ id: m.id, name: m.name }));
  const online = ready.filter(isOnline).map(m => ({ id: m.id, name: m.name }));
  const known = [...offline, ...online].some(m => m.id === talkModel);
  const model = known && talkModel ? talkModel : modelId;
  const pickModel = (id: string) => { setTalkModel(id); try { localStorage.setItem(TALK_MODEL_KEY, id); } catch { /* storage blocked */ } };
  const [idea, setIdea] = React.useState(project.idea);
  const [title, setTitle] = React.useState(project.title);
  const [style, setStyle] = React.useState(project.styleLock || "");
  const [filling, setFilling] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [messages, setMessages] = React.useState(project.discussion);
  const [streaming, setStreaming] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [planning, setPlanning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rawPlan, setRawPlan] = React.useState("");
  const [episodeCount, setEpisodeCount] = React.useState(0);
  const [direction, setDirection] = React.useState("");
  const [addingNext, setAddingNext] = React.useState(false);
  const [pendingPhotos, setPendingPhotos] = React.useState<File[]>([]);
  const fmt = formatOf(project.format);
  const [showRaw, setShowRaw] = React.useState(false);
  const [showAttach, setShowAttach] = React.useState(false);
  const [showStory, setShowStory] = React.useState(true);
  const [digesting, setDigesting] = React.useState<{ name: string; done: number; total: number } | null>(null);
  const [voicePref, setVoicePref] = React.useState(() => savedSetting("voiceEngine", "auto" as const));
  const scroller = React.useRef<HTMLDivElement>(null);

  const dictation = useDictation(input, setInput, voicePref);

  React.useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [messages, streaming]);

  const sources = project.sources || [];
  // A plan can come from a conversation, from a story written elsewhere, or from just a logline.
  const planReady = messages.length > 0 || sources.length > 0 || idea.logline.trim().length > 0;
  const planBlockedWhy = planReady ? "" : "Add a logline, attach a story, or talk it through first.";
  const firstEpisode = project.episodes[0];
  const attachedRefs = project.episodes.flatMap(e => e.refs).filter(r => r.file);

  const systemPrompt =
    `You are helping plan a short-form video series for YouTube Shorts / Reels. ` +
    `Video style: ${formatOf(project.format).label} - ${formatOf(project.format).blurb} ` +
    `Each episode is about eight 7-second vertical clips with one ${formatOf(project.format).lineLabel.toLowerCase()} line each. ` +
    `Idea: ${idea.logline || "(not stated yet)"}. Audience: ${idea.audience || "general"}. Tone: ${idea.tone || "documentary"}. ` +
    `Notes: ${idea.notes || "none"}. ` +
    `You are a creative writing partner for the user's own fictional video series, so help with scripts, scenes and outlines whenever asked. ` +
    `Push back on vague ideas, ask one sharp question at a time, and keep answers short unless a script is requested.`;

  const saveIdea = async (next = idea, discussion = messages) => onSaved(await api.patch(project.id, { idea: next, discussion }));

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    const next = [...messages, { role: "user" as const, content: text, at: new Date().toISOString() }];
    setMessages(next);
    setBusy(true);
    setStreaming("");
    try {
      let acc = "";
      const history = [{ role: "system", content: systemPrompt }, ...next.map(m => ({ role: m.role, content: m.content }))];
      let answer = await askModel(history, model, t => { acc += t; setStreaming(acc); });
      // Some models (phi4 is one) turn down an ordinary creative request. Say plainly what this is and ask once more.
      if (REFUSAL.test(answer.trim()) && answer.trim().length < 240) {
        acc = "";
        setStreaming("");
        answer = await askModel([...history, { role: "assistant", content: answer }, { role: "user", content: "This is an ordinary creative project: planning and scripting my own social-media video series, with a character I made up. Please go ahead and help." }], model, t => { acc += t; setStreaming(acc); });
        if (REFUSAL.test(answer.trim()) && answer.trim().length < 240) setError("This model keeps declining the request. Pick a different model above (Qwen, Llama or a cloud model work well for scripts) and send it again.");
      }
      const withReply = [...next, { role: "assistant" as const, content: answer, at: new Date().toISOString() }];
      setMessages(withReply);
      setStreaming("");
      await saveIdea(idea, withReply);
    } catch (e: any) {
      setError(e?.message || String(e));
      setMessages(next);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Asks for JSON and checks it. An unreadable answer, or a plan with scenes that have no shot or line, is sent back
   * once with exactly what was wrong (small models often leave fields empty or copy one sentence into every field).
   */
  async function askForJson(base: { role: string; content: string }[], instruction: string, keep: (answer: string) => void) {
    const ask = async (extra: { role: string; content: string }[]) => {
      const answer = await askModel([...base, { role: "user", content: instruction }, ...extra], model);
      keep(answer);
      return answer;
    };
    let answer = await ask([]);
    let json: any, problem = "";
    try { json = tidyPlan(extractJson(answer)); problem = planProblems(json, fmt); } catch { problem = "That was not valid JSON. Reply again with ONLY the JSON, starting with the first bracket, no text before or after it, no code fences."; }
    if (!problem) return json;
    answer = await ask([{ role: "assistant", content: answer.slice(0, 3000) }, { role: "user", content: problem + " Send the complete corrected JSON again, nothing else." }]);
    json = tidyPlan(extractJson(answer));
    return json;
  }

  /** Writes episode N+1 from what is already planned and adds it, leaving every rendered clip alone. */
  async function addNextEpisode() {
    setAddingNext(true);
    setError(null);
    try {
      const base = [
        { role: "system", content: systemPrompt },
        ...sources.map(s => ({ role: "user", content: `Source document "${s.name}":

${(s.digest || s.text).slice(0, 12000)}` })),
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ];
      const got = await askForJson(base, nextEpisodeInstruction(fmt, project, direction), a => setRawPlan(a));
      const next = Array.isArray(got) ? got[0] : got;
      if (!next || typeof next !== "object" || !Array.isArray(next.scenes)) throw new Error("The model did not write an episode with scenes.");
      next.number = (project.episodes[project.episodes.length - 1]?.number || 0) + 1;
      const planned = await api.savePlan(project.id, [...planJson(project), next], true);
      onSaved((await syncPhotos(planned)).project);
      setDirection("");
      notify({ message: `Episode ${next.number} added - open Produce to render it`, tab: "series" });
    } catch (e: any) {
      setError(e?.message || String(e));
      setShowRaw(true);
    } finally {
      setAddingNext(false);
    }
  }

  async function buildPlan() {
    setPlanning(true);
    setError(null);
    try {
      // A long document is summarised chunk by chunk first, once, and the digest is kept.
      const prepared: { name: string; body: string }[] = [];
      for (const s of sources) {
        if (s.text.length <= DIGEST_THRESHOLD) {
          prepared.push({ name: s.name, body: s.text });
          continue;
        }
        if (s.digest) {
          prepared.push({ name: s.name, body: s.digest });
          continue;
        }
        const digest = await digestDocument(
          s.text,
          prompt => askModel([{ role: "user", content: prompt }], model),
          (p: DigestProgress) => setDigesting({ name: s.name, done: p.done, total: p.total }),
        );
        await api.setSourceDigest(project.id, s.id, digest);
        prepared.push({ name: s.name, body: digest });
      }
      setDigesting(null);

      // Story documents go in ahead of the discussion so the model treats them as the source.
      const storyBlocks = prepared.map(s => ({
        role: "user" as const,
        content: `Source document "${s.name}":\n\n${s.body}`,
      }));
      const base = [
        { role: "system", content: systemPrompt },
        ...storyBlocks,
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ];
      const episodes = await askForJson(base, planInstruction(fmt, episodeCount), a => setRawPlan(a));
      // Asked for one episode, a model often sends the episode itself rather than a list of one.
      const list = Array.isArray(episodes) ? episodes : Array.isArray(episodes?.episodes) ? episodes.episodes : episodes && typeof episodes === "object" && Array.isArray(episodes.scenes) ? [episodes] : null;
      if (!list) throw new Error("The plan must be a list of episodes.");
      // Photos picked before the plan existed are attached now, and every episode gets the series photos.
      const planned = await api.savePlan(project.id, list);
      const synced = await syncPhotos(planned, pendingPhotos);
      setPendingPhotos([]);
      onSaved(synced.project);
    } catch (e: any) {
      setError(e?.message || String(e));
      setShowRaw(true);
    } finally {
      setPlanning(false);
      setDigesting(null);
    }
  }

  async function saveDetails(next: { title?: string; style?: string; idea?: typeof idea }) {
    const patch: Record<string, unknown> = { discussion: messages };
    if (next.idea) patch.idea = next.idea;
    if (next.title !== undefined && next.title.trim()) patch.title = next.title.trim();
    if (next.style !== undefined) patch.styleLock = next.style;
    onSaved(await api.patch(project.id, patch as any));
  }

  /** Reads the discussion back and puts title, niche, logline, audience, tone, style and notes into the fields. */
  async function fillFromDiscussion() {
    setFilling(true);
    setError(null);
    try {
      const answer = await askModel(
        [
          { role: "system", content: systemPrompt },
          ...sources.map(s => ({ role: "user", content: `Source document "${s.name}":\n\n${(s.digest || s.text).slice(0, 12000)}` })),
          ...messages.map(m => ({ role: m.role, content: m.content })),
          { role: "user", content: FILL_INSTRUCTION },
        ],
        model,
      );
      const d = extractJson(answer);
      if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("The model did not return the details.");
      const pick = (v: unknown, keep: string) => (typeof v === "string" && v.trim() ? v.trim() : keep);
      const nextIdea = { ...idea, niche: pick(d.niche, idea.niche || ""), logline: pick(d.logline, idea.logline), audience: pick(d.audience, idea.audience), tone: pick(d.tone, idea.tone), notes: pick(d.notes, idea.notes) };
      const nextTitle = pick(d.title, title), nextStyle = pick(d.style, style);
      setIdea(nextIdea); setTitle(nextTitle); setStyle(nextStyle);
      await saveDetails({ title: nextTitle, style: nextStyle, idea: nextIdea });
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setFilling(false); }
  }

  async function savePastedPlan() {
    setError(null);
    try {
      onSaved(await api.savePlan(project.id, extractJson(rawPlan)));
      setShowRaw(false);
    } catch (e: any) { setError(e?.message || String(e)); }
  }

  return (
    <div className="grid lg:grid-cols-[380px_1fr] gap-4 h-full min-h-0">
      {/* left: the idea, attachments, and the button that turns talk into a plan */}
      <div className="space-y-3 overflow-y-auto pr-1">
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-neutral-800 bg-gradient-to-b from-neutral-900/70 to-neutral-900/30 p-4 space-y-3"
        >
          <h3 className="flex items-center gap-2 text-sm font-medium text-neutral-200">
            <Lightbulb size={14} className="text-amber-400" /> The idea
          </h3>
          <div className="relative">
            <Type size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-rose-400 pointer-events-none" />
            <input className={`${field} pl-8`} placeholder="Series title" value={title} onChange={e => setTitle(e.target.value)} onBlur={() => saveDetails({ title })} />
          </div>
          <div className="relative">
            <Tag size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-teal-400 pointer-events-none" />
            <input className={`${field} pl-8`} placeholder="Niche (e.g. ancient history, true crime)" value={idea.niche || ""} onChange={e => setIdea({ ...idea, niche: e.target.value })} onBlur={() => saveIdea()} />
          </div>
          {IDEA_FIELDS.map(({ key, icon: Icon, color, placeholder }) => (
            <div key={key} className="relative">
              <Icon size={13} className={`absolute left-3 top-1/2 -translate-y-1/2 ${color} pointer-events-none`} />
              <input className={`${field} pl-8`} placeholder={placeholder} value={idea[key]} onChange={e => setIdea({ ...idea, [key]: e.target.value })} onBlur={() => saveIdea()} />
            </div>
          ))}
          <div className="relative">
            <Brush size={13} className="absolute left-3 top-3 text-fuchsia-400 pointer-events-none" />
            <textarea className={`${field} pl-8 h-16 resize-none`} placeholder="Visual style (look, lighting, colour grade)" value={style} onChange={e => setStyle(e.target.value)} onBlur={() => saveDetails({ style })} />
          </div>
          <div className="relative">
            <StickyNote size={13} className="absolute left-3 top-3 text-emerald-400 pointer-events-none" />
            <textarea className={`${field} pl-8 h-24 resize-none`} placeholder="Constraints, sources, things to avoid" value={idea.notes} onChange={e => setIdea({ ...idea, notes: e.target.value })} onBlur={() => saveIdea()} />
          </div>
        </motion.div>

        {/* what kind of video: sets how lines are written, spoken and prompted */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.02 }}
          className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-medium text-neutral-200">
            <Clapperboard size={14} className="text-sky-400" /> Video style
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {SERIES_FORMATS.map(f => (
              <button key={f.id} onClick={async () => onSaved(await api.patch(project.id, { format: f.id, discussion: messages }))} title={f.blurb}
                className={"rounded-full border px-3 py-1 text-xs transition " + (fmt.id === f.id ? "border-sky-500 bg-sky-500/15 text-sky-200" : "border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500")}>
                {f.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-neutral-500">{fmt.blurb} Each scene has one <span className="text-neutral-300">{fmt.lineLabel.toLowerCase()}</span>. Change the style, then build the plan again (renders you already made are kept).</p>
          {(fmt.id === "ugc" || fmt.id === "vlog") && (
            <ol className="list-decimal space-y-0.5 rounded-lg border border-sky-900/50 bg-sky-950/20 py-2 pl-7 pr-3 text-[11px] leading-relaxed text-sky-200/80">
              <li>Attach the person's photo under <b>Reference images</b> below.</li>
              <li>Build the episode plan. Each scene is written for the person talking to the camera.</li>
              <li>On Produce, render the stills first: they are made from your photo, so they look like the same person. Then render the clips, which are animated from those stills.</li>
            </ol>
          )}
          <label className="flex items-start gap-2 text-[11px] text-neutral-400">
            <input type="checkbox" className="mt-0.5" checked={!!project.allowTextCards} onChange={async e => onSaved(await api.patch(project.id, { allowTextCards: e.target.checked, discussion: messages }))} />
            <span>Write on-screen text cards into the video. Leave this off to get clean clips: subtitles and captions are added afterwards in Assemble.</span>
          </label>
        </motion.div>

        <button onClick={fillFromDiscussion} disabled={filling || busy || !planReady} title={planReady ? "Reads the conversation and fills in the title, niche, style and the rest" : "Talk it through first"}
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900/60 hover:bg-neutral-800/80 disabled:opacity-40 px-4 py-2.5 text-sm font-medium text-neutral-100 transition">
          {filling ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} className="text-fuchsia-400" />}
          {filling ? "Filling in the details..." : "Fill the details from our discussion"}
        </button>
        <div className="flex items-center gap-2 px-1 text-xs text-neutral-400">
          <span>Episodes to write</span>
          <select value={episodeCount} onChange={e => setEpisodeCount(Number(e.target.value))} className="rounded-md border border-neutral-700 bg-transparent px-2 py-1 text-xs focus:outline-none [&_*]:bg-white [&_*]:text-black">
            <option value={0}>All we discussed</option>
            {[1, 2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <motion.button
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          whileHover={{ scale: planning || busy || !planReady ? 1 : 1.015 }}
          whileTap={{ scale: 0.985 }}
          onClick={buildPlan}
          title={planBlockedWhy}
          disabled={planning || busy || !planReady}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-emerald-950/40 transition"
        >
          <motion.span animate={planning ? { rotate: 360 } : { rotate: 0 }} transition={planning ? { repeat: Infinity, duration: 1.1, ease: "linear" } : { duration: 0.2 }}>
            {planning ? <Loader2 size={16} /> : <Sparkles size={16} />}
          </motion.span>
          {digesting
            ? `Reading ${digesting.name} (${digesting.done}/${digesting.total})`
            : planning ? "Writing the plan..." : "Build the episode plan"}
        </motion.button>
        <p className="px-1 text-xs text-neutral-500">
          {planBlockedWhy || "Turns the story and discussion into episodes, scenes and reference stills. Running it again keeps clips you have already rendered."}
        </p>

        {/* the season so far, and the way to add the next episode */}
        <motion.div ref={episodesCard} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}
          className={"rounded-xl border bg-neutral-900/40 p-4 space-y-3 " + (focusAdd ? "border-emerald-600/70" : "border-neutral-800")}>
          <h3 className="flex items-center gap-2 text-sm font-medium text-neutral-200">
            <Clapperboard size={14} className="text-emerald-400" /> Episodes
            <span className="ml-auto text-[11px] text-neutral-500">{project.episodes.length} planned</span>
          </h3>
          {project.episodes.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-neutral-500">Nothing planned yet. Build the episode plan above first. After that, this is where you add each next episode.</p>
          ) : (
            <>
              <ol className="space-y-1">
                {project.episodes.map(e => (
                  <li key={e.id} className="flex items-center gap-2 rounded-lg bg-neutral-900/60 px-2.5 py-1.5 text-xs text-neutral-300">
                    <span className="w-5 shrink-0 text-neutral-500">{e.number}</span>
                    <span className="min-w-0 flex-1 truncate">{e.title}</span>
                    <span className="shrink-0 text-[10px] text-neutral-600">{e.scenes.filter(sc => sc.status === "done").length}/{e.scenes.length} clips</span>
                  </li>
                ))}
              </ol>
              <textarea className={field + " h-16 resize-none text-xs"} value={direction} onChange={e => setDirection(e.target.value)} placeholder="Next episode: what should happen? (optional - leave empty to let the model carry on from the last hook)" />
              <button onClick={addNextEpisode} disabled={addingNext || planning || busy}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-emerald-700/60 bg-emerald-600/15 hover:bg-emerald-600/25 disabled:opacity-40 px-4 py-2.5 text-sm font-medium text-emerald-100 transition">
                {addingNext ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                {addingNext ? "Writing the episode..." : "Write episode " + ((project.episodes[project.episodes.length - 1]?.number || 0) + 1)}
              </button>
              <p className="text-[11px] leading-relaxed text-neutral-500">Adds one more episode after the last one, using the story so far. Nothing already rendered is touched. Then open Produce to render its stills and clips.</p>
            </>
          )}
        </motion.div>

        <AnimatePresence>
          {digesting && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden rounded-lg border border-violet-900/60 bg-violet-950/30 p-3">
              <div className="text-[11px] text-violet-200">Summarising "{digesting.name}" so the whole story reaches the planner</div>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-neutral-800">
                <motion.div className="h-full rounded bg-gradient-to-r from-violet-500 to-fuchsia-400"
                  animate={{ width: `${digesting.total ? (digesting.done / digesting.total) * 100 : 0}%` }} transition={{ ease: "linear" }} />
              </div>
              <div className="mt-1 text-[10px] text-neutral-500">Done once per document - the summary is saved with the project.</div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
          className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <button onClick={() => setShowStory(s => !s)} className="flex w-full items-center gap-2 text-sm font-medium text-neutral-200">
            <FileText size={14} className="text-violet-400" /> Story material
            <span className="ml-auto text-[11px] text-neutral-500">{sources.length} attached</span>
          </button>
          <AnimatePresence initial={false}>
            {showStory && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <StorySources project={project} onChanged={onSaved} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* reference photos: attached once, used by every episode, scene and still */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <button onClick={() => setShowAttach(s => !s)} className="flex w-full items-center gap-2 text-sm font-medium text-neutral-200">
            <ImagePlus size={14} className="text-pink-400" /> Reference photos
            <span className="ml-auto text-[11px] text-neutral-500">{seriesPhotos(project).length + pendingPhotos.length} attached</span>
          </button>
          <p className="text-[11px] leading-relaxed text-neutral-500">Attach the person's photo (or a look to match) once. It is copied into every episode, also the ones you add later, and used wherever a still or clip needs it.</p>
          <AnimatePresence initial={false}>
            {(showAttach || seriesPhotos(project).length + pendingPhotos.length === 0) && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-3 overflow-hidden">
                {firstEpisode ? (
                  <RefDrop project={project} episodeId={firstEpisode.id} onChanged={async p => { onSaved(p); const r = await syncPhotos(p); if (r.copied || r.wired) onSaved(r.project); }} />
                ) : (
                  <label className="block cursor-pointer rounded-lg border border-dashed border-neutral-600 bg-neutral-900/40 p-4 text-center text-xs text-neutral-400 hover:bg-neutral-900/70">
                    Choose photos now - they are attached as soon as the plan exists
                    <input type="file" accept="image/*" multiple className="hidden" onChange={e => { setPendingPhotos(p => [...p, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
                  </label>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          {(seriesPhotos(project).length > 0 || pendingPhotos.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {seriesPhotos(project).slice(0, 12).map(r => (
                <div key={r.id} className="w-14 text-center"><img src={fileUrl(r.file!)} title={r.name} alt={r.name} className="h-14 w-14 rounded object-cover border border-neutral-700" /><div className="truncate text-[9px] text-neutral-500" title={refKindInfo(kindOf(r))!.label}>{refKindInfo(kindOf(r))!.label.split(" ")[0]}</div></div>
              ))}
              {pendingPhotos.map((f, i) => (
                <button key={i} onClick={() => setPendingPhotos(p => p.filter((_, j) => j !== i))} title={f.name + " - click to remove"} className="h-12 w-12 overflow-hidden rounded border border-dashed border-sky-500">
                  <img src={URL.createObjectURL(f)} alt={f.name} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
          {project.episodes.length > 1 && seriesPhotos(project).length > 0 && (
            <button onClick={async () => { const r = await syncPhotos(project); onSaved(r.project); notify({ message: `Photos placed: ${r.copied} copied, ${r.wired} scenes wired`, tab: "series" }); }} className="text-[11px] text-sky-300 hover:underline">Put the photos in every episode and scene now</button>
          )}
          <WorkflowCheck project={project} onChanged={onSaved} />
        </motion.div>

        <button onClick={() => setShowRaw(s => !s)} className="w-full text-center text-[11px] text-neutral-600 hover:text-neutral-300 transition">
          {showRaw ? "Hide" : "Advanced:"} plan JSON (only needed if the model's plan could not be read)
        </button>
        <AnimatePresence>
          {showRaw && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-2 overflow-hidden">
              <textarea className={`${field} h-48 font-mono text-xs`} value={rawPlan} onChange={e => setRawPlan(e.target.value)} placeholder="Paste a plan JSON array here if the model's answer needs fixing." />
              <button onClick={savePastedPlan} className="w-full rounded-lg bg-neutral-700 hover:bg-neutral-600 px-3 py-2 text-xs text-white">Use this plan</button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-lg border border-rose-800/60 bg-rose-950/40 p-3 text-xs text-rose-200">
              {error}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* right: the conversation */}
      <div className="flex flex-col min-h-0 rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
          <Cpu size={13} className="text-violet-400 shrink-0" />
          <span className="text-[11px] text-neutral-400 shrink-0">Talking with</span>
          <select value={known ? talkModel : ""} onChange={e => pickModel(e.target.value)} title="The model used for this conversation, filling in the details and building the plan"
            className="min-w-0 flex-1 max-w-xs rounded-md border border-neutral-700 bg-transparent px-2 py-1 text-xs focus:outline-none [&_*]:bg-white [&_*]:text-black">
            <option value="">App's selected model</option>
            {offline.length > 0 && <optgroup label="Offline (on this PC)">{offline.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>}
            {online.length > 0 && <optgroup label="Online">{online.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>}
          </select>
          {model?.startsWith("gemini:") || model?.startsWith("online:") || /[:-]cloud$/i.test(model || "") ? <span className="flex items-center gap-1 text-[10px] text-sky-400"><Cloud size={11} /> online</span> : <span className="text-[10px] text-emerald-400">offline</span>}
        </div>
        <div ref={scroller} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && !streaming && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid h-full place-items-center text-center">
              <div className="max-w-sm space-y-2">
                <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}>
                  <Bot size={28} className="mx-auto text-violet-400" />
                </motion.div>
                <p className="text-sm text-neutral-400">Talk the series through.</p>
                <p className="text-xs text-neutral-600">The model can see the idea fields. Start with what the viewer should feel, or what episode one covers. Speak it with the mic if you prefer.</p>
              </div>
            </motion.div>
          )}
          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <motion.div
                key={i} layout
                initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 320, damping: 26 }}
                className={m.role === "user" ? "ml-auto flex max-w-[80%] items-start gap-2" : "mr-auto flex max-w-[88%] items-start gap-2"}
              >
                {m.role === "assistant" && <Bot size={14} className="mt-2 shrink-0 text-violet-400" />}
                <div className={m.role === "user"
                  ? "rounded-2xl rounded-tr-sm bg-neutral-700/50 px-3 py-2 text-sm text-neutral-100"
                  : "rounded-2xl rounded-tl-sm bg-neutral-800/70 px-3 py-2 text-sm text-neutral-200 whitespace-pre-wrap"}>
                  {m.content}
                </div>
                {m.role === "user" && <User size={14} className="mt-2 shrink-0 text-neutral-500" />}
              </motion.div>
            ))}
          </AnimatePresence>
          {busy && !streaming && (
            <div className="mr-auto flex max-w-[88%] items-center gap-2 text-xs text-neutral-500"><Loader2 size={13} className="animate-spin text-violet-400" /> Waiting for the model... a big model that is not loaded yet can take a minute or two to wake up.</div>
          )}
          {streaming && (
            <motion.div layout className="mr-auto flex max-w-[88%] items-start gap-2">
              <Bot size={14} className="mt-2 shrink-0 text-violet-400" />
              <div className="rounded-2xl rounded-tl-sm bg-neutral-800/70 px-3 py-2 text-sm text-neutral-200 whitespace-pre-wrap">
                {streaming}
                <motion.span animate={{ opacity: [1, 0.2, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 bg-violet-400" />
              </div>
            </motion.div>
          )}
        </div>

        <div className="border-t border-neutral-800 p-3">
          <MicStatus phase={dictation.phase} level={dictation.level} />
          <div className="flex items-end gap-2">
            <div className="relative flex-1">
              <input
                className={`${field} pr-3`}
                placeholder={dictation.listening ? "Listening..." : dictation.transcribing ? "Transcribing..." : "Talk through the series, or press the mic to speak..."}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                disabled={busy}
              />
              <AnimatePresence>
                {dictation.listening && (
                  <motion.span
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-emerald-500/50"
                  />
                )}
              </AnimatePresence>
            </div>

            <MicModeButton
              pref={voicePref}
              onSelect={setVoicePref}
              onClick={dictation.toggle}
              active={dictation.listening}
              busy={dictation.transcribing}
              disabled={busy || !dictation.supported}
              ringPx={dictation.listening ? Math.round(dictation.level * 10) : 0}
              placement="top"
              title={dictation.supported ? "Dictate - online recognizer or offline Whisper" : "No microphone available"}
            />

            <motion.button
              whileHover={{ scale: busy || !input.trim() ? 1 : 1.06 }}
              whileTap={{ scale: 0.94 }}
              onClick={send}
              disabled={busy || !input.trim()}
              className="rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-40 px-3 py-2.5 text-white shadow-lg shadow-violet-950/40"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}
