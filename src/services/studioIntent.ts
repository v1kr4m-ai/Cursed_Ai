/**
 * Voice commands for the Image / Video studios, understood without asking the language model:
 * "create an image of a red fox", "make a video of waves on a beach and generate it", "open the video generator",
 * and, once a studio is open, "generate it" / "go ahead".
 */
export type StudioKind = "image" | "video" | "audio";
export interface StudioRequest { kind: StudioKind; prompt?: string; generate?: boolean }
export interface StudioIntent { request: StudioRequest; reply: string }

const IMAGE_WORDS = "image|images|picture|pictures|photo|photograph|painting|drawing|illustration|artwork|wallpaper|poster|logo|portrait|render|sketch";
const VIDEO_WORDS = "video|videos|clip|animation|animated clip|movie|film|footage";
const MAKE_VERBS = "create|make|generate|produce|render|design|build|give me|show me|i want|i need|i'd like|i would like|can you|could you|please";

const GENERATE_NOW = /\b(and )?(then )?(generate|start|run|make|render|create)( it| that| this)?( now| right now| straight away| immediately)?\b\s*[.!]?\s*$|\b(right now|straight away|immediately|and start generating|and generate it)\b/i;
const FOLLOW_UP = /^(yes[, ]*)?(ok(ay)?[, ]*)?(please[, ]*)?(go ahead|generate( it| that| this)?|start( generating| it| now)?|do it|run it|make it|create it|render it|let'?s go|go)( now| please)?[.!]?$/i;

const clean = (s: string) => s.trim().replace(/^(of|showing|with|about|depicting|where|that shows|that has|which shows)\s+/i, "").replace(/\s+/g, " ").trim().replace(/[.?!]+$/, "");

/** `last` = the studio a request was sent to a moment ago (for "generate it"). */
export function parseStudioCommand(raw: string, last?: { kind: StudioKind; at: number } | null): StudioIntent | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;

  // "generate it" after a studio was opened by voice
  if (last && Date.now() - last.at < 5 * 60_000 && FOLLOW_UP.test(text)) {
    return { request: { kind: last.kind, generate: true }, reply: `Starting the ${last.kind} now.` };
  }

  // Just open the tool.
  const open = new RegExp(`\\b(open|go to|take me to|switch to|show)\\b.*\\b(${IMAGE_WORDS}|${VIDEO_WORDS})\\b.*\\b(generator|generation|studio|tool|creator|maker|page|tab|section)\\b`, "i").exec(text);
  const openAlt = /\b(open|go to|take me to|switch to)\b\s+(the\s+)?(image|video|picture)\s+(studio|generator|tool|page|tab)\b/i.exec(text);
  if (open || openAlt) {
    const w = (open?.[2] || openAlt?.[3] || "").toLowerCase();
    const kind: StudioKind = new RegExp(`^(${VIDEO_WORDS})$`, "i").test(w) ? "video" : "image";
    return { request: { kind }, reply: `Opening the ${kind} studio.` };
  }

  // "create an image of ...", "make me a short video about ..."
  const noun = `(?:(?:new|nice|cool|beautiful|stunning|detailed|short|quick|realistic|cinematic|ai|little|simple)\\s+)*(${IMAGE_WORDS}|${VIDEO_WORDS})`;
  const create = new RegExp(`\\b(?:${MAKE_VERBS}|draw|paint|animate)\\b(?:\\s+me)?(?:\\s+(?:an?|the|some|one))?\\s+${noun}\\b(.*)$`, "i").exec(text);
  let kind: StudioKind | null = null;
  let rest = "";
  if (create) {
    kind = new RegExp(`^(${VIDEO_WORDS})$`, "i").test(create[1]) ? "video" : "image";
    rest = create[2] || "";
  } else {
    const draw = /\b(draw|paint|sketch|illustrate)\s+(?:me\s+)?(.+)$/i.exec(text);
    const anim = /\b(animate)\s+(.+)$/i.exec(text);
    if (anim) { kind = "video"; rest = anim[2]; }
    else if (draw) { kind = "image"; rest = draw[2]; }
  }
  if (!kind) return null;

  let generate = false;
  if (GENERATE_NOW.test(rest) && rest.trim()) { generate = true; rest = rest.replace(GENERATE_NOW, ""); }
  const prompt = clean(rest);
  const what = kind === "video" ? "video" : "image";
  if (!prompt) return { request: { kind }, reply: `Opening the ${what} studio. Tell me what to ${what === "video" ? "film" : "draw"}, or type it in.` };
  return {
    request: { kind, prompt, generate },
    reply: generate ? `Creating a ${what} of ${prompt}.` : `Opened the ${what} studio with that prompt. Say generate it when you're ready.`,
  };
}
