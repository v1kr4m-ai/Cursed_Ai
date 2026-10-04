/** Capability flags shown on model cards. Shared by the server (catalog search) and the UI (installed models). */
export const MODEL_FLAGS = ["Reasoning", "Coding", "Multilingual", "Vision", "Tools", "Embedding"] as const;
export type ModelFlag = typeof MODEL_FLAGS[number];

// Best-effort: derived from the model's name, the host's own capability labels
// (Ollama: tools/thinking/vision/embedding) and Hugging Face tags.
export function inferFlags(name: string, tags: string[] = [], caps: string[] = []): ModelFlag[] {
  const n = name.toLowerCase();
  const t = tags.map(x => x.toLowerCase());
  const c = caps.map(x => x.toLowerCase());
  const has = (re: RegExp) => re.test(n) || t.some(x => re.test(x));
  const langCodes = t.filter(x => /^[a-z]{2}$/.test(x)).length;
  const out: ModelFlag[] = [];

  if (c.includes("thinking") || has(/deepseek-r1|\br1\b|qwq|reason|thinking|magistral|openthinker|cogito|marco-o1|gpt-oss|\bo1\b/)) out.push("Reasoning");
  if (has(/cod(e|er|ing)|starcoder|devstral|opencoder|yi-coder|codestral/)) out.push("Coding");
  if (c.includes("vision") || t.includes("image-text-to-text") || has(/llava|vision|[-_]vl\b|vl[-_]|moondream|pixtral|minicpm-v|internvl|gemma3|gemma-3|multimodal|vlm|qwen[\d.]*-?vl/)) out.push("Vision");
  if (langCodes >= 5 || has(/multilingual|\baya\b|qwen|bloom|glm|gemma|xlm|mt5|nllb|nemo|command-r|llama-?3\.[123]|seallm|bge-m3|exaone/)) out.push("Multilingual");
  if (c.includes("tools") || t.includes("function-calling") || t.includes("tool-use")) out.push("Tools");
  if (c.includes("embedding") || t.includes("feature-extraction") || t.includes("sentence-similarity") || has(/embed|\bbge\b|minilm|nomic|\be5[-_]|\bgte[-_]/)) out.push("Embedding");
  return out;
}
