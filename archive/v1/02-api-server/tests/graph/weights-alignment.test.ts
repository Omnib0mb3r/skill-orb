/**
 * WeightsFile field-name alignment tests.
 *
 * Verifies that the api-server's WeightsFile type uses the same field names
 * that the data layer writes to disk (schema_version, updated_at).
 */
import { describe, it, expect } from 'vitest';
import { buildGraph } from '../../src/graph/builder.js';
import type { WeightsFile } from '../../src/graph/types.js';

describe('WeightsFile field-name alignment with data-layer', () => {
  it('accepts a weights.json using schema_version and updated_at (canonical data-layer format)', () => {
    const weights: WeightsFile = {
      schema_version: 1,
      updated_at: '2026-01-01T00:00:00.000Z',
      connections: {},
    };
    expect(() => buildGraph(weights)).not.toThrow();
    const graph = buildGraph(weights);
    expect(graph.nodeIndex.size).toBe(0);
  });

  it('builds a graph from a canonical weights.json with schema_version and updated_at', () => {
    const weights: WeightsFile = {
      schema_version: 1,
      updated_at: '2026-01-01T00:00:00.000Z',
      connections: {
        'project:github.com/user/repo||tool:Agent': {
          source_node: 'project:github.com/user/repo',
          target_node: 'tool:Agent',
          connection_type: 'project->tool',
          raw_count: 5,
          weight: 0.5,
          first_seen: '2026-01-01T00:00:00.000Z',
          last_seen: '2026-01-02T00:00:00.000Z',
        },
      },
    };
    const graph = buildGraph(weights);
    expect(graph.nodeIndex.size).toBe(2);
    expect(graph.edgeList.length).toBe(1);
  });

  it('a file with old divergent field names (version, last_updated) still yields a valid graph (connections-only parsing)', () => {
    // buildGraph only reads .connections — it never reads schema_version or updated_at.
    // A file written with the old field names (version, last_updated) produces a correct
    // graph because no wrong value is silently consumed. This is the recoverable behavior:
    // the metadata mismatch does not cause a crash or incorrect edge data.
    const legacyFormat = {
      version: '1.0',
      last_updated: '2024-01-01T00:00:00.000Z',
      connections: {
        'project:github.com/user/repo-a||tool:Agent': {
          source_node: 'project:github.com/user/repo-a',
          target_node: 'tool:Agent',
          connection_type: 'project->tool',
          raw_count: 3,
          weight: 0.3,
          first_seen: '2024-01-01T00:00:00.000Z',
          last_seen: '2024-01-02T00:00:00.000Z',
        },
      },
    };
    // Cast bypasses TS to simulate runtime reading of legacy file
    const graph = buildGraph(legacyFormat as unknown as WeightsFile);
    expect(graph.nodeIndex.size).toBe(2);
    expect(graph.edgeList.length).toBe(1);
  });
});
