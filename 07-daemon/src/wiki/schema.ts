/**
 * Wiki page schema: parser, writer, validator.
 *
 * Pages are markdown files with YAML frontmatter. Body has fixed sections
 * (Pattern, Cross-references, Evidence, Open questions, Log). Hard rules
 * from DEVNEURAL.md:
 *
 *   - title format `[trigger] → [insight]`
 *   - summary required, ≤ 80 tokens (here: ≤ 600 chars as a coarse proxy)
 *   - body ≤ 800 tokens (≤ 6000 chars proxy)
 *   - cross_refs ≤ 8
 *   - evidence ≤ 20
 *   - filename matches frontmatter id
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type PageStatus = 'pending' | 'canonical' | 'archived';

export interface PageFrontmatter {
  id: string;
  title: string;
  trigger: string;
  insight: string;
  summary: string;
  status: PageStatus;
  weight: number;
  hits: number;
  corrections: number;
  created: string;
  last_touched: string;
  projects: string[];
  human_edited: boolean;
  human_edited_at?: string;
  flag_for_review?: boolean;
}

export interface PageSections {
  pattern: string;
  crossRefs: string[]; // resolved page ids (filename without .md)
  crossRefsRaw: { label: string; href: string }[];
  evidence: string[];
  openQuestions: string[];
  log: string[];
}

export interface ParsedPage {
  frontmatter: PageFrontmatter;
  sections: PageSections;
  raw: string;
}

const SUMMARY_MAX_CHARS = 600;
const BODY_MAX_CHARS = 6000;
const CROSS_REF_MAX = 8;
const EVIDENCE_MAX = 20;

export class PageValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
  }
}

export function parsePage(raw: string): ParsedPage {
  const fm = parseFrontmatter(raw);
  const body = stripFrontmatter(raw);
  const sections = parseSections(body);
  return { frontmatter: fm, sections, raw };
}

export function readPage(file: string): ParsedPage {
  const raw = fs.readFileSync(file, 'utf-8');
  return parsePage(raw);
}

export function writePage(
  dir: string,
  page: { frontmatter: PageFrontmatter; sections: PageSections },
): string {
  const issues = validatePage(page);
  if (issues.length > 0) {
    throw new PageValidationError(
      `page ${page.frontmatter.id} failed validation`,
      issues,
    );
  }
  const file = path.posix.join(dir, `${page.frontmatter.id}.md`);
  const raw = renderPage(page);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, raw, 'utf-8');
  return file;
}

export function renderPage(page: {
  frontmatter: PageFrontmatter;
  sections: PageSections;
}): string {
  const fm = page.frontmatter;
  const fmYaml = renderFrontmatter(fm);

  const crossRefs =
    page.sections.crossRefsRaw.length > 0
      ? page.sections.crossRefsRaw
          .map((r) => `- [${r.label}](${r.href})`)
          .join('\n')
      : '_(none)_';

  const evidence =
    page.sections.evidence.length > 0
      ? page.sections.evidence.map((e) => `- ${e}`).join('\n')
      : '_(pending evidence)_';

  const openQ =
    page.sections.openQuestions.length > 0
      ? page.sections.openQuestions.map((q) => `- ${q}`).join('\n')
      : '_(none)_';

  const log =
    page.sections.log.length > 0
      ? page.sections.log.map((l) => `- ${l}`).join('\n')
      : '_(none)_';

  return `---
${fmYaml}---

# ${fm.title}

## Pattern
${page.sections.pattern.trim()}

## Cross-references
${crossRefs}

## Evidence
${evidence}

## Open questions
${openQ}

## Log
${log}
`;
}

export function validatePage(page: {
  frontmatter: PageFrontmatter;
  sections: PageSections;
}): string[] {
  const issues: string[] = [];
  const fm = page.frontmatter;

  if (!fm.id || !/^[a-z0-9][a-z0-9-]+$/.test(fm.id)) {
    issues.push(`invalid id: ${fm.id}`);
  }
  if (!fm.title) issues.push('missing title');
  if (!fm.title.includes('→')) {
    issues.push(`title missing "→" separator: ${fm.title}`);
  }
  if (!fm.trigger) issues.push('missing trigger');
  if (!fm.insight) issues.push('missing insight');
  if (!fm.summary) issues.push('missing summary');
  if (fm.summary && fm.summary.length > SUMMARY_MAX_CHARS) {
    issues.push(
      `summary too long: ${fm.summary.length} > ${SUMMARY_MAX_CHARS} chars`,
    );
  }
  if (!['pending', 'canonical', 'archived'].includes(fm.status)) {
    issues.push(`invalid status: ${fm.status}`);
  }
  if (typeof fm.weight !== 'number' || fm.weight < 0 || fm.weight > 1) {
    issues.push(`invalid weight: ${fm.weight}`);
  }
  if (!fm.created) issues.push('missing created');
  if (!fm.last_touched) issues.push('missing last_touched');
  if (!Array.isArray(fm.projects)) issues.push('projects must be array');

  if (page.sections.pattern.length > BODY_MAX_CHARS) {
    issues.push(
      `pattern body too long: ${page.sections.pattern.length} > ${BODY_MAX_CHARS} chars`,
    );
  }
  if (page.sections.crossRefsRaw.length > CROSS_REF_MAX) {
    issues.push(
      `too many cross_refs: ${page.sections.crossRefsRaw.length} > ${CROSS_REF_MAX}`,
    );
  }
  if (page.sections.evidence.length > EVIDENCE_MAX) {
    issues.push(
      `too many evidence entries: ${page.sections.evidence.length} > ${EVIDENCE_MAX}`,
    );
  }

  return issues;
}

function parseFrontmatter(raw: string): PageFrontmatter {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    throw new Error('page missing frontmatter delimiters');
  }
  const yamlBody = match[1] ?? '';
  const obj = parseSimpleYaml(yamlBody);
  return normalizeFrontmatter(obj);
}

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\n[\s\S]*?\n---\n*/, '');
}

interface RawObj {
  [key: string]: unknown;
}

function parseSimpleYaml(yaml: string): RawObj {
  const result: RawObj = {};
  const lines = yaml.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }
    const key = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();

    if (rest === '|' || rest === '|-' || rest === '>' || rest === '>-') {
      // Block scalar
      const scalar: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i] ?? '';
        if (next.length === 0 || next.startsWith('  ')) {
          scalar.push(next.replace(/^ {2}/, ''));
          i++;
          continue;
        }
        break;
      }
      result[key] = scalar.join('\n').trim();
      continue;
    }

    if (rest === '' || rest === null) {
      // Inline list might follow with `- ` indented lines
      const list: unknown[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i] ?? '';
        const trimmed = next.trim();
        if (trimmed.startsWith('- ')) {
          list.push(parseScalar(trimmed.slice(2).trim()));
          i++;
          continue;
        }
        if (next === '' || next.match(/^\s/)) {
          i++;
          continue;
        }
        break;
      }
      result[key] = list;
      continue;
    }

    // Inline list?
    if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1).trim();
      if (inner.length === 0) {
        result[key] = [];
      } else {
        result[key] = inner
          .split(',')
          .map((item) => parseScalar(item.trim()));
      }
      i++;
      continue;
    }

    result[key] = parseScalar(rest);
    i++;
  }
  return result;
}

function parseScalar(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeFrontmatter(obj: RawObj): PageFrontmatter {
  return {
    id: String(obj.id ?? ''),
    title: String(obj.title ?? ''),
    trigger: String(obj.trigger ?? ''),
    insight: String(obj.insight ?? ''),
    summary: String(obj.summary ?? ''),
    status: (obj.status as PageStatus) ?? 'pending',
    weight: typeof obj.weight === 'number' ? obj.weight : 0.3,
    hits: typeof obj.hits === 'number' ? obj.hits : 0,
    corrections: typeof obj.corrections === 'number' ? obj.corrections : 0,
    created: String(obj.created ?? new Date().toISOString().slice(0, 10)),
    last_touched: String(
      obj.last_touched ?? new Date().toISOString().slice(0, 10),
    ),
    projects: Array.isArray(obj.projects)
      ? (obj.projects as unknown[]).map((p) => String(p))
      : [],
    human_edited: obj.human_edited === true,
    ...(obj.human_edited_at
      ? { human_edited_at: String(obj.human_edited_at) }
      : {}),
    ...(obj.flag_for_review === true ? { flag_for_review: true } : {}),
  };
}

function renderFrontmatter(fm: PageFrontmatter): string {
  const lines: string[] = [];
  lines.push(`id: ${fm.id}`);
  lines.push(`title: ${escapeScalar(fm.title)}`);
  lines.push(`trigger: ${escapeScalar(fm.trigger)}`);
  lines.push(`insight: ${escapeScalar(fm.insight)}`);
  lines.push(`summary: |`);
  for (const line of fm.summary.split('\n')) {
    lines.push(`  ${line}`);
  }
  lines.push(`status: ${fm.status}`);
  lines.push(`weight: ${fm.weight}`);
  lines.push(`hits: ${fm.hits}`);
  lines.push(`corrections: ${fm.corrections}`);
  lines.push(`created: ${fm.created}`);
  lines.push(`last_touched: ${fm.last_touched}`);
  if (fm.projects.length === 0) {
    lines.push(`projects: []`);
  } else {
    lines.push(`projects: [${fm.projects.map((p) => escapeScalar(p)).join(', ')}]`);
  }
  lines.push(`human_edited: ${fm.human_edited}`);
  if (fm.human_edited_at) lines.push(`human_edited_at: ${fm.human_edited_at}`);
  if (fm.flag_for_review) lines.push(`flag_for_review: true`);
  return lines.join('\n') + '\n';
}

function escapeScalar(value: string): string {
  if (
    value.includes(':') ||
    value.includes('"') ||
    value.includes("'") ||
    value.startsWith('-') ||
    value.includes('#')
  ) {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return value;
}

const SECTION_RE = /^## (.+)$/m;

function parseSections(body: string): PageSections {
  const sections: Record<string, string> = {};
  const titleStripped = body.replace(/^# .+\n+/, '');
  const parts = titleStripped.split(/^## /m);
  // First part is empty / pre-header content
  parts.shift();
  for (const part of parts) {
    const newlineIdx = part.indexOf('\n');
    const heading = newlineIdx === -1 ? part : part.slice(0, newlineIdx);
    const content = newlineIdx === -1 ? '' : part.slice(newlineIdx + 1);
    sections[heading.trim().toLowerCase()] = content.trim();
  }

  const pattern = sections['pattern'] ?? '';
  const crossRefsRaw = parseCrossRefs(sections['cross-references'] ?? '');
  const crossRefs = crossRefsRaw.map((r) => extractIdFromHref(r.href));
  const evidence = parseList(sections['evidence'] ?? '');
  const openQuestions = parseList(sections['open questions'] ?? '');
  const log = parseList(sections['log'] ?? '');
  return { pattern, crossRefs, crossRefsRaw, evidence, openQuestions, log };
}

function parseCrossRefs(text: string): { label: string; href: string }[] {
  const lines = text.split('\n');
  const result: { label: string; href: string }[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*-\s+\[([^\]]+)\]\(([^)]+)\)/);
    if (m) {
      result.push({ label: m[1] ?? '', href: m[2] ?? '' });
    }
  }
  return result;
}

function extractIdFromHref(href: string): string {
  const base = href.split('/').pop() ?? href;
  return base.replace(/\.md$/, '');
}

function parseList(text: string): string[] {
  const result: string[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*-\s+(.+)$/);
    if (m) result.push(m[1]?.trim() ?? '');
  }
  return result;
}

void SECTION_RE; // referenced for clarity
