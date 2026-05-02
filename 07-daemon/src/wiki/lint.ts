/**
 * Lint operation.
 *
 * Sampled maintenance pass. Per docs/spec/devneural-v2.md section
 * 6.5 / DEVNEURAL.md section 4.
 *
 * Sample set:
 *   - all pending/ pages
 *   - all canonical/ pages with weight < 0.2
 *   - 50 random canonical/ pages
 *   - all pages flagged for review
 *
 * Auto-applied (safe):
 *   - shape constraint repairs (oversize summary, missing log lines,
 *     broken cross-ref hrefs)
 *   - archive of stale pending pages (>30 days, single observation)
 *   - archive of canonical pages with weight < 0.15 and last_touched
 *     > 90 days
 *
 * Produces:
 *   - lint-report.md at wiki root, listing actions and proposals
 *   - applies safe actions immediately
 *   - merges and contradiction flags require explicit --apply
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  wikiPagesDir,
  wikiPendingDir,
  wikiArchiveDir,
  wikiRoot,
  ensureDir,
} from '../paths.js';
import {
  parsePage,
  writePage,
  validatePage,
  type ParsedPage,
} from './schema.js';
import { appendLog, commitWiki } from './scaffolding.js';

const PENDING_TTL_DAYS = 30;
const ARCHIVE_FLOOR = 0.15;
const STALE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface LintAction {
  kind:
    | 'shape-fix'
    | 'archive-pending-stale'
    | 'archive-canonical-stale'
    | 'archive-low-weight'
    | 'flag-shape'
    | 'flag-orphan';
  page_id: string;
  detail: string;
  applied: boolean;
}

export interface LintResult {
  scanned: number;
  actions: LintAction[];
  apply: boolean;
}

export interface LintOptions {
  apply?: boolean;
  sampleCanonical?: number;
}

export async function runLint(opts: LintOptions = {}): Promise<LintResult> {
  const apply = Boolean(opts.apply);
  const result: LintResult = { scanned: 0, actions: [], apply };

  const pages = collectSample(opts.sampleCanonical ?? 50);
  result.scanned = pages.length;

  const today = Date.now();

  for (const entry of pages) {
    const fm = entry.parsed.frontmatter;
    const sections = entry.parsed.sections;

    // Shape repair (auto-apply)
    const shapeIssues = validatePage({ frontmatter: fm, sections });
    if (shapeIssues.length > 0) {
      const fixed = autoFixShape(entry, shapeIssues);
      if (fixed.applied && apply) {
        result.actions.push({
          kind: 'shape-fix',
          page_id: fm.id,
          detail: shapeIssues.join('; '),
          applied: true,
        });
      } else {
        result.actions.push({
          kind: 'flag-shape',
          page_id: fm.id,
          detail: shapeIssues.join('; '),
          applied: false,
        });
      }
    }

    // Pending TTL
    if (fm.status === 'pending') {
      const age = today - new Date(fm.last_touched).getTime();
      const days = age / MS_PER_DAY;
      if (days >= PENDING_TTL_DAYS && (fm.hits ?? 0) === 0) {
        if (apply) {
          archivePage(entry);
          result.actions.push({
            kind: 'archive-pending-stale',
            page_id: fm.id,
            detail: `pending ${Math.floor(days)}d, no hits`,
            applied: true,
          });
        } else {
          result.actions.push({
            kind: 'archive-pending-stale',
            page_id: fm.id,
            detail: `pending ${Math.floor(days)}d, no hits`,
            applied: false,
          });
        }
        continue;
      }
    }

    // Canonical low-weight stale
    if (fm.status === 'canonical') {
      const age = today - new Date(fm.last_touched).getTime();
      const days = age / MS_PER_DAY;
      if (fm.weight < ARCHIVE_FLOOR && days >= STALE_DAYS) {
        if (apply) {
          archivePage(entry);
          result.actions.push({
            kind: 'archive-canonical-stale',
            page_id: fm.id,
            detail: `weight ${fm.weight.toFixed(2)}, ${Math.floor(days)}d stale`,
            applied: true,
          });
        } else {
          result.actions.push({
            kind: 'archive-canonical-stale',
            page_id: fm.id,
            detail: `weight ${fm.weight.toFixed(2)}, ${Math.floor(days)}d stale`,
            applied: false,
          });
        }
      }
    }
  }

  writeReport(result);
  if (apply) {
    appendLog(
      `lint: scanned=${result.scanned} actions=${result.actions.length}`,
    );
    commitWiki('lint pass');
  }
  return result;
}

interface SampleEntry {
  filePath: string;
  parsed: ParsedPage;
}

function collectSample(canonicalSampleSize: number): SampleEntry[] {
  const result: SampleEntry[] = [];

  // All pending
  result.push(...readDir(wikiPendingDir()));

  // Canonical: low-weight + flagged + sample
  const canonical = readDir(wikiPagesDir());
  const lowWeight = canonical.filter((c) => c.parsed.frontmatter.weight < 0.2);
  const flagged = canonical.filter((c) => c.parsed.frontmatter.flag_for_review);
  const set = new Set<string>();
  for (const c of [...lowWeight, ...flagged]) {
    set.add(c.filePath);
    result.push(c);
  }
  // Random sample, excluding already-included
  const remaining = canonical.filter((c) => !set.has(c.filePath));
  const sample = randomSample(remaining, canonicalSampleSize);
  result.push(...sample);

  return result;
}

function readDir(dir: string): SampleEntry[] {
  if (!fs.existsSync(dir)) return [];
  const entries: SampleEntry[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const filePath = path.posix.join(dir, file);
    try {
      const parsed = parsePage(fs.readFileSync(filePath, 'utf-8'));
      entries.push({ filePath, parsed });
    } catch {
      /* skip malformed */
    }
  }
  return entries;
}

function randomSample<T>(items: T[], k: number): T[] {
  if (items.length <= k) return items.slice();
  const result: T[] = [];
  const used = new Set<number>();
  while (result.length < k && used.size < items.length) {
    const idx = Math.floor(Math.random() * items.length);
    if (used.has(idx)) continue;
    used.add(idx);
    const item = items[idx];
    if (item !== undefined) result.push(item);
  }
  return result;
}

function autoFixShape(
  entry: SampleEntry,
  issues: string[],
): { applied: boolean } {
  const parsed = entry.parsed;
  const fm = { ...parsed.frontmatter };
  const sections = { ...parsed.sections };
  let applied = false;

  for (const issue of issues) {
    if (issue.includes('summary too long')) {
      fm.summary = fm.summary.slice(0, 500) + '...';
      applied = true;
    }
    if (issue.includes('too many cross_refs')) {
      sections.crossRefsRaw = sections.crossRefsRaw.slice(0, 8);
      sections.crossRefs = sections.crossRefs.slice(0, 8);
      applied = true;
    }
    if (issue.includes('too many evidence')) {
      sections.evidence = sections.evidence.slice(0, 20);
      applied = true;
    }
    // Shape issues that are not safe to auto-fix (e.g. missing →) get
    // flagged instead.
  }

  if (applied) {
    const dir = path.dirname(entry.filePath).replace(/\\/g, '/');
    try {
      writePage(dir, { frontmatter: fm, sections });
    } catch {
      return { applied: false };
    }
  }
  return { applied };
}

function archivePage(entry: SampleEntry): void {
  const fileName = path.basename(entry.filePath);
  const target = path.posix.join(wikiArchiveDir(), fileName);
  ensureDir(wikiArchiveDir());
  // Rewrite frontmatter with archived status before move.
  const fm = { ...entry.parsed.frontmatter, status: 'archived' as const };
  writePage(path.dirname(entry.filePath).replace(/\\/g, '/'), {
    frontmatter: fm,
    sections: entry.parsed.sections,
  });
  fs.renameSync(entry.filePath, target);
}

function writeReport(result: LintResult): void {
  ensureDir(wikiRoot());
  const file = path.posix.join(wikiRoot(), 'lint-report.md');
  const lines: string[] = [];
  lines.push('# Lint report');
  lines.push('');
  lines.push(`- run: ${new Date().toISOString()}`);
  lines.push(`- scanned: ${result.scanned}`);
  lines.push(`- applied: ${result.apply}`);
  lines.push(`- actions: ${result.actions.length}`);
  lines.push('');
  if (result.actions.length === 0) {
    lines.push('No actions.');
  } else {
    const byKind = new Map<string, LintAction[]>();
    for (const a of result.actions) {
      const list = byKind.get(a.kind) ?? [];
      list.push(a);
      byKind.set(a.kind, list);
    }
    for (const [kind, actions] of byKind) {
      lines.push(`## ${kind} (${actions.length})`);
      for (const a of actions) {
        const tag = a.applied ? '[applied]' : '[proposed]';
        lines.push(`- ${tag} ${a.page_id}: ${a.detail}`);
      }
      lines.push('');
    }
  }
  fs.writeFileSync(file, lines.join('\n'), 'utf-8');
}
