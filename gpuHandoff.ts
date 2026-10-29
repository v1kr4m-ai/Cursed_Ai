/**
 * One GPU, two users: ComfyUI (pictures and clips) and the offline language models (Ollama, LM Studio, the app's
 * own engine). Before a language model answers, ComfyUI is asked to let go of the models it holds in GPU memory;
 * before ComfyUI renders, Ollama unloads its models. Each side loads again by itself when it is next used.
 * Nothing here fails a request: if the other side is not running, the call simply does nothing.
 */
const COMFY = () => process.env.COMFYUI_URL || "http://127.0.0.1:8188";
const OLLAMA = () => process.env.OLLAMA_URL || "http://127.0.0.1:11434";

let comfyFreedAt = 0;
let ollamaFreedAt = 0;
export let handoffEnabled = true;
export const setHandoff = (on: boolean) => { handoffEnabled = on; };

/** Before a language model runs. Skipped if done in the last half minute (a chat sends many messages). */
export async function freeComfyForLLM(comfyUrl = COMFY()) {
  if (!handoffEnabled || Date.now() - comfyFreedAt < 30_000) return;
  comfyFreedAt = Date.now();
  ollamaFreedAt = 0;
  try {
    await fetch(`${comfyUrl}/free`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }), signal: AbortSignal.timeout(3000) });
  } catch { /* ComfyUI is not running */ }
}

/** Before ComfyUI renders: Ollama unloads every model it has in memory. */
export async function freeOllamaForComfy(ollamaUrl = OLLAMA()) {
  if (!handoffEnabled || Date.now() - ollamaFreedAt < 30_000) return;
  ollamaFreedAt = Date.now();
  comfyFreedAt = 0;
  try {
    const ps: any = await (await fetch(`${ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(2000) })).json();
    for (const m of ps?.models || []) {
      await fetch(`${ollamaUrl}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: m.name, keep_alive: 0 }), signal: AbortSignal.timeout(10000) }).catch(() => {});
    }
  } catch { /* Ollama is not running */ }
}
