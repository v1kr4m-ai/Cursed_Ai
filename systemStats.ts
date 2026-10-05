import express from "express";
import os from "os";
import { execFile } from "child_process";

/**
 * Live machine readings for the status bar: CPU, RAM, and (NVIDIA) GPU load, VRAM and temperature.
 * Sampled in the background so every request is instant and many open tabs cost nothing extra.
 * Windows exposes no reliable CPU temperature without admin tools, so Temp is the GPU's.
 */

interface Live {
  cpu: number;                 // %
  ram: number;                 // %
  ramUsedGB: number;
  ramTotalGB: number;
  gpu: { name: string; util: number; vramUsedMB: number; vramTotalMB: number; tempC: number } | null;
}

export function registerSystemStats(app: express.Express) {
  let latest: Live = { cpu: 0, ram: 0, ramUsedGB: 0, ramTotalGB: os.totalmem() / 1024 ** 3, gpu: null };

  // CPU % = share of non-idle time since the previous sample.
  let prev = os.cpus();
  const sampleCpu = () => {
    const now = os.cpus();
    let idle = 0, total = 0;
    now.forEach((c, i) => {
      const p = prev[i];
      if (!p) return;
      const t = (Object.values(c.times) as number[]).reduce((a, b) => a + b, 0) - (Object.values(p.times) as number[]).reduce((a, b) => a + b, 0);
      idle += c.times.idle - p.times.idle;
      total += t;
    });
    prev = now;
    const totalMem = os.totalmem();
    latest.cpu = total > 0 ? Math.round((1 - idle / total) * 100) : 0;
    latest.ram = Math.round(((totalMem - os.freemem()) / totalMem) * 100);
    latest.ramUsedGB = (totalMem - os.freemem()) / 1024 ** 3;
    latest.ramTotalGB = totalMem / 1024 ** 3;
  };

  let nvidiaMissing = false;
  const sampleGpu = () => {
    if (nvidiaMissing) return;
    execFile("nvidia-smi", ["--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err) { if ((err as any).code === "ENOENT") nvidiaMissing = true; latest.gpu = null; return; }
      const [name, util, used, total, temp] = stdout.trim().split("\n")[0].split(",").map(x => x.trim());
      latest.gpu = { name, util: Number(util) || 0, vramUsedMB: Number(used) || 0, vramTotalMB: Number(total) || 0, tempC: Number(temp) || 0 };
    });
  };

  sampleCpu(); sampleGpu();
  setInterval(sampleCpu, 1500).unref();
  setInterval(sampleGpu, 2000).unref();

  app.get("/api/system/live", (_req, res) => res.json(latest));
}
