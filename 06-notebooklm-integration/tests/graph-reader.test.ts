import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ObsidianSyncConfig } from '../src/types.js';
import { extractGraphInsights } from '../src/session/graph-reader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureWeightsPath = path.join(__dirname, 'fixtures', 'sample-weights.json');

// Set up a temp data_root with weights.json (the file the graph-reader expects)
const tempDataRoot = join(tmpdir(), `devneural-graph-test-${Date.now()}`);
beforeAll(() => {
  mkdirSync(tempDataRoot, { recursive: true });
  writeFileSync(join(tempDataRoot, 'weights.json'), readFileSync(fixtureWeightsPath, 'utf-8'), 'utf-8');
});

const mockConfig: ObsidianSyncConfig = {
  vault_path: '/vault',
  notes_subfolder: 'DevNeural/Projects',
  data_root: tempDataRoot,
  api_base_url: 'http://localhost:3747',
  prepend_sessions: true,
  claude_model: 'claude-haiku-4-5-20251001',
};

const PROJECT_ID = 'github.com/Omnib0mb3r/DevNeural';
const TEST_DATE = '2026-03-30';

// Build a mock API response from the fixture edges for the given project
function buildApiResponse() {
  const weights = JSON.parse(readFileSync(fixtureWeightsPath, 'utf-8')) as {
    connections: Record<string, { source_node: string; target_node: string; weight: number; raw_count: number; first_seen: string; last_seen: string }>;
  };
  const edges = Object.values(weights.connections).filter(
    e => e.source_node === `project:${PROJECT_ID}` || e.source_node === PROJECT_ID,
  );
  return { nodes: [], edges };
}

describe('extractGraphInsights', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls API endpoint with project ID and returns parsed insights', async () => {
    const apiResponse = buildApiResponse();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => apiResponse,
    } as Response);

    const insights = await extractGraphInsights(PROJECT_ID, TEST_DATE, mockConfig);
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.every(i => i.type && i.source_node && i.description)).toBe(true);
  });

  it('falls back to reading weights.json when API returns non-200 or fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const insights = await extractGraphInsights(PROJECT_ID, TEST_DATE, mockConfig);
    expect(insights.length).toBeGreaterThan(0);
  });

  it('matches project edges using both bare ID and project: prefixed ID from weights.json', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const insights = await extractGraphInsights(PROJECT_ID, TEST_DATE, mockConfig);
    // All source_nodes in results should reference our project
    const projectSources = insights.filter(
      i => i.source_node === PROJECT_ID || i.source_node === `project:${PROJECT_ID}`,
    );
    expect(projectSources.length).toBeGreaterThan(0);
  });

  it('identifies new_connection insights where first_seen date matches target date', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const insights = await extractGraphInsights(PROJECT_ID, TEST_DATE, mockConfig);
    const newConns = insights.filter(i => i.type === 'new_connection');
    // Fixture has 2 edges with first_seen starting 2026-03-30: tool:Read's first_seen is 2026-03-01, so only skill:deep-plan
    expect(newConns.length).toBeGreaterThanOrEqual(1);
    expect(newConns[0].description).toContain('New connection');
  });

  it('identifies high_weight insights for top 3 edges by weight', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const insights = await extractGraphInsights(PROJECT_ID, TEST_DATE, mockConfig);
    const highWeight = insights.filter(i => i.type === 'high_weight');
    expect(highWeight.length).toBeLessThanOrEqual(3);
    expect(highWeight.length).toBeGreaterThanOrEqual(1);
    // Sorted by weight descending
    for (let i = 1; i < highWeight.length; i++) {
      expect(highWeight[i - 1].weight).toBeGreaterThanOrEqual(highWeight[i].weight);
    }
  });

  it('identifies weight_milestone insights where last_seen = today AND raw_count in [10,25,50,100]', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const insights = await extractGraphInsights(PROJECT_ID, TEST_DATE, mockConfig);
    const milestones = insights.filter(i => i.type === 'weight_milestone');
    // Fixture: tool:Read has raw_count=50, last_seen=2026-03-30; tool:Bash has raw_count=25, last_seen=2026-03-30; skill:deep-plan has raw_count=10, last_seen=2026-03-30
    expect(milestones.length).toBeGreaterThanOrEqual(1);
    milestones.forEach(m => {
      expect([10, 25, 50, 100]).toContain(m.raw_count);
      expect(m.description).toContain('Milestone');
    });
  });

  it('returns empty array when both API and file read fail (no throw)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const badConfig: ObsidianSyncConfig = { ...mockConfig, data_root: '/nonexistent/path/99999' };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const insights = await extractGraphInsights(PROJECT_ID, TEST_DATE, badConfig);
    expect(insights).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('produces plain-English description strings for each insight type', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const insights = await extractGraphInsights(PROJECT_ID, TEST_DATE, mockConfig);
    for (const insight of insights) {
      expect(typeof insight.description).toBe('string');
      expect(insight.description.length).toBeGreaterThan(5);
    }
    const newConn = insights.find(i => i.type === 'new_connection');
    const highW = insights.find(i => i.type === 'high_weight');
    const milestone = insights.find(i => i.type === 'weight_milestone');
    if (newConn) expect(newConn.description).toMatch(/New connection/i);
    if (highW) expect(highW.description).toMatch(/Strong connection|weight/i);
    if (milestone) expect(milestone.description).toMatch(/Milestone/i);
  });
});
