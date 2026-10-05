import React from "react";

export interface GpuInfo { backend: string; devices: string[] }

let cached: Promise<GpuInfo | null> | null = null;
/** Which compute backend the built-in engine really uses (vulkan / cuda / cpu), asked once from the server. */
export function useGpuInfo(): GpuInfo | null {
  const [info, setInfo] = React.useState<GpuInfo | null>(null);
  React.useEffect(() => {
    cached ??= fetch("/api/engine/gpu").then(r => r.json()).catch(() => null);
    cached.then(setInfo);
  }, []);
  return info;
}

/** "Vulkan GPU" / "CUDA GPU" / "CPU only" */
export const gpuLabel = (g: GpuInfo | null) => !g ? "Checking GPU..." : g.backend === "cpu" ? "CPU only" : `${g.backend.toUpperCase()} GPU`;
