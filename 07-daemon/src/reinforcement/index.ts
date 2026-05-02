/**
 * Reinforcement loop.
 *
 * After /curate produces an injection for a session, we record
 * (sessionId → {pageId, prompt, timestamp}) in a pending-injection
 * tracker. When the transcript watcher sees the next assistant turn
 * for that session, we measure whether the reply leaned on the
 * injected page (cosine over reply vs page summary). When the next
 * user prompt arrives, we look for correction language.
 *
 * Outcomes:
 *   - HIT: weight ↑ (1 - w) * 0.05, hits++.
 *   - CORRECTION: weight ↓ w * 0.10, corrections++, blacklist for session.
 *   - NEITHER: slow decay weight *= 0.995.
 *
 * Promotion:
 *   - A pending page with a HIT (no correction within N turns) is
 *     promoted to canonical immediately. Useful retrieval is the
 *     empirical proof a page transfers.
 *   - A pending page with corrections >= 3 is archived.
 *
 * Coverage gap and bypass signals fire from the curator path when
 * raw chunks outrank or fill gaps that wiki pages do not cover.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { embedOne } from '../embedder/index.js';
import type { Store, WikiPageMetadata } from '../store/index.js';
import {
  parsePage,
  writePage,
  type PageFrontmatter,
} from '../wiki/schema.js';
import {
  wikiPagesDir,
  wikiPendingDir,
  wikiArchiveDir,
  DATA_ROOT,
  ensureDir,
} from '../paths.js';
import { appendLog, commitWiki } from '../wiki/scaffolding.js';
import { blacklistPageForSession } from '../curation/curator.js';

const HIT_COSINE = Number(process.env.DEVNEURAL_HIT_COSINE ?? 0.65);
const HIT_WEIGHT_GAIN = 0.05;
const CORRECTION_WEIGHT_LOSS = 0.10;
const DECAY_PER_SESSION = 0.995;
const ARCHIVE_FLOOR = 0.15;
const PENDING_TTL_MS = 10 * 60 * 1000; // 10 min — stale pending discarded

const CORRECTION_PATTERNS = [
  /\bno\b/i,
  /\bactually\b/i,
  /\bwrong\b/i,
  /\bincorrect\b/i,
  /\bnot what i\b/i,
  /\bthat['’]s not\b/i,
  /\binstead\b/i,
  /\brevert\b/i,
  /\bundo\b/i,
];

interface Pending {
  sessionId: string;
  pageId: string;
  pagePath: string;
  injectedAt: number;
  summary: string;
}

const pending = new Map<string, Pending>();

const reinforcementLog = path.posix.join(DATA_ROOT, 'reinforcement.log.jsonl');

function appendReinforcementLog(entry: Record<string, unknown>): void {
  ensureDir(DATA_ROOT);
  try {
    fs.appendFileSync(
      reinforcementLog,
      JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n',
      'utf-8',
    );
  } catch {
    /* ignore */
  }
}

export function recordInjection(
  sessionId: string,
  pageId: string,
  pagePath: string,
  summary: string,
): void {
  pending.set(sessionId, {
    sessionId,
    pageId,
    pagePath,
    injectedAt: Date.now(),
    summary,
  });
}

export function clearPending(sessionId: string): void {
  pending.delete(sessionId);
}

export function getPending(sessionId: string): Pending | null {
  const p = pending.get(sessionId);
  if (!p) return null;
  if (Date.now() - p.injectedAt > PENDING_TTL_MS) {
    pending.delete(sessionId);
    return null;
  }
  return p;
}

interface PageOnDisk {
  filePath: string;
  raw: string;
  frontmatter: PageFrontmatter;
  body: string;
}

function findPageFile(pageId: string): string | null {
  for (const dir of [wikiPagesDir(), wikiPendingDir(), wikiArchiveDir()]) {
    const file = path.posix.join(dir, `${pageId}.md`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function loadPage(pageId: string): PageOnDisk | null {
  const filePath = findPageFile(pageId);
  if (!filePath) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = parsePage(raw);
  return {
    filePath,
    raw,
    frontmatter: parsed.frontmatter,
    body: raw,
  };
}

function rewritePageFrontmatter(
  page: PageOnDisk,
  fm: PageFrontmatter,
): void {
  // Preserve body (everything after the second `---`); rewrite only frontmatter.
  const parsed = parsePage(page.raw);
  const dir = path.dirname(page.filePath).replace(/\\/g, '/');
  writePage(dir, { frontmatter: fm, sections: parsed.sections });
}

function moveTo(page: PageOnDisk, targetDir: string): string {
  const fileName = path.basename(page.filePath);
  const target = path.posix.join(targetDir, fileName);
  ensureDir(targetDir);
  fs.copyFileSync(page.filePath, target);
  fs.unlinkSync(page.filePath);
  return target;
}

async function reindexPage(store: Store, page: PageOnDisk): Promise<void> {
  const fm = page.frontmatter;
  const tsMs = Date.now();
  store.db.upsertWikiPage(
    {
      id: fm.id,
      title: fm.title,
      trigger: fm.trigger,
      insight: fm.insight,
      status: fm.status,
      weight: fm.weight,
      hits: fm.hits,
      corrections: fm.corrections,
      created_ms: new Date(fm.created).getTime() || tsMs,
      last_touched_ms: tsMs,
      projects_json: JSON.stringify(fm.projects),
      human_edited: fm.human_edited ? 1 : 0,
    },
    parsePage(page.raw).sections.pattern,
  );
  const embedText = `${fm.title}\n${fm.summary}\n${parsePage(page.raw).sections.pattern.slice(0, 2000)}`;
  const vec = await embedOne(embedText);
  await store.wikiPages.add({
    id: fm.id,
    vector: vec,
    metadata: {
      status: fm.status,
      weight: fm.weight,
      trigger: fm.trigger,
      insight: fm.insight,
      title: fm.title,
    },
  });
}

export async function evaluateAssistantReply(
  store: Store,
  sessionId: string,
  replyText: string,
  log: (msg: string) => void = () => undefined,
): Promise<void> {
  const p = getPending(sessionId);
  if (!p) return;
  if (replyText.trim().length < 80) return; // skip empty / trivial

  let cosine = 0;
  try {
    const replyVec = await embedOne(replyText.slice(0, 4000));
    const summaryVec = await embedOne(p.summary.slice(0, 4000));
    cosine = dot(replyVec, summaryVec);
  } catch {
    return;
  }

  if (cosine < HIT_COSINE) {
    appendReinforcementLog({
      kind: 'no-hit',
      session: sessionId,
      page: p.pageId,
      cosine,
    });
    return;
  }

  // HIT
  const page = loadPage(p.pageId);
  if (!page) return;
  const fm = { ...page.frontmatter };
  fm.hits = (fm.hits ?? 0) + 1;
  fm.weight = Math.min(1, fm.weight + (1 - fm.weight) * HIT_WEIGHT_GAIN);
  const wasPending = fm.status === 'pending';
  if (wasPending) {
    fm.status = 'canonical';
  }
  rewritePageFrontmatter(page, fm);
  if (wasPending) {
    const newPath = moveTo({ ...page, frontmatter: fm }, wikiPagesDir());
    log(`[reinforce] promoted ${p.pageId} to canonical (hit cosine ${cosine.toFixed(2)})`);
    appendReinforcementLog({
      kind: 'promote',
      session: sessionId,
      page: p.pageId,
      cosine,
    });
    appendLog(`reinforce: promoted ${p.pageId} to canonical (hit cosine ${cosine.toFixed(2)})`);
    void reindexPage(store, {
      ...page,
      filePath: newPath,
      frontmatter: fm,
    });
  } else {
    appendReinforcementLog({
      kind: 'hit',
      session: sessionId,
      page: p.pageId,
      cosine,
      weight: fm.weight,
    });
    void reindexPage(store, { ...page, frontmatter: fm });
  }
  commitWiki(`reinforce hit ${p.pageId}`);
}

export function evaluateCorrection(
  store: Store,
  sessionId: string,
  userText: string,
  log: (msg: string) => void = () => undefined,
): void {
  const p = getPending(sessionId);
  if (!p) return;
  const looksLikeCorrection = CORRECTION_PATTERNS.some((re) => re.test(userText));
  if (!looksLikeCorrection) return;

  const page = loadPage(p.pageId);
  if (!page) return;
  const fm = { ...page.frontmatter };
  fm.corrections = (fm.corrections ?? 0) + 1;
  fm.weight = Math.max(0, fm.weight - fm.weight * CORRECTION_WEIGHT_LOSS);
  rewritePageFrontmatter(page, fm);
  blacklistPageForSession(sessionId, p.pageId);
  pending.delete(sessionId);

  appendReinforcementLog({
    kind: 'correction',
    session: sessionId,
    page: p.pageId,
    weight: fm.weight,
  });
  log(`[reinforce] correction on ${p.pageId}: weight=${fm.weight.toFixed(2)}`);
  appendLog(`reinforce: correction on ${p.pageId} (weight ${fm.weight.toFixed(2)})`);

  if (fm.corrections >= 3 && fm.weight < ARCHIVE_FLOOR) {
    moveTo({ ...page, frontmatter: fm }, wikiArchiveDir());
    appendReinforcementLog({
      kind: 'archive',
      session: sessionId,
      page: p.pageId,
      reason: 'corrections>=3',
    });
    log(`[reinforce] archived ${p.pageId} after 3+ corrections`);
    appendLog(`reinforce: archived ${p.pageId} after corrections=3`);
  }
  void reindexPage(store, { ...page, frontmatter: fm });
  commitWiki(`reinforce correction ${p.pageId}`);
}

export async function decayInactivePages(
  store: Store,
  log: (msg: string) => void = () => undefined,
): Promise<{ decayed: number; archived: number }> {
  let decayed = 0;
  let archived = 0;
  const dirs = [wikiPagesDir(), wikiPendingDir()];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const filePath = path.posix.join(dir, file);
      let parsed;
      try {
        parsed = parsePage(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        continue;
      }
      const fm = { ...parsed.frontmatter };
      const newWeight = fm.weight * DECAY_PER_SESSION;
      fm.weight = newWeight;
      writePage(dir, { frontmatter: fm, sections: parsed.sections });
      decayed++;

      if (newWeight < ARCHIVE_FLOOR && fm.status !== 'archived') {
        const fileName = path.basename(filePath);
        const target = path.posix.join(wikiArchiveDir(), fileName);
        ensureDir(wikiArchiveDir());
        fs.renameSync(filePath, target);
        fm.status = 'archived';
        const targetParsed = parsePage(fs.readFileSync(target, 'utf-8'));
        writePage(wikiArchiveDir(), {
          frontmatter: fm,
          sections: targetParsed.sections,
        });
        archived++;
        appendReinforcementLog({
          kind: 'decay-archive',
          page: fm.id,
          weight: fm.weight,
        });
      }
    }
  }
  if (decayed > 0) log(`[reinforce] decayed ${decayed} pages, archived ${archived}`);
  return { decayed, archived };
}

function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}
