#!/usr/bin/env node
/**
 * devneural-status: prints the current state of the system.
 * Exits 0 if everything looks healthy, non-zero on issues.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  DATA_ROOT,
  daemonPidFile,
  wikiRoot,
  wikiPagesDir,
  wikiPendingDir,
  wikiArchiveDir,
} from '../paths.js';
import { isAlive, readPid } from '../lifecycle/pid.js';

const SETTINGS_PATH = path
  .join(os.homedir(), '.claude', 'settings.json')
  .replace(/\\/g, '/');

function color(text: string, code: number): string {
  if (process.env.NO_COLOR) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}
const ok = (t: string) => color(t, 32);
const warn = (t: string) => color(t, 33);
const err = (t: string) => color(t, 31);

interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

function checkDataRoot(): Check {
  if (!fs.existsSync(DATA_ROOT)) {
    return {
      name: 'data root',
      status: 'fail',
      detail: `${DATA_ROOT} does not exist`,
    };
  }
  return { name: 'data root', status: 'ok', detail: DATA_ROOT };
}

function checkDaemon(): Check {
  const pid = readPid();
  if (pid === null) {
    return {
      name: 'daemon',
      status: 'warn',
      detail: 'not running (will lazy-start on next hook event)',
    };
  }
  if (isAlive(pid)) {
    return { name: 'daemon', status: 'ok', detail: `running pid=${pid}` };
  }
  return {
    name: 'daemon',
    status: 'fail',
    detail: `stale pid file: ${pid}`,
  };
}

function checkHooks(): Check {
  if (!fs.existsSync(SETTINGS_PATH)) {
    return {
      name: 'hooks',
      status: 'warn',
      detail: 'settings.json not found; run install-hooks',
    };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
  } catch {
    return { name: 'hooks', status: 'fail', detail: 'cannot read settings.json' };
  }
  const hasOurs = raw.includes('07-daemon/dist/capture/hooks/hook-runner.js') ||
    raw.includes('07-daemon\\dist\\capture\\hooks\\hook-runner.js');
  const hasV1 =
    raw.includes('01-data-layer/dist/hook-runner.js') ||
    raw.includes('04-session-intelligence/dist/session-start.js');
  if (!hasOurs && hasV1) {
    return {
      name: 'hooks',
      status: 'warn',
      detail: 'v1 hooks present, v2 not installed. run install-hooks to migrate',
    };
  }
  if (hasOurs && hasV1) {
    return {
      name: 'hooks',
      status: 'warn',
      detail: 'v1 and v2 hooks both present. run install-hooks to clean up',
    };
  }
  if (!hasOurs) {
    return {
      name: 'hooks',
      status: 'warn',
      detail: 'devneural hooks not installed. run npm run install-hooks',
    };
  }
  return { name: 'hooks', status: 'ok', detail: 'devneural hooks active' };
}

function checkWiki(): Check {
  if (!fs.existsSync(wikiRoot())) {
    return {
      name: 'wiki',
      status: 'warn',
      detail: 'wiki root not yet scaffolded (will be created on first daemon run)',
    };
  }
  const canonical = countMd(wikiPagesDir());
  const pending = countMd(wikiPendingDir());
  const archive = countMd(wikiArchiveDir());
  return {
    name: 'wiki',
    status: 'ok',
    detail: `pages=${canonical} pending=${pending} archive=${archive}`,
  };
}

async function checkOllama(): Promise<Check> {
  const provider = (process.env.DEVNEURAL_LLM_PROVIDER ?? 'ollama').toLowerCase();
  if (provider !== 'ollama') {
    return {
      name: 'llm',
      status: 'ok',
      detail: `provider=${provider} (ollama check skipped)`,
    };
  }
  const host = process.env.DEVNEURAL_OLLAMA_HOST ?? 'http://localhost:11434';
  const model = process.env.DEVNEURAL_OLLAMA_MODEL ?? 'qwen3:8b';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${host}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) {
      return {
        name: 'llm',
        status: 'fail',
        detail: `ollama unreachable at ${host} (HTTP ${res.status})`,
      };
    }
    const body = (await res.json()) as { models?: { name: string }[] };
    const tags = body.models?.map((m) => m.name) ?? [];
    const hasModel = tags.some((t) => t === model || t.startsWith(`${model.split(':')[0]}:`));
    if (!hasModel) {
      return {
        name: 'llm',
        status: 'warn',
        detail: `ollama running but model ${model} not pulled. Run: ollama pull ${model}`,
      };
    }
    return {
      name: 'llm',
      status: 'ok',
      detail: `ollama ${host}, model ${model}`,
    };
  } catch (e) {
    return {
      name: 'llm',
      status: 'fail',
      detail: `ollama unreachable at ${host} (${(e as Error).message}). Install from https://ollama.com`,
    };
  }
}

function countMd(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).length;
}

function badge(s: Check['status']): string {
  if (s === 'ok') return ok('  ok ');
  if (s === 'warn') return warn(' warn');
  return err(' fail');
}

async function main(): Promise<void> {
  const checks: Check[] = [];
  checks.push(checkDataRoot());
  checks.push(checkDaemon());
  checks.push(checkHooks());
  checks.push(checkWiki());
  checks.push(await checkOllama());

  console.log('DevNeural status');
  console.log('================');
  for (const c of checks) {
    console.log(`${badge(c.status)}  ${c.name.padEnd(10)}  ${c.detail}`);
  }
  console.log('');
  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  if (fails > 0) {
    console.log(err(`${fails} failure(s).`));
    process.exit(1);
  }
  if (warns > 0) {
    console.log(warn(`${warns} warning(s).`));
    process.exit(0);
  }
  console.log(ok('all checks passed'));
}

main().catch((e) => {
  console.error('status error:', (e as Error).message);
  process.exit(2);
});
