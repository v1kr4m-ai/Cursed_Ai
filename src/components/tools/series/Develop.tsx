import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Send, Sparkles, Loader2, FileJson, Lightbulb, Users, Palette, StickyNote, Bot, User, ImagePlus, FileText, Wand2, Cpu, Cloud, Tag, Type, Brush, Clapperboard, Plus, Check, ChevronDown, ChevronRight, Paperclip, Download } from "lucide-react";
import { SERIES_FORMATS, projectFormat, type SeriesFormat } from "../../../../seriesTool/formats";
import type { AIModel } from "../../../types";
import { MicStatus } from "../../voice/MicStatus";
import { MicModeButton } from "../../voice/MicModeButton";
import { useDictation } from "../../../services/useDictation";
import { savedSetting } from "../../../lib/settingsStore";
import { ThinkingWords } from "../../ui/ThinkingWords";
import { notify } from "../../../lib/notify";
import { api, askModel, extractJson, fileUrl, type Project } from "./api";
import { RefDrop } from "./RefDrop";
import { seriesPhotos, syncPhotos } from "./photos";
import { isChatModel, loadRecords, noteOutcome, rateModel, recommend, TIER_LABEL, tierRank } from "./modelRating";
import { adoptPlannedPeople, castInstruction, ensureCast, peopleOf, renamePerson, setSkip, wantsStill, type Person } from "./people";
import { kindOf, refKindInfo } from "../../../../seriesTool/refKinds";
import { WorkflowCheck } from "./WorkflowPicker";
import { ZoomImage } from "./ZoomImage";
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

const episodeShape = (cast: boolean) => `{
    "number": 1,
    "title": "Episode title",
    "era": "what this episode covers",
    "hookOut": "closing line that pulls the viewer to the next episode",
    "refs": [
      { "name": "style_plate", "role": "style", "prompt": "image prompt for the look of this episode", "negative": "what to avoid" },
${cast ? "" : `,
      { "name": "character_name", "role": "character", "prompt": "image prompt for this character", "negative": "what to avoid" }`}
    ],
    "scenes": [
      { "number": 1, "vo": "(write this scene's own line here)", "shot": "(write this scene's own shot here)", "textCard": "", ${cast ? `"cast": ["Name"], "refs": ["style_plate"]` : `"refs": ["style_plate", "character_name"]`} }
    ]
  }`;

/** Scenes asked for in one answer; longer episodes are written in parts so a small model never has to send a huge reply. */
const PART = 10;
/** How many clips an episode needs to last `seconds`; the old fixed length (8) when nothing was chosen. */
const sceneTarget = (project: Project) => (project.episodeSeconds ? Math.max(2, Math.round(project.episodeSeconds / Math.max(1, project.settings.seconds || 7))) : 8);

function rulesFor(fmt: SeriesFormat, people: Person[], scenes = 8, photos = 0) {
  const lineRule = fmt.speech === "none"
    ? `- The "vo" line is only a short note (${fmt.lineWords} words) for the editor: nothing is spoken in the clip.`
    : `- Every "vo" line is ${fmt.lineWords} words: it is ${fmt.speech === "voiceover" ? "spoken over" : fmt.speech === "sung" ? "sung during" : "said on camera in"} one short clip.`;
  return `Video style: ${fmt.label}. ${fmt.plan}
Rules:
- Every episode gets exactly one ref with role "style" named "style_plate", listed first in every scene's refs.
${scenes > PART ? `- Each episode will have ${scenes} scenes in all. Write only the first ${PART} now; the rest are asked for next, so leave the episode open and do not wrap it up yet.` : `- ${scenes} scenes per episode.`}
${lineRule}
- A good shot looks like this (do not copy it, write your own for every scene): "${fmt.shotExample}". The "vo" is: ${fmt.lineHint}
- Every scene needs a real, specific "shot" (what the camera sees and what the person does) and a real "vo". Never leave them empty and never repeat the same text in two fields.
- Always leave "textCard" empty. Subtitles and captions are added later by the editor, never inside the clips.
- Image prompts should describe a photographic still, with lighting and grade, not a character sheet.
${people.length ? castInstruction(people) : photos > 0 ? `- ${photos} reference photo${photos === 1 ? " is" : "s are"} already attached for the people of this series. Do NOT write a "character" ref for anyone who appears in an attached photo: the photo itself is used in the scenes. Name that person in each scene's "cast" and write refs only for outfits, products and places.` : `- If a person must look exactly like an attached reference photo, give them a "character" ref and mention the photo in its prompt.`}
- A ref may carry a "kind": person, outfit, product, location, pose, prop, palette or style. Give each outfit or product its own ref with that kind.
- Scene "refs" lists ref names from the same episode, style_plate first.`;
}

/** Asks for the whole plan: every episode of the season, or exactly `count` of them. */
function planInstruction(fmt: SeriesFormat, count: number, people: Person[], scenes = 8, photos = 0) {
  return `Turn our discussion into a production plan and reply with JSON only - no commentary, no code fences.
${count > 0 ? `Write exactly ${count} episode${count > 1 ? "s" : ""}.` : "Write every episode we discussed."}

Shape - a JSON array of episodes:
[
  ${episodeShape(people.length > 0)}
]

${rulesFor(fmt, people, scenes, photos)}`;
}

/** Asks for one more episode that carries on from the ones already planned. */
function nextEpisodeInstruction(fmt: SeriesFormat, project: Project, direction: string, people: Person[], scenes = 8, photos = 0) {
  const number = (project.episodes[project.episodes.length - 1]?.number || 0) + 1;
  const recap = project.episodes.map(e => `Episode ${e.number} "${e.title}" (${e.era || "no period"}): ${e.scenes.slice(0, 2).map(sc => sc.vo).filter(Boolean).join(" / ")}${e.hookOut ? ` - ends with: ${e.hookOut}` : ""}`).join("\n");
  return `Write the NEXT episode, number ${number}, and reply with JSON only - no commentary, no code fences.
Carry on from what is already planned, and pick up the closing hook of the last episode.

Already planned:
${recap || "(nothing yet)"}

${direction.trim() ? `What I want in this episode: ${direction.trim()}
` : ""}
Shape - one JSON object (a single episode, not an array):
${episodeShape(people.length > 0).replace('"number": 1', `"number": ${number}`)}

${rulesFor(fmt, people, scenes, photos)}`;
}

/** The plan the page already holds, written back in the shape the planner uses, so one more episode can be added without losing renders. */
function planJson(project: Project) {
  return project.episodes.map(e => ({
    number: e.number, title: e.title, era: e.era, hookOut: e.hookOut,
    refs: e.refs.map(r => ({ name: r.name, role: r.role, kind: r.kind, person: r.person, skip: r.skip, prompt: r.prompt, negative: r.negative, seed: r.seed })),
    scenes: e.scenes.map(sc => ({ number: sc.number, vo: sc.vo, shot: sc.shot, textCard: sc.textCard, cast: sc.cast, seed: sc.seed, refs: sc.refIds.map(id => e.refs.find(r => r.id === id)?.name).filter(Boolean) })),
  }));
}

/** Styles where reference photos matter, with what to attach. */
const PHOTO_STYLES: Record<string, string> = {
  ugc: "This style looks best with a photo of the person and, if she shows it, a picture of the product or outfit.",
  vlog: "Attach a photo of the person so every clip shows the same face.",
  "street-walk": "Attach a photo of the person who walks, and a picture of the street if you want a particular place.",
  grwm: "Attach a photo of the person, and pictures of the outfits she picks.",
  "outfit-change": "Attach a photo of the person, then one picture for each outfit she changes into (kind: Outfit / costume).",
  fashion: "Attach a photo of the model, then one picture for each look (kind: Outfit / costume).",
  "product-demo": "Attach a picture of the product (kind: Product) so it looks the same in every clip.",
  pov: "Attach pictures of the places or things she sees, if they matter.",
  skit: "Attach one photo per person and give each person a name, so each keeps their own face.",
  singing: "Attach a photo of the singer so every clip shows the same person.",
  dancing: "Attach a photo of the dancer so every clip shows the same person.",
};

const field = "w-full bg-neutral-900/60 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-500 transition-colors";

const IDEA_FIELDS = [
  { key: "logline" as const, label: "What is it about?", icon: Lightbulb, color: "text-amber-400", placeholder: "One line is enough, e.g. A creator shares her day, outfits and honest stories" },
  { key: "audience" as const, label: "Who is it for?", icon: Users, color: "text-sky-400", placeholder: "e.g. young women who love fashion" },
  { key: "tone" as const, label: "How should it feel?", icon: Palette, color: "text-violet-400", placeholder: "e.g. calm, warm and honest" },
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

/** The four steps at the top of Develop: where you are, what is done, and a way to jump. */
function StepRail({ steps, current, onPick }: { steps: { n: number; label: string; done: boolean }[]; current: number; onPick: (n: number) => void }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="flex items-start">
        {steps.map((s, i) => (
          <React.Fragment key={s.n}>
            <button onClick={() => onPick(s.n)} className="flex w-16 shrink-0 flex-col items-center gap-1 text-center" title={s.label}>
              <span className={"flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition " + (current === s.n ? "border-emerald-400 bg-emerald-500/20 text-emerald-200" : s.done ? "border-emerald-700 bg-emerald-700/20 text-emerald-300" : "border-neutral-700 text-neutral-400")}>{s.done && current !== s.n ? <Check size={13} /> : s.n}</span>
              <span className={"text-[10px] leading-tight " + (current === s.n ? "text-neutral-100" : "text-neutral-500")}>{s.label}</span>
            </button>
            {i < steps.length - 1 && <div className={"mt-3.5 h-px flex-1 " + (s.done ? "bg-emerald-700/60" : "bg-neutral-800")} />}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/** One step: a numbered header that shows a one-line summary while closed, and the controls while open. */
function StepCard({ n, title, summary, done, open, onOpen, optional, next, children }: {
  n: number; title: string; summary: string; done: boolean; open: boolean; onOpen: () => void; optional?: boolean;
  next?: { label: string; go: () => void }; children: React.ReactNode;
}) {
  return (
    <div className={"overflow-hidden rounded-xl border transition-colors " + (open ? "border-neutral-600 bg-neutral-900/50" : "border-neutral-800 bg-neutral-900/30")}>
      <button onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className={"flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold " + (done ? "border-emerald-700 bg-emerald-700/20 text-emerald-300" : "border-neutral-600 text-neutral-400")}>{done ? <Check size={12} /> : n}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-neutral-100">{title}{optional && <span className="ml-2 text-[10px] font-normal text-neutral-500">optional</span>}</span>
          {!open && <span className="block truncate text-[11px] text-neutral-500">{summary}</span>}
        </span>
        <ChevronDown size={15} className={"shrink-0 text-neutral-500 transition-transform " + (open ? "rotate-180" : "")} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-neutral-800 px-4 pb-4 pt-3">
          {children}
          {next && (
            <button onClick={next.go} className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-600 bg-neutral-800/60 px-4 py-2 text-xs font-medium text-neutral-100 transition hover:bg-neutral-700/70">{next.label} <ChevronRight size={14} /></button>
          )}
        </div>
      )}
    </div>
  );
}

/** A field with its name above it, so no one has to guess from a placeholder. */
function Labeled({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-300">{icon}{label}</span>
      {children}
    </label>
  );
}

/** Things most people never need, tucked away until asked for. */
function Fold({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-lg border border-neutral-800">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-neutral-400 hover:text-neutral-200">
        <ChevronRight size={13} className={"transition-transform " + (open ? "rotate-90" : "")} /> <span className="font-medium">{title}</span>{hint && <span className="truncate text-neutral-600">{hint}</span>}
      </button>
      {open && <div className="space-y-3 border-t border-neutral-800 p-3">{children}</div>}
    </div>
  );
}

export function Develop({ project, modelId, models, onSaved, focusAdd }: { project: Project; modelId?: string; models?: AIModel[]; onSaved: (p: Project) => void; focusAdd?: boolean }) {
  const episodesCard = React.useRef<HTMLDivElement>(null);
  // Arriving from "Add the next episode" on the Produce board: bring that card into view.
  React.useEffect(() => { if (focusAdd) setStep(4); }, [focusAdd]);
  React.useEffect(() => { if (focusAdd) setTimeout(() => episodesCard.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 350); }, [focusAdd]);
  const [talkModel, setTalkModel] = React.useState<string>(() => { try { return localStorage.getItem(TALK_MODEL_KEY) || ""; } catch { return ""; } });
  const ready = (models || []).filter(m => m.isDownloaded && isChatModel(m));
  const isOnline = (m: AIModel) => /[:-]cloud$/i.test(m.id) || m.source === "gemini" || !!m.tags?.some(t => /^cloud$/i.test(t));
  const records = React.useMemo(() => loadRecords(), [models]);
  const labelOf = (m: AIModel) => `${m.name} - ${TIER_LABEL[rateModel(m, records[m.id]).tier]}`;
  const offline = ready.filter(m => !isOnline(m)).map(m => ({ id: m.id, name: labelOf(m) }));
  const online = ready.filter(isOnline).map(m => ({ id: m.id, name: labelOf(m) }));
  const known = [...offline, ...online].some(m => m.id === talkModel);
  const model = known && talkModel ? talkModel : modelId;
  const rating = rateModel(ready.find(m => m.id === model) || { id: model || "", name: model || "", sizeBytes: undefined }, model ? records[model] : undefined);
  const better = React.useMemo(() => recommend(ready, records), [models]);
  const betterThan = (m?: AIModel) => !!m && m.id !== model && tierRank(rateModel(m, records[m.id]).tier) < tierRank(rating.tier);
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
  const [partNote, setPartNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [rawPlan, setRawPlan] = React.useState("");
  const [episodeCount, setEpisodeCount] = React.useState(0);
  const [direction, setDirection] = React.useState("");
  const [addingNext, setAddingNext] = React.useState(false);
  const [pendingPhotos, setPendingPhotos] = React.useState<File[]>([]);
  const fmt = projectFormat(project);
  const [showRaw, setShowRaw] = React.useState(false);
  const [showAttach, setShowAttach] = React.useState(false);
  const photosCard = React.useRef<HTMLDivElement>(null);
  // Four steps, one open at a time. A new series starts at 1, one with a story at 2, one with episodes at 4.
  // The steps and the chat share the width: drag the bar between them (double-click resets, arrow keys nudge).
  const WIDTH_KEY = "cursed.series.developWidth";
  const [leftW, setLeftW] = React.useState<number>(() => { try { const v = Number(localStorage.getItem(WIDTH_KEY)); return Number.isFinite(v) && v >= 300 ? v : 380; } catch { return 380; } });
  const layoutRef = React.useRef<HTMLDivElement>(null);
  const clampW = (w: number) => Math.round(Math.min(Math.max(300, w), Math.max(300, (layoutRef.current?.clientWidth || 1200) - 240)));
  const saveW = (w: number) => { const c = clampW(w); setLeftW(c); try { localStorage.setItem(WIDTH_KEY, String(c)); } catch { /* storage blocked */ } };
  const dragFrom = React.useRef<{ x: number; w: number } | null>(null);
  const [step, setStep] = React.useState<number>(() => (project.episodes.length ? 4 : project.idea.logline.trim() ? 2 : 1));
  /** Opens the Reference photos card and brings it into view. */
  /** Builds a training dataset from one person's photos, then opens Train LoRA with it chosen and the trigger word filled in. */
  const trainPerson = async (name: string) => {
    try {
      const r = await fetch("/api/train/lora/from-series", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id, person: name }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not build the dataset.");
      if (!d.enough && !confirm(`${name} has only ${d.total} photo${d.total === 1 ? "" : "s"} in the dataset. A LoRA needs about 15-30 varied photos (different angles, light and clothes) to learn a face well.

Open Train LoRA anyway? You can add more pictures there first.`)) return;
      window.dispatchEvent(new CustomEvent("cursed:train-lora", { detail: { trigger: d.name, datasetDir: d.dir } }));
      window.dispatchEvent(new CustomEvent("cursed:goto", { detail: { tab: "trainlora" } }));
      notify({ message: `${name}: dataset ready (${d.total} photos, ${d.added} new). Trigger word ${d.name}.`, tab: "trainlora" });
    } catch (e: any) { notify({ message: e?.message || String(e), kind: "error", tab: "series" }); }
  };
  const goToPhotos = () => { setStep(3); setShowAttach(true); setTimeout(() => photosCard.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 150); };
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

  const nPhotos = seriesPhotos(project).length + pendingPhotos.length;
  const systemPrompt =
    `You are helping plan a short-form video series for YouTube Shorts / Reels. ` +
    `Video style: ${projectFormat(project).label} - ${projectFormat(project).blurb} ` +
    `Each episode is about ${sceneTarget(project)} ${project.settings.seconds || 7}-second vertical clips with one ${projectFormat(project).lineLabel.toLowerCase()} line each. ` +
    `Idea: ${idea.logline || "(not stated yet)"}. Audience: ${idea.audience || "general"}. Tone: ${idea.tone || "documentary"}. ` +
    `Notes: ${idea.notes || "none"}. ` +
    (nPhotos > 0 ? `The user has attached ${nPhotos} reference photo${nPhotos === 1 ? "" : "s"} of the people in the series; you cannot see them, but they will appear in the scenes, so never invent how those people look. ` : "") +
    `You are a creative writing partner for the user's own fictional video series, so help with scripts, scenes and outlines whenever asked. ` +
    `Push back on vague ideas, ask one sharp question at a time, and keep answers short unless a script is requested.`;

  const attachInput = React.useRef<HTMLInputElement>(null);
  const [attaching, setAttaching] = React.useState(false);
  /** Documents become story material the chat and the plan can read; pictures become reference photos. */
  async function attach(files: FileList | null) {
    const list = Array.from(files || []);
    if (!list.length) return;
    setAttaching(true);
    setError(null);
    try {
      let current = project;
      const images = list.filter(f => f.type.startsWith("image/")), docs = list.filter(f => !f.type.startsWith("image/"));
      for (const f of docs) await api.uploadSource(project.id, f);
      if (docs.length) { current = await api.get(project.id); onSaved(current); }
      if (images.length) {
        if (current.episodes.length) {
          for (const f of images) await api.uploadRef(current.id, current.episodes[0].id, f, f.name.replace(/\.[^.]+$/, ""), "character", "person");
          const r = await syncPhotos(await api.get(current.id));
          onSaved(r.project);
        } else setPendingPhotos(p => [...p, ...images]);
      }
      notify({ message: `${docs.length ? `${docs.length} document${docs.length === 1 ? "" : "s"} added to the story material` : ""}${docs.length && images.length ? " and " : ""}${images.length ? `${images.length} picture${images.length === 1 ? "" : "s"} added as reference photos` : ""}`, tab: "series" });
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setAttaching(false); if (attachInput.current) attachInput.current.value = ""; }
  }
  /** The whole discussion as a text file. */
  function saveChat() {
    const text = `# ${project.title} - discussion\n\n` + messages.map(m => `**${m.role === "user" ? "You" : "Model"}** (${m.at ? new Date(m.at).toLocaleString() : ""})\n\n${m.content}\n`).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    a.download = `${project.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "series"}-discussion.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

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
      // Saved before the model answers, so a failed or interrupted answer never loses what you said.
      await saveIdea(idea, next);
      let acc = "";
      const material = sources.map(s => ({ role: "user", content: `Attached document "${s.name}":\n\n${(s.digest || s.text).slice(0, 6000)}` }));
      const history = [{ role: "system", content: systemPrompt }, ...material, ...next.map(m => ({ role: m.role, content: m.content }))];
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
    const who = model || "";
    try { json = tidyPlan(extractJson(answer)); problem = planProblems(json, fmt, peopleOf(project).map(x => x.name)); } catch { problem = "That was not valid JSON. Reply again with ONLY the JSON, starting with the first bracket, no text before or after it, no code fences."; }
    if (!problem) { noteOutcome(who, "ok"); return json; }
    answer = await ask([{ role: "assistant", content: answer.slice(0, 3000) }, { role: "user", content: problem + " Send the complete corrected JSON again, nothing else." }]);
    try { json = tidyPlan(extractJson(answer)); } catch (e) { noteOutcome(who, "failed"); throw e; }
    noteOutcome(who, planProblems(json, fmt, peopleOf(project).map(x => x.name)) ? "failed" : "struggled");
    return json;
  }

  /** After a plan is saved: every episode gets the series photos, every person gets a still of their own, and each scene gets its cast's pictures. */
  async function finishPlan(planned: Project, extra: File[]) {
    const synced = await syncPhotos(planned, extra);
    const episodes = ensureCast({ ...synced.project, episodes: adoptPlannedPeople(synced.project) });
    onSaved(JSON.stringify(episodes) !== JSON.stringify(synced.project.episodes) ? await api.patch(project.id, { episodes }) : synced.project);
  }

  /** An episode asked for in parts: keeps asking for the next scenes until it has as many as the length chosen. */
  async function extendScenes(base: { role: string; content: string }[], list: any[]) {
    const target = sceneTarget(project);
    if (target <= PART) return list;
    for (const ep of list) {
      if (!Array.isArray(ep?.scenes)) continue;
      for (let round = 0; round < 12 && ep.scenes.length < target; round++) {
        const have = ep.scenes.length, upto = Math.min(have + PART, target);
        setPartNote(`Episode ${ep.number}: scenes ${have + 1}-${upto} of ${target}`);
        const recent = ep.scenes.slice(-3).map((sc: any) => `${sc.number}. ${sc.shot} | ${sc.vo}`).join("\n");
        const ask = `Episode ${ep.number} "${ep.title}" has ${have} scenes so far. The last ones:\n${recent}\n\nWrite scenes ${have + 1} to ${upto} of ${target}, carrying on from there, and reply with a JSON array of scene objects only (same shape as before, numbered from ${have + 1}, no commentary, no code fences). ${upto === target ? "These are the last scenes: bring the episode to its closing beat." : "Do not wrap up the episode yet."} Each scene needs its own real shot and line. Ref names must come from: ${(ep.refs || []).map((r: any) => r.name).join(", ")}.`;
        let more: any;
        try { more = tidyPlan(extractJson(await askModel([...base, { role: "assistant", content: JSON.stringify(list).slice(0, 4000) }, { role: "user", content: ask }], model))); } catch { break; }
        const arr = Array.isArray(more) ? more : Array.isArray(more?.scenes) ? more.scenes : null;
        const fresh = (arr || []).filter((sc: any) => sc && typeof sc === "object" && String(sc.shot || "").trim());
        if (!fresh.length) break;
        fresh.slice(0, upto - have).forEach((sc: any, i: number) => ep.scenes.push({ ...sc, number: have + i + 1 }));
      }
    }
    setPartNote("");
    return list;
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
      const got = await askForJson(base, nextEpisodeInstruction(fmt, project, direction, peopleOf(project), sceneTarget(project), photoCount), a => setRawPlan(a));
      const next = Array.isArray(got) ? got[0] : got;
      if (!next || typeof next !== "object" || !Array.isArray(next.scenes)) throw new Error("The model did not write an episode with scenes.");
      next.number = (project.episodes[project.episodes.length - 1]?.number || 0) + 1;
      await extendScenes(base, [next]);
      const planned = await api.savePlan(project.id, [...planJson(project), next], true);
      await finishPlan(planned, []);
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
      const episodes = await askForJson(base, planInstruction(fmt, episodeCount, peopleOf(project), sceneTarget(project), photoCount), a => setRawPlan(a));
      // Asked for one episode, a model often sends the episode itself rather than a list of one.
      const list = Array.isArray(episodes) ? episodes : Array.isArray(episodes?.episodes) ? episodes.episodes : episodes && typeof episodes === "object" && Array.isArray(episodes.scenes) ? [episodes] : null;
      if (!list) throw new Error("The plan must be a list of episodes.");
      await extendScenes(base, list);
      // Photos picked before the plan existed are attached now, and every episode gets the series photos.
      const planned = await api.savePlan(project.id, list);
      await finishPlan(planned, pendingPhotos);
      setPendingPhotos([]);
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

  // One line per step, shown while it is closed.
  const voiceText = project.voice === "off" ? ", no voice" : project.voice === "on" ? ", she talks" : "";
  const storySummary = [title.trim() || project.title, idea.logline.trim()].filter(Boolean).join(" - ") || "Start here";
  const lookSummary = `${fmt.label}${voiceText}`;
  const photoCount = seriesPhotos(project).length + pendingPhotos.length;
  const peopleCount = peopleOf(project).length;
  const photosSummary = photoCount ? `${photoCount} photo${photoCount === 1 ? "" : "s"}${peopleCount ? `, ${peopleCount} ${peopleCount === 1 ? "person" : "people"}` : ""}` : "None added - fine if you have no photos";
  const planSummary = project.episodes.length ? `${project.episodes.length} episode${project.episodes.length === 1 ? "" : "s"} planned` : "Not written yet";
  const steps = [
    { n: 1, label: "Story", done: !!(idea.logline.trim() || project.episodes.length) },
    { n: 2, label: "Look", done: !!project.format },
    { n: 3, label: "Photos", done: photoCount > 0 },
    { n: 4, label: "Episodes", done: project.episodes.length > 0 },
  ];

  return (
    <div ref={layoutRef} style={{ ["--left" as any]: `${leftW}px` }} className="grid grid-cols-1 gap-4 lg:grid-cols-[var(--left)_14px_minmax(0,1fr)] lg:gap-0 h-full min-h-0">
      {/* left: the idea, attachments, and the button that turns talk into a plan */}
      {/* left: four short steps, one open at a time */}
      <div className="space-y-3 overflow-y-auto pr-1">
        <StepRail steps={steps} current={step} onPick={n => setStep(step === n ? 0 : n)} />

        <StepCard n={1} title="Your story" summary={storySummary} done={!!(idea.logline.trim() || project.episodes.length)} open={step === 1} onOpen={() => setStep(step === 1 ? 0 : 1)}
          next={{ label: "Next: pick the look", go: () => setStep(2) }}>
          <p className="text-[11px] leading-relaxed text-neutral-500">Say what the series is about. Fill these in, or talk it through in the chat on the right and press <b>Fill the details from our discussion</b>.</p>
          <Labeled label="Series title" icon={<Type size={13} className="text-rose-400" />}>
            <input className={field} placeholder="e.g. Richie's Daily Life" value={title} onChange={e => setTitle(e.target.value)} onBlur={() => saveDetails({ title })} />
          </Labeled>
          {IDEA_FIELDS.map(({ key, label, icon: Icon, color, placeholder }) => (
            <Labeled key={key} label={label} icon={<Icon size={13} className={color} />}>
              <input className={field} placeholder={placeholder} value={idea[key]} onChange={e => setIdea({ ...idea, [key]: e.target.value })} onBlur={() => saveIdea()} />
            </Labeled>
          ))}
                  <button onClick={fillFromDiscussion} disabled={filling || busy || !planReady} title={planReady ? "Reads the conversation and fills in the title, niche, style and the rest" : "Talk it through first"}
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900/60 hover:bg-neutral-800/80 disabled:opacity-40 px-4 py-2.5 text-sm font-medium text-neutral-100 transition">
          {filling ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} className="text-fuchsia-400" />}
          {filling ? "Filling in the details..." : "Fill the details from our discussion"}
        </button>
          <Fold title="More details (optional)" hint="subject area, things to avoid, story documents">
            <Labeled label="Subject area" icon={<Tag size={13} className="text-teal-400" />}>
              <input className={field} placeholder="e.g. ancient history, true crime, fashion" value={idea.niche || ""} onChange={e => setIdea({ ...idea, niche: e.target.value })} onBlur={() => saveIdea()} />
            </Labeled>
            <Labeled label="Rules and things to avoid" icon={<StickyNote size={13} className="text-emerald-400" />}>
              <textarea className={`${field} h-24 resize-none`} placeholder="e.g. no real brands, keep it family friendly" value={idea.notes} onChange={e => setIdea({ ...idea, notes: e.target.value })} onBlur={() => saveIdea()} />
            </Labeled>
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

          </Fold>
        </StepCard>

        <StepCard n={2} title="Look and voice" summary={lookSummary} done={!!project.format} open={step === 2} onOpen={() => setStep(step === 2 ? 0 : 2)}
          next={{ label: "Next: add people and photos", go: () => setStep(3) }}>
          <p className="text-[11px] leading-relaxed text-neutral-500">Pick the kind of video, and whether anyone talks in it.</p>
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.02 }}
          className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-medium text-neutral-200">
            <Clapperboard size={14} className="text-sky-400" /> Video style
          </h3>
          {[...new Set(SERIES_FORMATS.map(f => f.group))].map(group => (
            <div key={group} className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">{group}</div>
              <div className="flex flex-wrap gap-1.5">
                {SERIES_FORMATS.filter(f => f.group === group).map(f => (
                  <button key={f.id} onClick={async () => onSaved(await api.patch(project.id, { format: f.id, discussion: messages }))} title={f.blurb}
                    className={"rounded-full border px-3 py-1 text-xs transition " + (fmt.id === f.id ? "border-sky-500 bg-sky-500/15 text-sky-200" : "border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500")}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">Voice in the clips</div>
            <div className="flex flex-wrap gap-1.5">
              {([["auto", "Style default"], ["off", "No voice (I add music later)"], ["on", "She talks to the camera"]] as const).map(([v, label]) => (
                <button key={v} onClick={async () => onSaved(await api.patch(project.id, { voice: v, discussion: messages }))}
                  className={"rounded-full border px-3 py-1 text-xs transition " + ((project.voice || "auto") === v ? "border-emerald-500 bg-emerald-500/15 text-emerald-200" : "border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500")}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-neutral-500">{fmt.blurb} Each scene has one <span className="text-neutral-300">{fmt.lineLabel.toLowerCase()}</span>. Change the style, then build the plan again (renders you already made are kept).</p>
          {PHOTO_STYLES[fmt.id] && (
            <div className="space-y-1.5 rounded-lg border border-sky-900/50 bg-sky-950/20 p-2.5 text-[11px] leading-relaxed text-sky-200/80">
              <div>{PHOTO_STYLES[fmt.id]}</div>
              <button onClick={goToPhotos} className="flex items-center gap-1.5 rounded-md bg-sky-600/25 px-2.5 py-1 text-[11px] font-medium text-sky-100 hover:bg-sky-600/40"><ImagePlus size={12} /> Add reference photos</button>
              <ol className="list-decimal space-y-0.5 pl-4 text-sky-200/70">
                <li>Add the photos in the <b>Reference photos</b> card (the button above takes you there) and pick what each one is: person, outfit, product...</li>
                <li>Build the episode plan.</li>
                <li>On Produce, render the stills first (they are made from your photos), then the clips.</li>
              </ol>
            </div>
          )}
          <label className="flex items-start gap-2 text-[11px] text-neutral-400">
            <input type="checkbox" className="mt-0.5" checked={!!project.allowTextCards} onChange={async e => onSaved(await api.patch(project.id, { allowTextCards: e.target.checked, discussion: messages }))} />
            <span>Write on-screen text cards into the video. Leave this off to get clean clips: subtitles and captions are added afterwards in Assemble.</span>
          </label>
        </motion.div>

          <Labeled label="The look (colours, light, camera feel)" icon={<Brush size={13} className="text-fuchsia-400" />}>
            <textarea className={`${field} h-16 resize-none`} placeholder="e.g. warm natural light, handheld phone footage" value={style} onChange={e => setStyle(e.target.value)} onBlur={() => saveDetails({ style })} />
          </Labeled>
        </StepCard>

        <StepCard n={3} title="People and photos" optional summary={photosSummary} done={seriesPhotos(project).length > 0} open={step === 3} onOpen={() => setStep(step === 3 ? 0 : 3)}
          next={{ label: seriesPhotos(project).length ? "Next: write the episodes" : "Skip: no photos", go: () => setStep(4) }}>
                  <motion.div ref={photosCard} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <button onClick={() => setShowAttach(s => !s)} className="flex w-full items-center gap-2 text-sm font-medium text-neutral-200">
            <ImagePlus size={14} className="text-pink-400" /> Reference photos
            <span className="ml-auto text-[11px] text-neutral-500">{seriesPhotos(project).length + pendingPhotos.length} attached</span>
          </button>
          <p className="text-[11px] leading-relaxed text-neutral-500">Attach the person's photo (or a look to match) once. It is copied into every episode, also the ones you add later, and used wherever a still or clip needs it.</p>
          <AnimatePresence initial={false}>
            {(showAttach || seriesPhotos(project).length + pendingPhotos.length === 0) && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-3 overflow-hidden">
                {firstEpisode ? (
                  <RefDrop project={project} people={peopleOf(project).map(x => x.name)} episodeId={firstEpisode.id} onChanged={async p => { onSaved(p); const r = await syncPhotos(p); if (r.copied || r.wired) onSaved(r.project); }} />
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
                <div key={r.id} className={"photo-tile w-16 text-center " + (r.skip ? "opacity-40" : "")}>
                  <ZoomImage src={fileUrl(r.file!)} alt={r.name + (r.person ? " - " + r.person : "")} className="h-16 w-16 rounded object-cover border border-neutral-700" />
                  <div className="truncate text-[9px] text-neutral-400" title={refKindInfo(kindOf(r))!.label + (r.person ? ": " + r.person : "")}>{r.person || refKindInfo(kindOf(r))!.label.split(" ")[0]}</div>
                  <label className="flex items-center justify-center gap-1 text-[9px] text-neutral-500" title="Leave this picture out of every prompt and workflow slot"><input type="checkbox" checked={!!r.skip} onChange={async e => onSaved(await api.patch(project.id, { episodes: setSkip(project, r, e.target.checked) }))} />skip</label>
                </div>
              ))}
              {pendingPhotos.map((f, i) => (
                <button key={i} onClick={() => setPendingPhotos(p => p.filter((_, j) => j !== i))} title={f.name + " - click to remove"} className="h-12 w-12 overflow-hidden rounded border border-dashed border-sky-500">
                  <img src={URL.createObjectURL(f)} alt={f.name} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
          {peopleOf(project).length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-neutral-800 bg-neutral-900/50 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">People in this series</div>
              {peopleOf(project).map(person => (
                <div key={person.name} className="flex items-center gap-2 text-xs text-neutral-300">
                  <input defaultValue={person.name} onBlur={async e => { const to = e.target.value.trim(); if (to && to !== person.name) onSaved(await api.patch(project.id, { episodes: renamePerson(project, person.name, to) })); }} className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-transparent px-2 py-1 text-xs focus:outline-none focus:border-sky-600" title="Rename this person everywhere" />
                  <span className="shrink-0 text-[10px] text-neutral-500">{person.photos.length} photo{person.photos.length === 1 ? "" : "s"}</span>
                  <label className="flex shrink-0 items-center gap-1 text-[10px] text-neutral-400" title="Off: this person appears as their own photo, used as it is. On: ComfyUI first makes a new picture from the photos and the scenes use that."><input type="checkbox" checked={wantsStill(project, person.name)} onChange={async e => { const stillPeople = e.target.checked ? [...(project.stillPeople || []), person.name] : (project.stillPeople || []).filter(n => n.toLowerCase() !== person.name.toLowerCase()); const next = { ...project, stillPeople }; onSaved(await api.patch(project.id, { stillPeople, episodes: ensureCast(next) })); }} />make a picture</label>
                  <button onClick={() => trainPerson(person.name)} title="Build a LoRA dataset from this person's photos and open Train LoRA with their trigger word" className="shrink-0 rounded-md border border-neutral-700 px-2 py-1 text-[10px] text-neutral-300 hover:border-violet-500 hover:text-violet-200">Train a LoRA</button>
                </div>
              ))}
              <p className="text-[10px] leading-relaxed text-neutral-600">Each person appears as their own photo, used as it is. Tick "make a picture" only if you want ComfyUI to make a new picture of them first. The planner says who is in each scene, and you can change it on the scene card in Produce.</p>
            </div>
          )}
          {project.episodes.length > 1 && seriesPhotos(project).length > 0 && (
            <button onClick={async () => { const r = await syncPhotos(project); onSaved(r.project); notify({ message: `Photos placed: ${r.copied} copied, ${r.wired} scenes wired`, tab: "series" }); }} className="text-[11px] text-sky-300 hover:underline">Put the photos in every episode and scene now</button>
          )}
          <WorkflowCheck project={project} onChanged={onSaved} />
        </motion.div>

        </StepCard>

        <StepCard n={4} title="Write the episodes" summary={planSummary} done={project.episodes.length > 0} open={step === 4} onOpen={() => setStep(step === 4 ? 0 : 4)}>
          <div className="space-y-1">
            <div className="text-[11px] text-neutral-500">Written by</div>
            <select value={known ? talkModel : ""} onChange={e => pickModel(e.target.value)} className="w-full rounded-lg border border-neutral-700 bg-transparent px-2 py-1.5 text-xs focus:outline-none [&_*]:bg-white [&_*]:text-black">
              <option value="">App's selected model</option>
              {offline.length > 0 && <optgroup label="Offline (on this PC)">{offline.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>}
              {online.length > 0 && <optgroup label="Online">{online.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>}
            </select>
          </div>
                  {(rating.tier === "basic" || rating.tier === "weak") && (
          <div className="space-y-1.5 rounded-lg border border-amber-700/50 bg-amber-950/20 p-3 text-[11px] leading-relaxed text-amber-100/90">
            <div className="font-medium text-amber-200">{model} is a {TIER_LABEL[rating.tier]} planner</div>
            <div>{rating.note} A plan needs a long, exact answer, so a small model may give empty shots or repeat the examples. It is asked to fix mistakes once, but a bigger model gives better episodes.</div>
            <div className="flex flex-wrap gap-1.5">
              {betterThan(better.offline) && <button onClick={() => pickModel(better.offline!.id)} className="rounded-md bg-amber-600/25 px-2.5 py-1 text-amber-100 hover:bg-amber-600/40">Use {better.offline!.name} (offline, {TIER_LABEL[rateModel(better.offline!, records[better.offline!.id]).tier]})</button>}
              {betterThan(better.online) && <button onClick={() => pickModel(better.online!.id)} className="rounded-md bg-sky-600/25 px-2.5 py-1 text-sky-100 hover:bg-sky-600/40" title="The story and discussion are sent to that company">Use {better.online!.name} (online, {TIER_LABEL[rateModel(better.online!, records[better.online!.id]).tier]})</button>}
              {!betterThan(better.offline) && !betterThan(better.online) && <span className="text-amber-200/80">No better model is set up yet. Add an online provider in Settings, or pull a larger Ollama model.</span>}
            </div>
          </div>
        )}
                  <div className="flex items-center gap-2 px-1 text-xs text-neutral-400">
          <span>Episodes to write</span>
          <select value={episodeCount} onChange={e => setEpisodeCount(Number(e.target.value))} className="rounded-md border border-neutral-700 bg-transparent px-2 py-1 text-xs focus:outline-none [&_*]:bg-white [&_*]:text-black">
            <option value={0}>All we discussed</option>
            {[1, 2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="ml-2">each about</span>
          <select value={project.episodeSeconds || 0} onChange={async e => onSaved(await api.patch(project.id, { episodeSeconds: Number(e.target.value) || undefined }))} className="rounded-md border border-neutral-700 bg-transparent px-2 py-1 text-xs focus:outline-none [&_*]:bg-white [&_*]:text-black" title="How long each finished episode should run. Longer episodes are written in parts of 10 scenes.">
            <option value={0}>1 minute (8 clips)</option>
            {[[30, "30 seconds"], [120, "2 minutes"], [180, "3 minutes"], [300, "5 minutes"], [600, "10 minutes"]].map(([sec, label]) => <option key={sec} value={sec}>{label} ({Math.max(2, Math.round(Number(sec) / Math.max(1, project.settings.seconds || 7)))} clips)</option>)}
          </select>
        </div>
        {partNote && <div className="px-1 text-[11px] text-sky-300">Writing {partNote}...</div>}
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

          <Fold title="Advanced" hint="paste or fix the plan by hand">
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

          </Fold>
                  <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-lg border border-rose-800/60 bg-rose-950/40 p-3 text-xs text-rose-200">
              {error}
            </motion.div>
          )}
        </AnimatePresence>
        </StepCard>
      </div>

      {/* the bar between the steps and the chat */}
      <div role="separator" aria-orientation="vertical" aria-label="Resize the steps and the chat" tabIndex={0} title="Drag to resize. Double-click to reset."
        className="group hidden cursor-col-resize items-center justify-center lg:flex touch-none select-none focus:outline-none"
        onPointerDown={e => { dragFrom.current = { x: e.clientX, w: leftW }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (dragFrom.current) setLeftW(clampW(dragFrom.current.w + e.clientX - dragFrom.current.x)); }}
        onPointerUp={e => { if (dragFrom.current) { saveW(dragFrom.current.w + e.clientX - dragFrom.current.x); dragFrom.current = null; } }}
        onDoubleClick={() => saveW(380)}
        onKeyDown={e => { if (e.key === "ArrowLeft") { e.preventDefault(); saveW(leftW - 40); } else if (e.key === "ArrowRight") { e.preventDefault(); saveW(leftW + 40); } }}>
        <div className="h-16 w-1 rounded-full bg-neutral-700 transition-colors group-hover:bg-sky-500 group-focus:bg-sky-500" />
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
                  ? "rounded-2xl rounded-tr-sm border border-violet-500/30 bg-violet-600/25 px-3 py-2 text-sm text-violet-50"
                  : "rounded-2xl rounded-tl-sm border border-teal-500/25 border-l-2 border-l-teal-400/60 bg-teal-900/20 px-3 py-2 text-sm text-neutral-200 whitespace-pre-wrap"}>
                  {m.content}
                </div>
                {m.role === "user" && <User size={14} className="mt-2 shrink-0 text-neutral-500" />}
              </motion.div>
            ))}
          </AnimatePresence>
          {busy && !streaming && (
            <div className="mr-auto flex max-w-[88%] items-center gap-2 text-xs text-neutral-500"><ThinkingWords className="text-xs text-violet-300" /></div>
          )}
          {streaming && (
            <motion.div layout className="mr-auto flex max-w-[88%] items-start gap-2">
              <Bot size={14} className="mt-2 shrink-0 text-violet-400" />
              <div className="rounded-2xl rounded-tl-sm border border-teal-500/25 border-l-2 border-l-teal-400/60 bg-teal-900/20 px-3 py-2 text-sm text-neutral-200 whitespace-pre-wrap">
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

            <input ref={attachInput} type="file" multiple accept=".txt,.md,.csv,.doc,.docx,.pdf,.xls,.xlsx,.ppt,.pptx,image/*" className="hidden" onChange={e => attach(e.target.files)} />
            <button onClick={() => attachInput.current?.click()} disabled={attaching || busy} title="Attach a document (story, notes, script) or a picture (a reference photo) to the discussion" className="rounded-lg border border-neutral-700 p-2.5 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40">
              {attaching ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
            </button>
            {messages.length > 0 && <button onClick={saveChat} title="Save this discussion as a text file" className="rounded-lg border border-neutral-700 p-2.5 text-neutral-300 hover:bg-neutral-800"><Download size={16} /></button>}

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
