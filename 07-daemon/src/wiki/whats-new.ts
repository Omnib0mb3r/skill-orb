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
  lines.push(`# What's new — ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push(`Window: last ${daysWindow} days`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push(`- pages created (pending): ${recentlyCreated.length}`);
  lines.push(`- pages promoted to canonical: ${recentlyPromoted.length}`);
  lines.push(`- pages archived: ${recentlyArchived.length}`);
  lines.push(`- reinforcement events: ${reinforcementEvents}`);
  lines.push('');
  if (recentlyPromoted.length > 0) {
    lines.push(`## Promoted to canonical`);
    for (const r of recentlyPromoted.slice(0, 12)) {
      lines.push(`- [${r.id}](./pages/${r.id}.md) — ${r.title}`);
    }
    lines.push('');
  }
  if (recentlyCreated.length > 0) {
    lines.push(`## New drafts`);
    for (const r of recentlyCreated.slice(0, 12)) {
      lines.push(`- [${r.id}](./pending/${r.id}.md) — ${r.title}`);
    }
    lines.push('');
  }
  if (highWeight.length > 0) {
    lines.push(`## Top by weight`);
    for (const r of highWeight) {
      lines.push(
        `- ${r.weight.toFixed(2)} [${r.id}](./pages/${r.id}.md) (hits ${r.hits}, corr ${r.corrections})`,
      );
    }
    lines.push('');
  }
  if (recentlyArchived.length > 0) {
    lines.push(`## Archived`);
    for (const r of recentlyArchived.slice(0, 12)) {
      lines.push(`- ~~${r.id}~~ — ${r.title}`);
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
