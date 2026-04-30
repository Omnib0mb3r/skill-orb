import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  parsePage,
  renderPage,
  writePage,
  validatePage,
  type PageFrontmatter,
  type PageSections,
  PageValidationError,
} from '../src/wiki/schema.js';

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devneural-wiki-'));
});

function makePage(overrides: Partial<PageFrontmatter> = {}): {
  frontmatter: PageFrontmatter;
  sections: PageSections;
} {
  const fm: PageFrontmatter = {
    id: 'choosing-pathfinding-for-grid-routing',
    title: 'Choosing pathfinding for grid routing → A* over Dijkstra when admissible heuristic exists',
    trigger: 'working on grid-based routing or AMR pathfinding',
    insight: 'prefer A* over Dijkstra when an admissible heuristic is available',
    summary:
      'For uniform-cost grids with an obvious heuristic, A* converges 3-5x faster than Dijkstra. Use Dijkstra only when costs are non-uniform.',
    status: 'pending',
    weight: 0.3,
    hits: 0,
    corrections: 0,
    created: '2026-04-30',
    last_touched: '2026-04-30',
    projects: ['warehouse-sim'],
    human_edited: false,
    ...overrides,
  };
  const sections: PageSections = {
    pattern:
      'A* uses an admissible heuristic to prune search space. For uniform-cost grids the heuristic is Manhattan or Euclidean distance.',
    crossRefs: ['amr-routing-pathfinding'],
    crossRefsRaw: [
      { label: 'AMR routing pathfinding', href: './amr-routing-pathfinding.md' },
    ],
    evidence: ['session abc123: applied to dock-door clustering'],
    openQuestions: ['Generalize to non-uniform bay sizes?'],
    log: ['2026-04-30 ingest: page created'],
  };
  return { frontmatter: fm, sections };
}

describe('wiki schema', () => {
  it('round-trips a valid page through render and parse', () => {
    const page = makePage();
    const rendered = renderPage(page);
    const parsed = parsePage(rendered);
    expect(parsed.frontmatter.id).toBe(page.frontmatter.id);
    expect(parsed.frontmatter.title).toBe(page.frontmatter.title);
    expect(parsed.frontmatter.summary.length).toBeGreaterThan(20);
    expect(parsed.sections.crossRefs).toContain('amr-routing-pathfinding');
    expect(parsed.sections.evidence).toHaveLength(1);
    expect(parsed.sections.log).toHaveLength(1);
  });

  it('writes to disk and reads back', () => {
    const page = makePage();
    const file = writePage(tmpDir, page);
    const back = parsePage(fs.readFileSync(file, 'utf-8'));
    expect(back.frontmatter.id).toBe(page.frontmatter.id);
  });

  it('rejects pages without a title separator', () => {
    const page = makePage({ title: 'No separator here' });
    const issues = validatePage(page);
    expect(issues.some((i) => i.includes('→'))).toBe(true);
  });

  it('rejects pages missing summary', () => {
    const page = makePage({ summary: '' });
    expect(() => writePage(tmpDir, page)).toThrow(PageValidationError);
  });

  it('rejects oversize summary', () => {
    const page = makePage({ summary: 'x'.repeat(700) });
    const issues = validatePage(page);
    expect(issues.some((i) => i.includes('summary too long'))).toBe(true);
  });

  it('rejects oversize body', () => {
    const page = makePage();
    page.sections.pattern = 'y'.repeat(7000);
    const issues = validatePage(page);
    expect(issues.some((i) => i.includes('pattern body too long'))).toBe(true);
  });

  it('rejects too many cross-refs', () => {
    const page = makePage();
    for (let i = 0; i < 9; i++) {
      page.sections.crossRefsRaw.push({
        label: `extra-${i}`,
        href: `./extra-${i}.md`,
      });
    }
    const issues = validatePage(page);
    expect(issues.some((i) => i.includes('too many cross_refs'))).toBe(true);
  });

  it('rejects too much evidence', () => {
    const page = makePage();
    for (let i = 0; i < 25; i++) page.sections.evidence.push(`extra ${i}`);
    const issues = validatePage(page);
    expect(issues.some((i) => i.includes('too many evidence'))).toBe(true);
  });

  it('preserves human_edited flag through round-trip', () => {
    const page = makePage({
      human_edited: true,
      human_edited_at: '2026-04-29T10:00:00Z',
    });
    const rendered = renderPage(page);
    const parsed = parsePage(rendered);
    expect(parsed.frontmatter.human_edited).toBe(true);
    expect(parsed.frontmatter.human_edited_at).toBe('2026-04-29T10:00:00Z');
  });
});
