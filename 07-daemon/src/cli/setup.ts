#!/usr/bin/env node
/**
 * devneural-setup: one-command setup.
 *
 * Idempotent. Safe to re-run. Performs:
 *   1. Create data root + wiki scaffolding
 *   2. Verify ollama is running and the default model is pulled
 *   3. Install hooks in ~/.claude/settings.json (with backup)
 *   4. Print final status
 *
 * Does NOT install ollama or pull models for you. Prints clear
 * instructions if either is missing.
 */
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureDataRoot,
  DATA_ROOT,
} from '../paths.js';
import { ensureWiki } from '../wiki/scaffolding.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function color(t: string, c: number): string {
  if (process.env.NO_COLOR) return t;
  return `\x1b[${c}m${t}\x1b[0m`;
}
const ok = (t: string) => color(t, 32);
const warn = (t: string) => color(t, 33);
const err = (t: string) => color(t, 31);
const dim = (t: string) => color(t, 90);

async function step1Data(): Promise<void> {
  console.log(`\n${ok('▸')} Setting up data root at ${DATA_ROOT}`);
  ensureDataRoot();
  const result = ensureWiki();
  console.log(
    `  wiki: created=${result.created.length} updated=${result.updated.length} present=${result.alreadyPresent.length}`,
  );
}

async function step2Ollama(): Promise<void> {
  const provider = (process.env.DEVNEURAL_LLM_PROVIDER ?? 'ollama').toLowerCase();
  if (provider !== 'ollama') {
    console.log(`\n${ok('▸')} LLM provider = ${provider} (ollama check skipped)`);
    return;
  }
  const host = process.env.DEVNEURAL_OLLAMA_HOST ?? 'http://localhost:11434';
  const model = process.env.DEVNEURAL_OLLAMA_MODEL ?? 'qwen3:8b';
  console.log(`\n${ok('▸')} Checking ollama at ${host}`);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${host}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { models?: { name: string }[] };
    const tags = body.models?.map((m) => m.name) ?? [];
    if (tags.length === 0) {
      console.log(`  ${warn('ollama is running but has no models.')}`);
      console.log(`  ${dim('Run: ollama pull ' + model)}`);
      return;
    }
    const hasModel = tags.some(
      (t) => t === model || t.startsWith(`${model.split(':')[0]}:`),
    );
    if (!hasModel) {
      console.log(`  ${warn('Model ' + model + ' is not pulled.')}`);
      console.log(`  ${dim('Run: ollama pull ' + model)}`);
      console.log(`  ${dim('Available: ' + tags.join(', '))}`);
      return;
    }
    console.log(`  ${ok('ollama ready')}: ${tags.join(', ')}`);
  } catch (e) {
    console.log(`  ${err('ollama unreachable')}: ${(e as Error).message}`);
    console.log(`  ${dim('Install from https://ollama.com')}`);
    console.log(`  ${dim('Then: ollama serve  (or run the desktop app)')}`);
    console.log(`  ${dim('Then: ollama pull ' + model)}`);
  }
}

function step3Hooks(): void {
  console.log(`\n${ok('▸')} Installing Claude Code hooks`);
  const installScript = path.resolve(
    __dirname,
    '..',
    'capture',
    'hooks',
    'install-hooks.js',
  );
  if (!fs.existsSync(installScript)) {
    console.log(`  ${err('install-hooks.js not built')}`);
    return;
  }
  const child = spawnSync(process.execPath, [installScript], {
    stdio: 'inherit',
  });
  if (child.status !== 0) {
    console.log(`  ${err('install-hooks failed with exit ' + child.status)}`);
  }
}

function step4Status(): void {
  console.log(`\n${ok('▸')} Final status`);
  const statusScript = path.resolve(__dirname, 'status.js');
  if (!fs.existsSync(statusScript)) return;
  spawnSync(process.execPath, [statusScript], { stdio: 'inherit' });
}

async function main(): Promise<void> {
  console.log(ok('DevNeural setup'));
  console.log('================');
  await step1Data();
  await step2Ollama();
  step3Hooks();
  step4Status();
  console.log('');
  console.log(ok('setup done.'));
  console.log(
    dim('  Daemon will lazy-start on the next Claude tool call. To start now:'),
  );
  console.log(`  ${dim('npm run start')}`);
}

main().catch((e) => {
  console.error('setup error:', (e as Error).message);
  process.exit(1);
});
