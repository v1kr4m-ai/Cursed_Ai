/** Stop ComfyUI, or make it let go of the GPU, so the offline language models have the memory. */
export async function stopComfy(): Promise<{ wasRunning: boolean }> {
  const r = await fetch("/api/comfyui/stop", { method: "POST" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Could not stop ComfyUI.");
  return { wasRunning: !!d.wasRunning };
}

export async function freeComfyMemory(): Promise<void> {
  const r = await fetch("/api/comfyui/free", { method: "POST" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Could not free ComfyUI's memory.");
}
