/**
 * System metrics for the dashboard System tab.
 *
 * Pulls from Node's `os` module + a few cheap shell-outs for
 * Windows-specific data. Fast read, no caching.
 */
import * as os from 'node:os';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { DATA_ROOT } from '../paths.js';

export interface CpuMetric {
  cores: number;
  load_avg_1m: number;
  load_avg_5m: number;
  load_avg_15m: number;
  usage_percent: number;
}

export interface MemoryMetric {
  total_bytes: number;
  free_bytes: number;
  used_bytes: number;
  used_percent: number;
}

export interface DiskMetric {
  drive: string;
  total_bytes: number;
  free_bytes: number;
  used_bytes: number;
  used_percent: number;
}

export interface ProcessMetric {
  pid: number;
  rss_bytes: number;
  uptime_s: number;
  node_version: string;
  platform: string;
  arch: string;
}

export interface SystemMetrics {
  timestamp: string;
  hostname: string;
  cpu: CpuMetric;
  memory: MemoryMetric;
  disks: DiskMetric[];
  process: ProcessMetric;
  ollama: { reachable: boolean; host: string };
  data_root: { path: string; size_bytes: number };
}

let lastCpuSample: { idle: number; total: number } | null = null;

function cpuUsagePercent(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }
  if (lastCpuSample === null) {
    lastCpuSample = { idle, total };
    return 0;
  }
  const idleDiff = idle - lastCpuSample.idle;
  const totalDiff = total - lastCpuSample.total;
  lastCpuSample = { idle, total };
  if (totalDiff === 0) return 0;
  return Math.max(0, Math.min(100, ((totalDiff - idleDiff) / totalDiff) * 100));
}

function readDisks(): DiskMetric[] {
  if (process.platform !== 'win32') {
    // Minimal POSIX fallback; for OTLCDEV (Windows) we use wmic / powershell
    return [];
  }
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free | ConvertTo-Json -Compress"',
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, windowsHide: true },
    );
    const parsed = JSON.parse(out) as
      | { Name: string; Used?: number; Free?: number }
      | Array<{ Name: string; Used?: number; Free?: number }>;
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((d) => {
      const used = d.Used ?? 0;
      const free = d.Free ?? 0;
      const total = used + free;
      return {
        drive: d.Name,
        total_bytes: total,
        free_bytes: free,
        used_bytes: used,
        used_percent: total > 0 ? (used / total) * 100 : 0,
      };
    });
  } catch {
    return [];
  }
}

async function ollamaReachable(): Promise<boolean> {
  const host = process.env.DEVNEURAL_OLLAMA_HOST ?? 'http://localhost:11434';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${host}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

function dirSize(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = `${cur}/${e.name}`;
      if (e.isDirectory()) {
        stack.push(p);
      } else {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return total;
}

let cachedDataRootSize: { size: number; ts: number } | null = null;
const DATA_ROOT_CACHE_MS = 60_000;

function getDataRootSize(): number {
  const now = Date.now();
  if (cachedDataRootSize && now - cachedDataRootSize.ts < DATA_ROOT_CACHE_MS) {
    return cachedDataRootSize.size;
  }
  const size = dirSize(DATA_ROOT);
  cachedDataRootSize = { size, ts: now };
  return size;
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const [load1, load5, load15] = os.loadavg();

  return {
    timestamp: new Date().toISOString(),
    hostname: os.hostname(),
    cpu: {
      cores: os.cpus().length,
      load_avg_1m: load1 ?? 0,
      load_avg_5m: load5 ?? 0,
      load_avg_15m: load15 ?? 0,
      usage_percent: cpuUsagePercent(),
    },
    memory: {
      total_bytes: totalMem,
      free_bytes: freeMem,
      used_bytes: usedMem,
      used_percent: (usedMem / totalMem) * 100,
    },
    disks: readDisks(),
    process: {
      pid: process.pid,
      rss_bytes: process.memoryUsage().rss,
      uptime_s: process.uptime(),
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    ollama: {
      reachable: await ollamaReachable(),
      host: process.env.DEVNEURAL_OLLAMA_HOST ?? 'http://localhost:11434',
    },
    data_root: { path: DATA_ROOT, size_bytes: getDataRootSize() },
  };
}
