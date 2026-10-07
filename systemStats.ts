import express from "express";
import os from "os";
import { execFile, spawn } from "child_process";

/**
 * Live machine readings for the status bar: CPU, RAM, and GPU load / video memory / temperature.
 * Sampled in the background so every request is instant and many open tabs cost nothing extra.
 *
 * GPU sources:
 *  - nvidia-smi (NVIDIA): load, VRAM, temperature.
 *  - Windows GPU performance counters: load and memory of EVERY adapter (Intel / AMD / NVIDIA), the same
 *    numbers Task Manager shows. On laptops with an idle NVIDIA chip the work often runs on the integrated
 *    GPU, so the busiest adapter is what gets reported.
 * Windows exposes no reliable CPU temperature without admin tools, so Temp is the NVIDIA GPU's.
 */

interface Gpu {
  name: string;
  util: number;
  vramUsedMB: number;
  vramTotalMB: number;
  tempC: number | null;
  /** "dedicated" = real video memory; "shared" = integrated GPU borrowing system RAM. */
  memory: "dedicated" | "shared";
  /** Plain-language summary for the tooltip. */
  detail: string;
}
interface Live {
  cpu: number;                 // %
  ram: number;                 // %
  ramUsedGB: number;
  ramTotalGB: number;
  gpu: Gpu | null;
}

interface WinAdapter { util: number; dedicatedMB: number; sharedMB: number }
interface Nvidia { name: string; util: number; usedMB: number; totalMB: number; tempC: number }

export function registerSystemStats(app: express.Express) {
  const base = { cpu: 0, ram: 0, ramUsedGB: 0, ramTotalGB: os.totalmem() / 1024 ** 3 };
  let latest: Live = { ...base, gpu: null };
  let nvidia: Nvidia | null = null;
  let adapters: WinAdapter[] = [];

  // CPU % = share of non-idle time since the previous sample.
  let prev = os.cpus();
  const sampleCpu = () => {
    const now = os.cpus();
    let idle = 0, total = 0;
    now.forEach((c, i) => {
      const p = prev[i];
      if (!p) return;
      total += (Object.values(c.times) as number[]).reduce((a, b) => a + b, 0) - (Object.values(p.times) as number[]).reduce((a, b) => a + b, 0);
      idle += c.times.idle - p.times.idle;
    });
    prev = now;
    const totalMem = os.totalmem();
    latest.cpu = total > 0 ? Math.round((1 - idle / total) * 100) : 0;
    latest.ram = Math.round(((totalMem - os.freemem()) / totalMem) * 100);
    latest.ramUsedGB = (totalMem - os.freemem()) / 1024 ** 3;
    latest.ramTotalGB = totalMem / 1024 ** 3;
  };

  let nvidiaMissing = false;
  const sampleNvidia = () => {
    if (nvidiaMissing) return;
    execFile("nvidia-smi", ["--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err) { if ((err as any).code === "ENOENT") nvidiaMissing = true; nvidia = null; return; }
      const [name, util, used, total, temp] = stdout.trim().split("\n")[0].split(",").map(x => x.trim());
      nvidia = { name, util: Number(util) || 0, usedMB: Number(used) || 0, totalMB: Number(total) || 0, tempC: Number(temp) || 0 };
    });
  };

  // One long-lived PowerShell asks Windows for every GPU adapter's counters about every 1.5 s.
  const startWindowsCounters = () => {
    if (process.platform !== "win32") return;
    const script = `
      while ($true) {
        try {
          $e = Get-CimInstance -Query "SELECT Name,UtilizationPercentage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine WHERE UtilizationPercentage > 0"
          $m = Get-CimInstance -Query "SELECT Name,DedicatedUsage,SharedUsage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory"
          $by = @{}
          foreach ($row in $e) {
            if ($row.Name -match 'luid_(0x\\w+_0x\\w+)_phys_\\d+_eng_\\d+_engtype_(\\w+)') {
              $k = $Matches[1]; $t = $Matches[2]
              if (-not $by[$k]) { $by[$k] = @{} }
              $by[$k][$t] = [double]$by[$k][$t] + [double]$row.UtilizationPercentage
            }
          }
          $out = @()
          foreach ($row in $m) {
            if ($row.Name -match 'luid_(0x\\w+_0x\\w+)_phys_\\d+') {
              $k = $Matches[1]
              $u = 0
              if ($by[$k]) { $u = ($by[$k].Values | Measure-Object -Maximum).Maximum }
              $out += @{ util = [math]::Min(100, [math]::Round($u)); dedicatedMB = [math]::Round($row.DedicatedUsage / 1MB); sharedMB = [math]::Round($row.SharedUsage / 1MB) }
            }
          }
          Write-Output ('GPUJSON' + (ConvertTo-Json -Compress -InputObject @($out)))
        } catch { Write-Output 'GPUJSON[]' }
        Start-Sleep -Milliseconds 1200
      }`;
    const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (line.startsWith("GPUJSON")) { try { adapters = JSON.parse(line.slice(7)); } catch { /* partial line */ } }
      }
    });
    child.on("exit", () => setTimeout(startWindowsCounters, 5000).unref());
    process.on("exit", () => { try { child.kill(); } catch { /* gone */ } });
  };

  const combineGpu = () => {
    const busiest = adapters.slice().sort((a, b) => b.util - a.util || b.sharedMB - a.sharedMB)[0];
    const totalRamMB = os.totalmem() / 1024 ** 2;
    if (nvidia) {
      const nvActive = nvidia.util > 0 || nvidia.usedMB > 0;
      const winUtil = busiest?.util ?? 0;
      const util = Math.max(nvidia.util, winUtil);
      const useShared = !nvActive && busiest && busiest.sharedMB > 0 && winUtil > 0;
      latest.gpu = useShared
        ? { name: "Integrated GPU", util, vramUsedMB: busiest!.sharedMB, vramTotalMB: Math.round(totalRamMB / 2), tempC: nvidia.tempC, memory: "shared",
            detail: `Integrated GPU busy (${winUtil}%, ${(busiest!.sharedMB / 1024).toFixed(1)} GB shared memory). ${nvidia.name} is idle (${nvidia.tempC}°C).` }
        : { name: nvidia.name, util, vramUsedMB: nvidia.usedMB, vramTotalMB: nvidia.totalMB, tempC: nvidia.tempC, memory: "dedicated",
            detail: `${nvidia.name}: ${nvidia.util}% load, ${(nvidia.usedMB / 1024).toFixed(1)} of ${(nvidia.totalMB / 1024).toFixed(1)} GB video memory.` };
    } else if (busiest) {
      latest.gpu = { name: "GPU", util: busiest.util, vramUsedMB: busiest.dedicatedMB || busiest.sharedMB, vramTotalMB: busiest.dedicatedMB ? 0 : Math.round(totalRamMB / 2), tempC: null,
        memory: busiest.dedicatedMB ? "dedicated" : "shared", detail: `GPU load ${busiest.util}%.` };
    } else {
      latest.gpu = null;
    }
  };

  sampleCpu(); sampleNvidia(); startWindowsCounters();
  setInterval(() => { sampleCpu(); combineGpu(); }, 1500).unref();
  setInterval(sampleNvidia, 1500).unref();

  app.get("/api/system/live", (_req, res) => res.json(latest));
}
