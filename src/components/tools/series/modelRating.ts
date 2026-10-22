/**
 * How good a model is likely to be at writing a series plan (a long, exact JSON answer), judged from what the
 * app knows: its size, whether it is online, and how it did before. Used to label the planner picker, warn
 * before a weak model writes a plan, and recommend a better one.
 *
 * Small local models tend to copy the example text, leave fields empty or cut the answer short, so size is the
 * main signal; a model that needed a retry or failed before is marked down on this PC.
 */
import type { AIModel } from "../../../types";

export type Tier = "strong" | "good" | "basic" | "weak";

export interface Rating {
  tier: Tier;
  /** Size in billions of parameters when it could be told. */
  params: number | null;
  online: boolean;
  /** One short sentence for the person. */
  note: string;
}

export interface Outcomes { ok: number; struggled: number; failed: number }

const KEY = "cursed.series.modelRecord";

export const isOnlineModel = (m: Pick<AIModel, "id" | "source" | "tags">) =>
  /[:-]cloud$/i.test(m.id) || m.source === "gemini" || m.source === "online" || !!m.tags?.some(t => /^cloud$/i.test(t));

/** Models that can write a plan: not embedding, vision-only or image-prompt models. */
export const isChatModel = (m: Pick<AIModel, "id" | "name" | "type">) => m.type !== "Vision" && !/embed|llava|moondream|vision|stable-diffusion|whisper|bge-|nomic/i.test(`${m.id} ${m.name}`);

/** "qwen2.5:7b", "llama3.3-70b-instruct", "30b-a3b": the first number followed by b. */
export function paramsFromName(name: string): number | null {
  const m = /(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)\s*b(?![a-z])/i.exec(name.replace(/_/g, "-"));
  return m ? Number(m[1]) : null;
}

export function rateModel(m: Pick<AIModel, "id" | "name" | "source" | "tags" | "sizeBytes">, record?: Outcomes): Rating {
  const online = isOnlineModel(m);
  let params = paramsFromName(m.id) ?? paramsFromName(m.name);
  // A 4-bit file is roughly 0.6 GB per billion parameters.
  if (params === null && m.sizeBytes) params = Math.round(m.sizeBytes / 0.6e9);
  let tier: Tier;
  let note: string;
  if (online && (params === null || params >= 30)) { tier = "strong"; note = "A large online model: follows the plan format well."; }
  else if (online) { tier = params >= 14 ? "good" : "basic"; note = "Online, but a smaller model."; }
  else if (params === null) { tier = "basic"; note = "Size unknown; treated as a small model."; }
  else if (params >= 30) { tier = "strong"; note = "A large local model: good at plans, but slow on a small GPU."; }
  else if (params >= 14) { tier = "good"; note = "A mid-size local model: usually follows the plan format."; }
  else if (params >= 7) { tier = "basic"; note = "A small model: may copy the examples or leave fields empty."; }
  else { tier = "weak"; note = "Too small to write a reliable plan."; }
  // This PC's own experience beats the guess.
  if (record && (record.struggled >= 2 || record.failed >= 1) && record.ok < record.struggled + record.failed) {
    tier = tier === "strong" ? "good" : tier === "good" ? "basic" : "weak";
    note = "It needed retries or failed on earlier plans here. " + note;
  }
  return { tier, params, online, note };
}

const ORDER: Tier[] = ["strong", "good", "basic", "weak"];
export const tierRank = (t: Tier) => ORDER.indexOf(t);
export const TIER_LABEL: Record<Tier, string> = { strong: "strong", good: "good", basic: "basic", weak: "weak" };

/** The best ready model, offline and online separately (online ones send the story to a company, so they are only suggested). */
export function recommend(models: AIModel[], records: { [id: string]: Outcomes } = {}): { offline?: AIModel; online?: AIModel } {
  const ready = models.filter(m => m.isDownloaded && isChatModel(m));
  // Within a tier a smaller model is quicker, so the smallest of the best tier wins locally.
  const pick = (list: AIModel[]) => {
    if (!list.length) return undefined;
    const top = Math.min(...list.map(m => tierRank(rateModel(m, records[m.id]).tier)));
    const tied = list.filter(m => tierRank(rateModel(m, records[m.id]).tier) === top);
    return [...tied].sort((a, b) => (rateModel(a, records[a.id]).params ?? 99) - (rateModel(b, records[b.id]).params ?? 99))[0];
  };
  // A model served by Ollama or LM Studio manages its own memory; a raw file is loaded inside the app, which fails on a small GPU, so served ones come first.
  const local = ready.filter(m => !isOnlineModel(m));
  const served = local.filter(m => m.source === "ollama" || m.source === "lmstudio");
  return { offline: pick(served.length ? served : local), online: pick(ready.filter(isOnlineModel)) };
}

export function loadRecords(): { [id: string]: Outcomes } {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}

/** Remembers how a model did on a plan: fine, needed a retry, or failed. */
export function noteOutcome(id: string, outcome: "ok" | "struggled" | "failed") {
  try {
    const all = loadRecords();
    const r: Outcomes = all[id] || { ok: 0, struggled: 0, failed: 0 };
    r[outcome]++;
    all[id] = r;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* storage blocked */ }
}
