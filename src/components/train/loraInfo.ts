/** Which base model a trained LoRA file needs, from the ending the trainer gives its name. Plain words for the page. */
export function loraNeeds(fileName: string): { base: "flux" | "sdxl" | "sd15"; label: string } | null {
  const m = /_(sdxl|sd15|flux)_lora(?:-\d+)?\.safetensors$/i.exec(fileName);
  if (!m) return null;
  const base = m[1].toLowerCase() as "flux" | "sdxl" | "sd15";
  return { base, label: { sdxl: "works with SDXL checkpoints", sd15: "works with SD 1.5 checkpoints", flux: "works with Flux models" }[base] };
}
export const BASE_NAME = { flux: "Flux", sdxl: "SDXL", sd15: "SD 1.5" } as const;
