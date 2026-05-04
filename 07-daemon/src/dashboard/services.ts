/**
 * Service status manifest for the dashboard System tab.
 *
 * Loads from c:/dev/data/skill-connections/dashboard/config.jsonc
 * (created with sensible defaults on first read). Each service is
 * pinged in parallel and tagged ok/warn/fail. Cheap; designed to run
 * every few seconds when the dashboard is open.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { DATA_ROOT, ensureDir } from '../paths.js';

const DASHBOARD_DIR = path.posix.join(DATA_ROOT, 'dashboard');
const CONFIG_FILE = path.posix.join(DASHBOARD_DIR, 'config.jsonc');

export type ServiceStatus = 'ok' | 'warn' | 'fail';

export interface ServiceDef {
  id: string;
  label: string;
  kind: 'http' | 'tcp' | 'process' | 'cmd' | 'file';
  target: string;
  expect_status?: number; // for http
  timeout_ms?: number;
}

export interface ServiceResult {
  id: string;
  label: string;
  kind: ServiceDef['kind'];
  status: ServiceStatus;
  detail: string;
  latency_ms?: number;
}

const DEFAULT_CONFIG: { services: ServiceDef[] } = {
  services: [
    {
      id: 'daemon',
      label: 'DevNeural daemon',
      kind: 'http',
      target: 'http://127.0.0.1:3747/health',
      expect_status: 200,
    },
    {
      id: 'ollama',
      label: 'Ollama',
      kind: 'http',
      target: 'http://localhost:11434/api/tags',
      expect_status: 200,
    },
    {
      id: 'wiki-git',
      label: 'Wiki git repo',
      kind: 'file',
      target: 'wiki/.git',
    },
    {
      id: 'tailscale',
      label: 'Tailscale',
      kind: 'cmd',
      target: 'tailscale status --json',
    },
    {
      // Cloudflare's 1.1.1.1 plain root returns 404 (DNS endpoint, no
      // homepage). /cdn-cgi/trace returns a 200 text payload and is the
      // standard "am I online" probe.
      id: 'internet',
      label: 'Internet',
      kind: 'http',
      target: 'https://1.1.1.1/cdn-cgi/trace',
      expect_status: 200,
    },
  ],
};

function loadConfig(): { services: ServiceDef[] } {
  ensureDir(DASHBOARD_DIR);
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(
      CONFIG_FILE,
      `// Dashboard service status manifest. Each entry is checked when /services is hit.\n` +
        JSON.stringify(DEFAULT_CONFIG, null, 2),
      'utf-8',
    );
    return DEFAULT_CONFIG;
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const stripped = raw.replace(/^\s*\/\/.*$/gm, '');
    return JSON.parse(stripped) as { services: ServiceDef[] };
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function checkHttp(def: ServiceDef): Promise<ServiceResult> {
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), def.timeout_ms ?? 2000);
    const res = await fetch(def.target, { signal: ctrl.signal });
    clearTimeout(t);
    const latency = Date.now() - start;
    if (def.expect_status && res.status !== def.expect_status) {
      return {
        id: def.id,
        label: def.label,
        kind: def.kind,
        status: 'warn',
        detail: `HTTP ${res.status} (expected ${def.expect_status})`,
        latency_ms: latency,
      };
    }
    return {
      id: def.id,
      label: def.label,
      kind: def.kind,
      status: 'ok',
      detail: `HTTP ${res.status}`,
      latency_ms: latency,
    };
  } catch (err) {
    return {
      id: def.id,
      label: def.label,
      kind: def.kind,
      status: 'fail',
      detail: (err as Error).message,
      latency_ms: Date.now() - start,
    };
  }
}

function checkFile(def: ServiceDef): ServiceResult {
  const target = def.target.startsWith('/') || /^[A-Za-z]:/.test(def.target)
    ? def.target
    : path.posix.join(DATA_ROOT, def.target);
  const exists = fs.existsSync(target);
  return {
    id: def.id,
    label: def.label,
    kind: def.kind,
    status: exists ? 'ok' : 'fail',
    detail: exists ? `present at ${target}` : `missing: ${target}`,
  };
}

function checkCmd(def: ServiceDef): ServiceResult {
  try {
    execSync(def.target, {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: def.timeout_ms ?? 3000,
      windowsHide: true,
    });
    return {
      id: def.id,
      label: def.label,
      kind: def.kind,
      status: 'ok',
      detail: 'command exited 0',
    };
  } catch (err) {
    return {
      id: def.id,
      label: def.label,
      kind: def.kind,
      status: 'fail',
      detail: (err as Error).message.slice(0, 200),
    };
  }
}

export async function checkAll(): Promise<ServiceResult[]> {
  const cfg = loadConfig();
  const results: Promise<ServiceResult>[] = cfg.services.map((def) => {
    if (def.kind === 'http') return checkHttp(def);
    if (def.kind === 'file') return Promise.resolve(checkFile(def));
    if (def.kind === 'cmd') return Promise.resolve(checkCmd(def));
    return Promise.resolve({
      id: def.id,
      label: def.label,
      kind: def.kind,
      status: 'warn' as const,
      detail: `kind '${def.kind}' not yet implemented`,
    });
  });
  return Promise.all(results);
}

export function rollupStatus(results: ServiceResult[]): ServiceStatus {
  if (results.some((r) => r.status === 'fail')) return 'fail';
  if (results.some((r) => r.status === 'warn')) return 'warn';
  return 'ok';
}
