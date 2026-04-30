/**
 * Source scanners for the initial corpus ingest.
 *
 * Walks the user's existing knowledge corpus on first daemon launch
 * (or when /devneural-reseed runs) and produces ingest inputs:
 *
 *   1. ~/.claude/skills/<skill>/SKILL.md and plugin skills
 *   2. c:/dev/Projects/<repo>/{README.md, CLAUDE.md, devneural.jsonc, OTLC-Brainstorm.MD}
 *   3. ~/.claude/projects/<slug>/<session>.jsonl  (replayed)
 *   4. Recent commits in active repos (last 6 months)
 *
 * Each source produces an IngestInput that the ingest pipeline consumes.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import type { IngestInput } from '../wiki/ingest.js';
import { resolveProjectIdentity } from '../identity/project-id.js';

const HOME = os.homedir();

export interface ScanOptions {
  projectsRoot?: string;
  skillsRoot?: string;
  pluginsRoot?: string;
  sessionsRoot?: string;
  maxSessions?: number;
  maxCommitsPerProject?: number;
}

export async function* scanSkills(
  options: ScanOptions = {},
): AsyncGenerator<IngestInput> {
  const skillsRoot =
    options.skillsRoot ?? path.posix.join(HOME, '.claude', 'skills').replace(/\\/g, '/');
  const pluginsRoot =
    options.pluginsRoot ?? path.posix.join(HOME, '.claude', 'plugins').replace(/\\/g, '/');

  const roots = [skillsRoot, pluginsRoot].filter((r) => fs.existsSync(r));
  for (const root of roots) {
    for (const file of walkSkillFiles(root)) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        if (content.trim().length < 80) continue;
        const skillName = inferSkillName(file);
        yield {
          source: `corpus:skill:${skillName}`,
          projectId: 'global',
          projectName: 'global',
          newContent: content.slice(0, 8000),
          evidenceHints: [`SKILL.md at ${file}`],
        };
      } catch {
        /* unreadable; skip */
      }
    }
  }
}

function walkSkillFiles(dir: string, depth = 0): string[] {
  if (depth > 6) return [];
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.posix.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...walkSkillFiles(p, depth + 1));
    } else if (e.isFile() && e.name === 'SKILL.md') {
      out.push(p);
    }
  }
  return out;
}

function inferSkillName(file: string): string {
  return path.basename(path.dirname(file));
}

export async function* scanProjects(
  options: ScanOptions = {},
): AsyncGenerator<IngestInput> {
  const root =
    options.projectsRoot ?? 'C:/dev/Projects';
  if (!fs.existsSync(root)) return;

  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const projectRoot = path.posix.join(root, e.name);
    const identity = resolveProjectIdentity(projectRoot);
    if (identity.id === 'global') continue;

    const sources: { name: string; path: string }[] = [
      { name: 'README.md', path: path.posix.join(projectRoot, 'README.md') },
      { name: 'CLAUDE.md', path: path.posix.join(projectRoot, 'CLAUDE.md') },
      {
        name: 'devneural.jsonc',
        path: path.posix.join(projectRoot, 'devneural.jsonc'),
      },
      {
        name: 'OTLC-Brainstorm.MD',
        path: path.posix.join(projectRoot, 'OTLC-Brainstorm.MD'),
      },
    ];

    for (const source of sources) {
      if (!fs.existsSync(source.path)) continue;
      let content: string;
      try {
        content = fs.readFileSync(source.path, 'utf-8');
      } catch {
        continue;
      }
      if (content.trim().length < 80) continue;
      yield {
        source: `corpus:project:${identity.name}:${source.name}`,
        projectId: identity.id,
        projectName: identity.name,
        newContent: content.slice(0, 12000),
        evidenceHints: [`${source.name} at ${source.path}`],
      };
    }
  }
}

export async function* scanCommits(
  options: ScanOptions = {},
): AsyncGenerator<IngestInput> {
  const root =
    options.projectsRoot ?? 'C:/dev/Projects';
  if (!fs.existsSync(root)) return;
  const max = options.maxCommitsPerProject ?? 50;

  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const projectRoot = path.posix.join(root, e.name);
    if (!fs.existsSync(path.posix.join(projectRoot, '.git'))) continue;
    const identity = resolveProjectIdentity(projectRoot);
    if (identity.id === 'global') continue;

    let log: string;
    try {
      log = execSync(
        `git log --since="6 months ago" --pretty=format:"%h%x09%s" -n ${max}`,
        {
          cwd: projectRoot,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
    } catch {
      continue;
    }

    if (!log.trim()) continue;
    yield {
      source: `corpus:commits:${identity.name}`,
      projectId: identity.id,
      projectName: identity.name,
      newContent: `Recent commits in ${identity.name}:\n\n${log}`,
      evidenceHints: [`git log in ${projectRoot}`],
    };
  }
}

export async function* scanSessions(
  options: ScanOptions = {},
): AsyncGenerator<IngestInput> {
  const root =
    options.sessionsRoot ?? path.posix.join(HOME, '.claude', 'projects').replace(/\\/g, '/');
  if (!fs.existsSync(root)) return;
  const max = options.maxSessions ?? 25;

  const slugs = fs.readdirSync(root, { withFileTypes: true });
  let count = 0;
  for (const slug of slugs) {
    if (!slug.isDirectory()) continue;
    const slugDir = path.posix.join(root, slug.name);
    const sessions = fs
      .readdirSync(slugDir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .reverse(); // newest first
    for (const sess of sessions) {
      if (count >= max) return;
      const file = path.posix.join(slugDir, sess);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      if (stat.size < 1024) continue;
      if (stat.size > 5 * 1024 * 1024) continue; // skip massive sessions in seed pass

      const content = readSessionDigest(file);
      if (!content || content.length < 200) continue;

      const cwd = inferCwdFromSlug(slug.name);
      const identity = cwd ? resolveProjectIdentity(cwd) : null;
      yield {
        source: `corpus:session:${sess.replace('.jsonl', '')}`,
        projectId: identity?.id ?? 'global',
        projectName: identity?.name ?? 'global',
        newContent: content.slice(0, 12000),
        evidenceHints: [`session ${sess} in ${slugDir}`],
      };
      count++;
    }
  }
}

function readSessionDigest(file: string): string {
  // For corpus seed we sample turn-by-turn prose without holding
  // the whole transcript in memory. Stream by line, keep top-N.
  const out: string[] = [];
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    let leftover = '';
    let read = 0;
    while (out.length < 60) {
      const n = fs.readSync(fd, buf, 0, buf.length, read);
      if (n === 0) break;
      read += n;
      const chunk = leftover + buf.subarray(0, n).toString('utf-8');
      const lines = chunk.split('\n');
      leftover = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as {
            message?: { content?: unknown; role?: string };
            type?: string;
          };
          const role = obj.message?.role ?? obj.type ?? 'unknown';
          const text = extractText(obj);
          if (!text) continue;
          out.push(`[${role}] ${text.slice(0, 600)}`);
          if (out.length >= 60) break;
        } catch {
          continue;
        }
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return out.join('\n\n');
}

function extractText(obj: {
  message?: { content?: unknown };
}): string {
  const c = obj.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((b) => {
        if (
          b &&
          typeof b === 'object' &&
          (b as { type?: string }).type === 'text'
        ) {
          return (b as { text?: string }).text ?? '';
        }
        return '';
      })
      .join('\n');
  }
  return '';
}

function inferCwdFromSlug(slug: string): string | null {
  // Claude Code slug pattern: c--dev-Projects-DevNeural -> C:/dev/Projects/DevNeural
  const m = slug.match(/^([a-z])--?(.+)$/);
  if (!m) return null;
  const drive = (m[1] ?? 'c').toUpperCase();
  const rest = (m[2] ?? '').replace(/-/g, '/');
  const candidate = `${drive}:/${rest}`;
  if (fs.existsSync(candidate)) return candidate;
  return null;
}
