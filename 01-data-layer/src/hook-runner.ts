import * as path from 'path';
import * as fs from 'fs';
import lockfile from 'proper-lockfile';
import { loadConfig } from './config';
import { resolveProjectIdentity, normalizeGitUrl } from './identity';
import { buildLogEntry, appendLogEntry } from './logger';
import { loadWeights, updateWeight, saveWeights } from './weights';
import type { HookPayload, ConnectionType, ProjectIdentity, DerivedConnection } from './types';

const DEFAULT_DATA_ROOT = 'C:/dev/data/skill-connections';

// A skill identifier is kebab-case (deep-plan) or namespace:kebab-case (gsd:execute-phase).
// Single words without hyphens or colons are not skill names.
const SKILL_TOKEN_RE = /^[\w]+-[\w-]*(:([\w-]+))?$|^[\w]+:([\w-]+)$/;

// Common hyphenated English phrases that must not be mistaken for skill names.
const SKILL_STOP = new Set([
  'well-known', 'up-to-date', 'out-of-the-box', 'step-by-step', 'read-only',
  'high-level', 'low-level', 'built-in', 'end-to-end', 'real-time', 'hard-coded',
  'long-running', 'non-blocking', 'open-source', 'cross-platform', 'full-stack',
  'right-click', 'left-click', 'double-click', 'error-prone', 'first-class',
]);

const ABS_PATH_RE = /(?:[A-Za-z]:[/\\]\S*|\/\S+)/g;
const URL_RE = /(?:https?:\/\/[^\s]+|git@[^\s]+)(?<![.,;:)\]'"<>])/g;

/** Extracts a skill name from an Agent tool invocation's tool_input.
 *  Priority: recognizable token in description → subagent_type → "unknown-skill". */
export function extractSkillName(toolInput: Record<string, unknown>): string {
  const description = typeof toolInput['description'] === 'string' ? toolInput['description'] : '';
  if (description) {
    for (const token of description.split(/\s+/)) {
      if (SKILL_TOKEN_RE.test(token) && !SKILL_STOP.has(token.toLowerCase())) {
        return token;
      }
    }
  }

  const subagentType = typeof toolInput['subagent_type'] === 'string' ? toolInput['subagent_type'] : '';
  if (subagentType) {
    return subagentType;
  }

  return 'unknown-skill';
}

/** Scans tool_input for references to other projects. Returns project->project connections. Never throws. */
export async function extractProjectRefs(
  payload: HookPayload,
  identity: ProjectIdentity,
): Promise<DerivedConnection[]> {
  const refs: DerivedConnection[] = [];
  const seen = new Set<string>();

  const tryAdd = (targetId: string) => {
    if (targetId && targetId !== identity.id && !seen.has(targetId)) {
      seen.add(targetId);
      refs.push({
        connectionType: 'project->project' as ConnectionType,
        sourceNode: `project:${identity.id}`,
        targetNode: `project:${targetId}`,
      });
    }
  };

  try {
    const name = payload.tool_name;
    const input = payload.tool_input;

    if (name === 'Write' || name === 'Edit') {
      const filePath = typeof input['file_path'] === 'string' ? input['file_path'] : '';
      if (filePath) {
        try {
          const ref = await resolveProjectIdentity(path.dirname(filePath));
          tryAdd(ref.id);
        } catch { /* skip */ }
      }
    } else if (name === 'Bash') {
      const command = typeof input['command'] === 'string' ? input['command'] : '';
      for (const candidate of (command.match(ABS_PATH_RE) ?? [])) {
        if (fs.existsSync(candidate)) {
          try {
            const ref = await resolveProjectIdentity(path.dirname(candidate));
            tryAdd(ref.id);
          } catch { /* skip */ }
        }
      }
    } else if (name === 'Agent') {
      const texts = [
        typeof input['prompt'] === 'string' ? input['prompt'] : '',
        typeof input['description'] === 'string' ? input['description'] : '',
      ];
      for (const text of texts) {
        if (!text) continue;
        for (const url of (text.match(URL_RE) ?? [])) {
          tryAdd(normalizeGitUrl(url));
        }
        for (const candidate of (text.match(ABS_PATH_RE) ?? [])) {
          if (fs.existsSync(candidate)) {
            try {
              const ref = await resolveProjectIdentity(path.dirname(candidate));
              tryAdd(ref.id);
            } catch { /* skip */ }
          }
        }
      }
    }
  } catch { /* never throw */ }

  return refs;
}

/** Derives all connections produced by a single tool invocation. Never throws. */
export async function deriveConnections(
  payload: HookPayload,
  identity: ProjectIdentity,
): Promise<DerivedConnection[]> {
  const primary: DerivedConnection = payload.tool_name === 'Agent'
    ? {
        connectionType: 'project->skill',
        sourceNode: `project:${identity.id}`,
        targetNode: `skill:${extractSkillName(payload.tool_input)}`,
      }
    : {
        connectionType: 'project->tool',
        sourceNode: `project:${identity.id}`,
        targetNode: `tool:${payload.tool_name}`,
      };

  try {
    const secondary = await extractProjectRefs(payload, identity);
    return [primary, ...secondary];
  } catch {
    return [primary];
  }
}

/**
 * Walks up from startDir looking for a devneural.json file.
 * Returns { stage?, tags? } if found, undefined if not found or if JSON is malformed.
 * Never throws.
 */
export async function readDevneuralJson(
  startDir: string,
): Promise<{ stage?: string; tags?: string[] } | undefined> {
  let current = startDir;
  while (true) {
    const candidate = path.join(current, 'devneural.json');
    try {
      const content = await fs.promises.readFile(candidate, 'utf-8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (err) {
        console.warn('[DevNeural] devneural.json parse error:', err instanceof Error ? err.message : String(err));
        return undefined;
      }
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        const stage = typeof obj['stage'] === 'string' ? obj['stage'] : undefined;
        const tags = Array.isArray(obj['tags'])
          ? (obj['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
          : undefined;
        return { ...(stage !== undefined ? { stage } : {}), ...(tags !== undefined ? { tags } : {}) };
      }
      return undefined;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        console.warn('[DevNeural] devneural.json read error:', err instanceof Error ? err.message : String(err));
        return undefined;
      }
      // ENOENT — file not found at this level, walk up
    }
    const parent = path.dirname(current);
    if (parent === current) {
      // Reached filesystem root
      return undefined;
    }
    current = parent;
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const dataRoot = process.env['DEVNEURAL_DATA_ROOT'] ?? DEFAULT_DATA_ROOT;

  const rawInput = await readStdin();
  if (!rawInput.trim()) {
    return;
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(rawInput) as HookPayload;
  } catch {
    return;
  }

  const config = loadConfig(dataRoot);

  if (!config.allowlist.includes(payload.tool_name)) {
    return;
  }

  const identity = await resolveProjectIdentity(payload.cwd);
  const connections = await deriveConnections(payload, identity);
  const meta = await readDevneuralJson(payload.cwd);

  const entries = connections.map(conn =>
    buildLogEntry(payload, identity, conn.connectionType, conn.sourceNode, conn.targetNode, meta?.stage, meta?.tags),
  );

  const weightsPath = path.join(dataRoot, 'weights.json');

  await Promise.all([
    // Append each log entry concurrently.
    // NOTE: full tool_input is stored (may include large Write file contents). Truncation can be added later.
    Promise.all(entries.map(entry => appendLogEntry(entry, dataRoot))),
    // Single lock acquisition covers all weight updates for this event.
    (async () => {
      let release: (() => Promise<void>) | undefined;
      try {
        // proper-lockfile requires the target file to exist. Create an empty weights.json
        // on first run so the lock can be acquired before any write has occurred.
        if (!fs.existsSync(weightsPath)) {
          try {
            fs.writeFileSync(
              weightsPath,
              JSON.stringify({ schema_version: 1, updated_at: new Date().toISOString(), connections: {} }),
              { encoding: 'utf8', flag: 'wx' },
            );
          } catch { /* race: another process created it first — continue */ }
        }
        try {
          release = await lockfile.lock(weightsPath, { stale: 5000, retries: 3, realpath: false });
        } catch {
          // Lock failed — proceed without lock (weights are soft data; one lost update is acceptable)
        }
        const weights = loadWeights(dataRoot);
        const now = new Date();
        for (const conn of connections) {
          updateWeight(weights, conn.sourceNode, conn.targetNode, conn.connectionType, now);
        }
        await saveWeights(weights, dataRoot);
      } finally {
        if (release) {
          try { await release(); } catch { /* ignore unlock errors */ }
        }
      }
    })(),
  ]);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[DevNeural]', err instanceof Error ? err.message : String(err));
    process.exit(0);
  });
}
