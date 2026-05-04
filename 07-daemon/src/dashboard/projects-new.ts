/**
 * "+ New Project" flow.
 *
 * Clones github.com/Omnib0mb3r/dev-template into C:/dev/Projects/<name>,
 * fills devneural.jsonc, registers the project, optionally opens VS
 * Code on the host machine.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { spawn } from 'node:child_process';

const TEMPLATE_REPO =
  process.env.DEVNEURAL_TEMPLATE_REPO ??
  'https://github.com/Omnib0mb3r/dev-template';
const PROJECTS_ROOT = (
  process.env.DEVNEURAL_PROJECTS_ROOT ?? 'C:/dev/Projects'
).replace(/\\/g, '/');

export interface NewProjectInput {
  name: string;
  stage?: 'alpha' | 'beta' | 'deployed' | 'archived';
  tags?: string[];
  description?: string;
  open_vscode?: boolean;
}

export interface NewProjectResult {
  ok: boolean;
  path?: string;
  error?: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]+$/;

export async function createProject(
  input: NewProjectInput,
): Promise<NewProjectResult> {
  if (!input.name || !NAME_RE.test(input.name)) {
    return {
      ok: false,
      error:
        'name must be kebab-case (lowercase letters, digits, hyphens; cannot start with hyphen)',
    };
  }
  const target = path.posix.join(PROJECTS_ROOT, input.name);
  if (fs.existsSync(target)) {
    return { ok: false, error: `path already exists: ${target}` };
  }

  // Clone the template
  try {
    execSync(`git clone --depth 1 ${TEMPLATE_REPO} "${target}"`, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
      windowsHide: true,
    });
  } catch (err) {
    return { ok: false, error: `git clone failed: ${(err as Error).message}` };
  }

  // Detach from the template's history so this is its own repo
  try {
    fs.rmSync(path.posix.join(target, '.git'), { recursive: true, force: true });
    execSync('git init -q', { cwd: target, stdio: 'ignore', windowsHide: true });
  } catch {
    /* non-fatal */
  }

  // Fill devneural.jsonc
  const configFile = path.posix.join(target, 'devneural.jsonc');
  if (fs.existsSync(configFile)) {
    let raw = fs.readFileSync(configFile, 'utf-8');
    raw = raw
      .replace(/REPLACE_ME_NAME|"name":\s*"REPLACE_ME"/g, `"name": "${input.name}"`)
      .replace(
        /REPLACE_ME_LOCAL_PATH|"localPath":\s*"REPLACE_ME"/g,
        `"localPath": "${target}"`,
      )
      .replace(
        /"stage":\s*"REPLACE_ME"|REPLACE_ME_STAGE/g,
        `"stage": "${input.stage ?? 'alpha'}"`,
      )
      .replace(
        /"description":\s*"REPLACE_ME"|REPLACE_ME_DESCRIPTION/g,
        `"description": "${(input.description ?? '').replace(/"/g, "'")}"`,
      );

    if (input.tags && input.tags.length > 0) {
      raw = raw.replace(
        /"tags":\s*\[\s*\]/,
        `"tags": [${input.tags.map((t) => `"${t}"`).join(', ')}]`,
      );
    }

    fs.writeFileSync(configFile, raw, 'utf-8');
  }

  // Optionally open VS Code (host only)
  if (input.open_vscode !== false) {
    try {
      spawn('code', [target], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch {
      /* VS Code not on PATH; not fatal */
    }
  }

  return { ok: true, path: target };
}
