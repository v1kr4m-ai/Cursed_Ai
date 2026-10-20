import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Send, Sparkles, Loader2, FileJson, Lightbulb, Users, Palette, StickyNote, Bot, User, ImagePlus, FileText } from "lucide-react";
import { MicModeButton } from "../../voice/MicModeButton";
import { useDictation } from "../../../services/useDictation";
import { savedSetting } from "../../../lib/settingsStore";
import { api, askModel, extractJson, fileUrl, type Project } from "./api";
import { RefDrop } from "./RefDrop";
import { StorySources } from "./StorySources";
import { DIGEST_THRESHOLD, digestDocument, type DigestProgress } from "./chunk";

/**
 * Stage 1. Describe the idea, argue it out with a model (local or cloud), then turn the
 * conversation into a structured plan of episodes and scenes.
 *
 * The discussion is saved with the project, so the reasoning behind the series is still there
 * months later when an episode needs rewriting.
 */

const PLAN_INSTRUCTION = `Turn our discussion into a production plan and reply with JSON only - no commentary.

Shape:
[
  {
    "number": 1,
    "title": "Episode title",
    "era": "what this episode covers",
    "hookOut": "closing line that pulls the viewer to the next episode",
    "refs": [
      { "name": "style_plate", "role": "style", "prompt": "image prompt for the look of this episode", "negative": "what to avoid" },
      { "name": "character_name", "role": "character", "prompt": "image prompt for this character", "negative": "what to avoid" }
    ],
    "scenes": [
      { "number": 1, "vo": "one narration line, 18-22 words", "shot": "what the camera sees and does, one or two sentences", "textCard": "optional on-screen text, or empty", "refs": ["style_plate", "character_name"] }
    ]
  }
]

Rules:
- Every episode gets exactly one ref with role "style" named "style_plate", listed first in every scene's refs.
- 8 scenes per episode unless we agreed otherwise.
- Narration lines must be 18-22 words: they are spoken over a 7 second clip.
- Image prompts should describe a photographic still, with lighting and grade, not a character sheet.
- Scene "refs" lists ref names from the same episode, style_plate first.`;

const field = "w-full bg-neutral-900/60 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-500 transition-colors";

const IDEA_FIELDS = [
  { key: "logline" as const, icon: Lightbulb, color: "text-amber-400", placeholder: "Logline - what is this series, in one line?" },
  { key: "audience" as const, icon: Users, color: "text-sky-400", placeholder: "Audience" },
  { key: "tone" as const, icon: Palette, color: "text-violet-400", placeholder: "Tone (e.g. cold documentary)" },
];

export function Develop({ project, modelId, onSaved }: { project: Project; modelId?: string; onSaved: (p: Project) => void }) {
  const [idea, setIdea] = React.useState(project.idea);
  const [input, setInput] = React.useState("");
  const [messages, setMessages] = React.useState(project.discussion);
  const [streaming, setStreaming] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [planning, setPlanning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rawPlan, setRawPlan] = React.useState("");
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
    `Each episode is about eight 7-second vertical clips with one line of narration each. ` +
    `Idea: ${idea.logline || "(not stated yet)"}. Audience: ${idea.audience || "general"}. Tone: ${idea.tone || "documentary"}. ` +
    `Notes: ${idea.notes || "none"}. ` +
    `Push back on vague ideas, ask one sharp question at a time, and keep answers short.`;

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
      const answer = await askModel(
        [{ role: "system", content: systemPrompt }, ...next.map(m => ({ role: m.role, content: m.content }))],
        modelId,
        t => { acc += t; setStreaming(acc); },
      );
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
          prompt => askModel([{ role: "user", content: prompt }], modelId),
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
      const answer = await askModel(
        [
          { role: "system", content: systemPrompt },
          ...storyBlocks,
          ...messages.map(m => ({ role: m.role, content: m.content })),
          { role: "user", content: PLAN_INSTRUCTION },
        ],
        modelId,
      );
      setRawPlan(answer);
      const episodes = extractJson(answer);
      if (!Array.isArray(episodes)) throw new Error("The plan must be a list of episodes.");
      onSaved(await api.savePlan(project.id, episodes));
    } catch (e: any) {
      setError(e?.message || String(e));
      setShowRaw(true);
    } finally {
      setPlanning(false);
      setDigesting(null);
    }
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
          {IDEA_FIELDS.map(({ key, icon: Icon, color, placeholder }) => (
            <div key={key} className="relative">
              <Icon size={13} className={`absolute left-3 top-1/2 -translate-y-1/2 ${color} pointer-events-none`} />
              <input className={`${field} pl-8`} placeholder={placeholder} value={idea[key]} onChange={e => setIdea({ ...idea, [key]: e.target.value })} onBlur={() => saveIdea()} />
            </div>
          ))}
          <div className="relative">
            <StickyNote size={13} className="absolute left-3 top-3 text-emerald-400 pointer-events-none" />
            <textarea className={`${field} pl-8 h-24 resize-none`} placeholder="Constraints, sources, things to avoid" value={idea.notes} onChange={e => setIdea({ ...idea, notes: e.target.value })} onBlur={() => saveIdea()} />
          </div>
        </motion.div>

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

        {/* reference images: optional, used as-is for characters, costume, location */}
        {firstEpisode && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
            <button onClick={() => setShowAttach(s => !s)} className="flex w-full items-center gap-2 text-sm font-medium text-neutral-200">
              <ImagePlus size={14} className="text-pink-400" /> Reference images
              <span className="ml-auto text-[11px] text-neutral-500">{attachedRefs.length} attached</span>
            </button>
            <AnimatePresence initial={false}>
              {showAttach && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-3 overflow-hidden">
                  <p className="text-[11px] text-neutral-500">Attached to <span className="text-neutral-300">{firstEpisode.title}</span>. Move or add more per episode on the Produce board.</p>
                  <RefDrop project={project} episodeId={firstEpisode.id} onChanged={onSaved} />
                  {attachedRefs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {attachedRefs.slice(0, 12).map(r => (
                        <motion.img
                          key={r.id} layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                          src={fileUrl(r.file!)} title={r.name} alt={r.name}
                          className="h-12 w-12 rounded object-cover border border-neutral-700"
                        />
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        <button onClick={() => setShowRaw(s => !s)} className="w-full flex items-center justify-center gap-2 rounded-lg border border-neutral-700 hover:bg-neutral-800/60 px-3 py-2 text-xs text-neutral-300 transition">
          <FileJson size={14} /> {showRaw ? "Hide" : "Paste or inspect"} plan JSON
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
