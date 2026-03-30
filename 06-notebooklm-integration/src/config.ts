import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ObsidianSyncConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ConfigSchema = z.object({
  vault_path: z.string().min(1),
  data_root: z.string().min(1),
  notes_subfolder: z.string().default('DevNeural/Projects'),
  api_base_url: z.string().default('http://localhost:3747'),
  prepend_sessions: z.boolean().default(true),
  claude_model: z.string().default('claude-haiku-4-5-20251001'),
});

export function loadConfig(configPath?: string): ObsidianSyncConfig {
  const resolved =
    configPath ??
    process.env.DEVNEURAL_OBSIDIAN_CONFIG ??
    resolve(__dirname, 'config.json');

  let raw: string;
  try {
    raw = readFileSync(resolved, 'utf-8');
  } catch {
    throw new Error(
      `Config file not found: ${resolved}. Copy config.example.json and fill in vault_path and data_root.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Config file is not valid JSON: ${resolved}`);
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.errors[0];
    const fieldPath = first.path.join('.') || '(root)';
    throw new Error(`Config validation error at '${fieldPath}': ${first.message}`);
  }

  return result.data as ObsidianSyncConfig;
}

export function checkApiKey(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write(
      'Error: ANTHROPIC_API_KEY is not set. Export it before running devneural-obsidian-sync.\n',
    );
    process.exit(1);
  }
}
