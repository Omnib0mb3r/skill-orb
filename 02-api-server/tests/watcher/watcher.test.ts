import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, appendFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { startWatchers, stopWatchers, getEventBuffer } from '../../src/watcher/index.js';
import type { InMemoryGraph } from '../../src/graph/types.js';
import type { WeightsFile } from '../../src/graph/types.js';
import { createTempDir, removeTempDir } from '../helpers/tempDir.js';

async function pollUntil(
  fn: () => boolean,
  intervalMs = 100,
  timeoutMs = 5000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
}

const fixtureWeights: WeightsFile = {
  connections: {
    'project:github.com/user/repo||tool:Read': {
      source_node: 'project:github.com/user/repo',
      target_node: 'tool:Read',
      connection_type: 'project->tool',
      raw_count: 5,
      weight: 0.8,
      first_seen: '2024-01-01T00:00:00.000Z',
      last_seen: '2024-01-02T00:00:00.000Z',
    },
    'project:github.com/user/repo||tool:Write': {
      source_node: 'project:github.com/user/repo',
      target_node: 'tool:Write',
      connection_type: 'project->tool',
      raw_count: 3,
      weight: 0.5,
      first_seen: '2024-01-01T00:00:00.000Z',
      last_seen: '2024-01-02T00:00:00.000Z',
    },
  },
  last_updated: '2024-01-02T00:00:00.000Z',
  version: '1.0',
};

const fixtureJsonlLines = [
  '{"tool_use_id":"abc1","timestamp":"2024-01-01T00:00:00.000Z","connection_type":"project->tool","source_node":"project:github.com/user/repo","target_node":"tool:Read"}',
  '{"tool_use_id":"abc2","timestamp":"2024-01-01T00:01:00.000Z","connection_type":"project->tool","source_node":"project:github.com/user/repo","target_node":"tool:Write"}',
  '{"tool_use_id":"abc3","timestamp":"2024-01-01T00:02:00.000Z","connection_type":"project->tool","source_node":"project:github.com/user/repo","target_node":"tool:Edit"}',
];

describe('watcher', () => {
  let tempDir: string;
  let weightsPath: string;
  let logsDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    weightsPath = join(tempDir, 'weights.json');
    logsDir = join(tempDir, 'logs');
    mkdirSync(logsDir);
  });

  afterEach(async () => {
    await stopWatchers();
    removeTempDir(tempDir);
  });

  // --- weights.json watcher tests ---

  it('calls onGraphChange when weights.json is written', async () => {
    let callCount = 0;
    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
    startWatchers(weightsPath, logsDir, () => { callCount++; }, () => {}, { stabilityThreshold: 50 });
    await new Promise(resolve => setTimeout(resolve, 150));
    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
    await pollUntil(() => callCount >= 1);
    expect(callCount).toBeGreaterThanOrEqual(1);
  }, 15000);

  it('onGraphChange receives correctly-parsed InMemoryGraph on change', async () => {
    let receivedGraph: InMemoryGraph | null = null;
    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
    startWatchers(weightsPath, logsDir, (g) => { receivedGraph = g; }, () => {}, { stabilityThreshold: 50 });
    await new Promise(resolve => setTimeout(resolve, 150));
    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
    await pollUntil(() => receivedGraph !== null);
    // fixture has 2 connections sharing one source node → 3 unique nodes (not 4)
    expect(receivedGraph!.nodeIndex.size).toBe(3);
    expect(receivedGraph!.edgeList.length).toBe(2);
  }, 15000);

  it('onGraphChange called with empty InMemoryGraph when weights.json is deleted', async () => {
    const graphs: InMemoryGraph[] = [];
    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
    startWatchers(weightsPath, logsDir, (g) => { graphs.push(g); }, () => {}, { stabilityThreshold: 50 });
    await new Promise(resolve => setTimeout(resolve, 150));
    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
    await pollUntil(() => graphs.length >= 1);
    unlinkSync(weightsPath);
    await pollUntil(() => graphs.length >= 2);
    const emptyGraph = graphs[graphs.length - 1];
    expect(emptyGraph.nodeIndex.size).toBe(0);
    expect(emptyGraph.edgeList.length).toBe(0);
  }, 15000);

  it('watcher handles weights.json not existing at startup', async () => {
    let receivedGraph: InMemoryGraph | null = null;
    startWatchers(weightsPath, logsDir, (g) => { receivedGraph = g; }, () => {}, { stabilityThreshold: 50 });
    await new Promise(resolve => setTimeout(resolve, 150));
    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
    await pollUntil(() => receivedGraph !== null);
    expect(receivedGraph!.nodeIndex.size).toBe(3);
    expect(receivedGraph!.edgeList.length).toBe(2);
  }, 15000);

  it('retains last valid graph when weights.json is overwritten with invalid JSON', async () => {
    let callCount = 0;
    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
    startWatchers(weightsPath, logsDir, () => { callCount++; }, () => {}, { stabilityThreshold: 50 });
    await new Promise(resolve => setTimeout(resolve, 150));
    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
    await pollUntil(() => callCount >= 1);
    const countAfterValid = callCount;
    writeFileSync(weightsPath, 'invalid json{{{', 'utf-8');
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(callCount).toBe(countAfterValid);
  }, 15000);

  // --- logs/ directory watcher tests ---

  it('startup scan calls onNewLogEntry for each line in existing JSONL file', async () => {
    let callCount = 0;
    const jsonlPath = join(logsDir, '2024-01-01.jsonl');
    writeFileSync(jsonlPath, fixtureJsonlLines.join('\n') + '\n', 'utf-8');
    startWatchers(weightsPath, logsDir, () => {}, () => { callCount++; }, { stabilityThreshold: 50 });
    await pollUntil(() => callCount >= 3);
    expect(callCount).toBe(3);
  }, 15000);

  it('offset tracking: appended lines only trigger additional callbacks', async () => {
    let callCount = 0;
    const jsonlPath = join(logsDir, '2024-01-01.jsonl');
    writeFileSync(jsonlPath, fixtureJsonlLines.join('\n') + '\n', 'utf-8');
    startWatchers(weightsPath, logsDir, () => {}, () => { callCount++; }, { stabilityThreshold: 50 });
    await pollUntil(() => callCount >= 3);
    appendFileSync(jsonlPath, fixtureJsonlLines[0] + '\n', 'utf-8');
    appendFileSync(jsonlPath, fixtureJsonlLines[1] + '\n', 'utf-8');
    await pollUntil(() => callCount >= 5);
    expect(callCount).toBe(5);
  }, 15000);

  it('new JSONL file added after startup triggers onNewLogEntry for each line', async () => {
    let callCount = 0;
    startWatchers(weightsPath, logsDir, () => {}, () => { callCount++; }, { stabilityThreshold: 50 });
    await new Promise(resolve => setTimeout(resolve, 150));
    const jsonlPath = join(logsDir, 'new.jsonl');
    writeFileSync(jsonlPath, fixtureJsonlLines.slice(0, 2).join('\n') + '\n', 'utf-8');
    await pollUntil(() => callCount >= 2);
    expect(callCount).toBe(2);
  }, 15000);

  it('invalid JSON lines are skipped without crashing', async () => {
    let callCount = 0;
    const jsonlPath = join(logsDir, 'mixed.jsonl');
    const content = [
      fixtureJsonlLines[0],
      'invalid-json-line',
      fixtureJsonlLines[1],
    ].join('\n') + '\n';
    writeFileSync(jsonlPath, content, 'utf-8');
    startWatchers(weightsPath, logsDir, () => {}, () => { callCount++; }, { stabilityThreshold: 50 });
    await pollUntil(() => callCount >= 2);
    expect(callCount).toBe(2);
  }, 15000);

  // --- Event buffer tests ---

  it('buffer cap: 1001 entries keeps only 1000, oldest dropped', async () => {
    const lines: string[] = [];
    for (let i = 1; i <= 1001; i++) {
      lines.push(JSON.stringify({
        tool_use_id: String(i),
        timestamp: '2024-01-01T00:00:00.000Z',
        connection_type: 'project->tool',
        source_node: 'project:a',
        target_node: 'tool:Read',
      }));
    }
    const jsonlPath = join(logsDir, 'big.jsonl');
    writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf-8');
    startWatchers(weightsPath, logsDir, () => {}, () => {}, { stabilityThreshold: 50 });
    await pollUntil(() => getEventBuffer().length === 1000, 100, 10000);
    const buf = getEventBuffer();
    expect(buf.length).toBe(1000);
    expect(buf.find(e => e.tool_use_id === '1')).toBeUndefined();
  }, 15000);

  it('entries stored newest-first', async () => {
    let callCount = 0;
    const lines = ['A', 'B', 'C'].map(id => JSON.stringify({
      tool_use_id: id,
      timestamp: '2024-01-01T00:00:00.000Z',
      connection_type: 'project->tool',
      source_node: 'project:a',
      target_node: 'tool:Read',
    }));
    const jsonlPath = join(logsDir, 'ordered.jsonl');
    writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf-8');
    startWatchers(weightsPath, logsDir, () => {}, () => { callCount++; }, { stabilityThreshold: 50 });
    await pollUntil(() => callCount >= 3);
    const buf = getEventBuffer();
    expect(buf[0].tool_use_id).toBe('C');
    expect(buf[1].tool_use_id).toBe('B');
    expect(buf[2].tool_use_id).toBe('A');
  }, 15000);

  it('startup scan populates buffer without broadcasting', async () => {
    let broadcastCallCount = 0;
    let callCount = 0;
    const jsonlPath = join(logsDir, '2024-01-01.jsonl');
    writeFileSync(jsonlPath, fixtureJsonlLines.join('\n') + '\n', 'utf-8');
    const broadcastSpy = () => { broadcastCallCount++; };
    startWatchers(
      weightsPath,
      logsDir,
      () => {},
      (_, isStartup) => {
        callCount++;
        if (!isStartup) broadcastSpy();
      },
      { stabilityThreshold: 50 }
    );
    await pollUntil(() => callCount >= 3);
    expect(broadcastCallCount).toBe(0);
    expect(getEventBuffer().length).toBe(3);
  }, 15000);

  // --- stopWatchers test ---

  it('stopWatchers prevents further callbacks after being called', async () => {
    let callCount = 0;
    startWatchers(weightsPath, logsDir, () => { callCount++; }, () => {}, { stabilityThreshold: 50 });
    await stopWatchers();
    writeFileSync(weightsPath, JSON.stringify(fixtureWeights), 'utf-8');
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(callCount).toBe(0);
  }, 15000);
});
