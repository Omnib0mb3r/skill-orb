/**
 * Whats-new digest.
 *
 * Reads the wiki log + reinforcement log + recent file mtimes and
 * writes wiki/whats-new.md as a weekly view of what the system has
 * been doing. No LLM. Pure file aggregation.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  wikiPagesDir,
  wikiPendingDir,
  wikiArchiveDir,
  wikiWhatsNewFile,
  DATA_ROOT,
} from '../paths.js';
import { parsePage } from './schema.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface PageRow {
  id: string;
  title: string;
  status: string;
  weight: number;
  hits: number;
  corrections: number;
  last_touched: string;
  mtime: number;
  dir: 'pages' | 'pending' | 'archive';
}

export interface WhatsNewResult {
  total_pages: number;
  recently_created: number;
  recently_promoted: number;
  recently_archived: number;
  high_weight: PageRow[];
  reinforcement_events: number;
}

export function generateWhatsNew(daysWindow = 7): WhatsNewResult {
  const cutoff = Date.now() - daysWindow * MS_PER_DAY;
  const rows: PageRow[] = [];
  rows.push(...readDir(wikiPagesDir(), 'pages'));
  rows.push(...readDir(wikiPendingDir(), 'pending'));
  rows.push(...readDir(wikiArchiveDir(), 'archive'));

  const recentlyCreated = rows
    .filter((r) => Date.parse(r.last_touched) >= cutoff && r.dir === 'pending')
    .sort((a, b) => b.mtime - a.mtime);
  const recentlyPromoted = rows
    .filter((r) => r.dir === 'pages' && r.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime);
  const recentlyArchived = rows
    .filter((r) => r.dir === 'archive' && r.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime);

  const highWeight = rows
    .filter((r) => r.dir === 'pages')
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10);

  const reinforcementEvents = countReinforcementEvents(cutoff);

  const lines: string[] = [];
  lines.push(narrate(daysWindow, recentlyCreated.length, recentlyPromoted.length, recentlyArchived.length, reinforcementEvents, highWeight.length));
  lines.push('');
  if (recentlyPromoted.length > 0) {
    lines.push(`## Promoted to canonical`);
    for (const r of recentlyPromoted.slice(0, 12)) {
      lines.push(`- [${r.id}](/wiki?page=${encodeURIComponent(r.id)}) ${r.title}`);
    }
    lines.push('');
  }
  if (recentlyCreated.length > 0) {
    lines.push(`## New drafts`);
    for (const r of recentlyCreated.slice(0, 12)) {
      lines.push(`- [${r.id}](/wiki?page=${encodeURIComponent(r.id)}) ${r.title}`);
    }
    lines.push('');
  }
  if (highWeight.length > 0) {
    lines.push(`## Top by weight`);
    for (const r of highWeight) {
      lines.push(
        `- ${r.weight.toFixed(2)} [${r.id}](/wiki?page=${encodeURIComponent(r.id)}) (hits ${r.hits}, corr ${r.corrections})`,
      );
    }
    lines.push('');
  }
  if (recentlyArchived.length > 0) {
    lines.push(`## Archived`);
    for (const r of recentlyArchived.slice(0, 12)) {
      lines.push(`- ~~${r.id}~~ ${r.title}`);
    }
    lines.push('');
  }
  fs.writeFileSync(wikiWhatsNewFile(), lines.join('\n'), 'utf-8');

  return {
    total_pages: rows.length,
    recently_created: recentlyCreated.length,
    recently_promoted: recentlyPromoted.length,
    recently_archived: recentlyArchived.length,
    high_weight: highWeight,
    reinforcement_events: reinforcementEvents,
  };
}

function readDir(
  dir: string,
  tag: 'pages' | 'pending' | 'archive',
): PageRow[] {
  if (!fs.existsSync(dir)) return [];
  const out: PageRow[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const fp = path.posix.join(dir, file);
    try {
      const parsed = parsePage(fs.readFileSync(fp, 'utf-8'));
      const stat = fs.statSync(fp);
      out.push({
        id: parsed.frontmatter.id,
        title: parsed.frontmatter.title,
        status: parsed.frontmatter.status,
        weight: parsed.frontmatter.weight,
        hits: parsed.frontmatter.hits ?? 0,
        corrections: parsed.frontmatter.corrections ?? 0,
        last_touched: parsed.frontmatter.last_touched,
        mtime: stat.mtimeMs,
        dir: tag,
      });
    } catch {
      /* skip */
    }
  }
  return out;
}

/* Narrative summary in place of the prior bullet-list "Summary" block.
 * Plain English, present tense, written so the daily-brief panel reads
 * like a quick situational report rather than a stat dump. The numbers
 * still come from the same counters, just spoken instead of tabled. */
function narrate(
  daysWindow: number,
  created: number,
  promoted: number,
  archived: number,
  reinforcement: number,
  highWeight: number,
): string {
  const window = daysWindow === 1 ? '24 hours' : `${daysWindow} days`;
  const date = new Date().toISOString().slice(0, 10);
  const head = `# Brief — ${date}`;
  const sentences: string[] = [];

  if (created === 0 && promoted === 0 && archived === 0) {
    sentences.push(
      `Quiet ${window} on the wiki, sir. No new drafts captured, nothing promoted, nothing retired.`,
    );
  } else {
    const parts: string[] = [];
    if (created > 0) parts.push(`${created} new draft${created === 1 ? '' : 's'} captured`);
    if (promoted > 0) parts.push(`${promoted} promoted to canonical`);
    if (archived > 0) parts.push(`${archived} retired to the archive`);
    sentences.push(
      `Across the last ${window}, the wiki took on ${joinClauses(parts)}.`,
    );
  }

  if (reinforcement === 0) {
    sentences.push(
      `The reinforcement signal is still quiet — no captured pages have surfaced in conversation yet, so weights have nothing to lean on.`,
    );
  } else {
    sentences.push(
      `Reinforcement fired ${reinforcement} time${reinforcement === 1 ? '' : 's'}; the brain is starting to learn which pages earn their keep.`,
    );
  }

  if (highWeight === 0) {
    sentences.push(`No page has climbed above the noise floor yet. Early days.`);
  } else {
    sentences.push(
      `Top-weighted pages listed below; treat them as the first signal of what's actually useful.`,
    );
  }

  return `${head}\n\n${sentences.join(' ')}`;
}

function joinClauses(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function countReinforcementEvents(cutoffMs: number): number {
  const file = path.posix.join(DATA_ROOT, 'reinforcement.log.jsonl');
  if (!fs.existsSync(file)) return 0;
  let count = 0;
  try {
    const content = fs.readFileSync(file, 'utf-8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as { ts?: string };
        const t = obj.ts ? Date.parse(obj.ts) : 0;
        if (t >= cutoffMs) count++;
      } catch {
        continue;
      }
    }
  } catch {
    /* ignore */
  }
  return count;
}
