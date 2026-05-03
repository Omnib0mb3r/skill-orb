import * as path from 'path';
import * as fs from 'fs';
import writeFileAtomic from 'write-file-atomic';
import type { ConnectionType } from '../types';
import type { WeightsFile, ConnectionRecord } from './types';

/** Returns the connection graph key for a directed edge. Format: "sourceNode||targetNode". */
export function connectionKey(sourceNode: string, targetNode: string): string {
  return `${sourceNode}||${targetNode}`;
}

/** Reads weights.json from dataRoot. Returns an empty graph if the file is absent. Never throws. */
export function loadWeights(dataRoot: string): WeightsFile {
  const filePath = path.join(dataRoot, 'weights.json');

  const empty = (): WeightsFile => ({
    schema_version: 1,
    updated_at: new Date().toISOString(),
    connections: {},
  });

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[DevNeural] weights read error:', message);
    }
    return empty();
  }

  try {
    return JSON.parse(content) as WeightsFile;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[DevNeural] weights parse error:', message);
    return empty();
  }
}

/** Increments the edge counter for (sourceNode → targetNode) in place. Returns the same weights reference. */
export function updateWeight(
  weights: WeightsFile,
  sourceNode: string,
  targetNode: string,
  connectionType: ConnectionType,
  now: Date,
): WeightsFile {
  const key = connectionKey(sourceNode, targetNode);

  if (!weights.connections[key]) {
    weights.connections[key] = {
      source_node: sourceNode,
      target_node: targetNode,
      connection_type: connectionType,
      raw_count: 0,
      weight: 0,
      first_seen: now.toISOString(),
      last_seen: now.toISOString(),
    };
  }

  const record = weights.connections[key];
  record.raw_count += 1;
  record.weight = Math.round(Math.min(record.raw_count, 100) / 100 * 10 * 10000) / 10000;
  record.last_seen = now.toISOString();

  return weights;
}

/** Atomically writes weights.json to dataRoot. Sets updated_at on the written file (non-mutating). Never throws. */
export async function saveWeights(weights: WeightsFile, dataRoot: string): Promise<void> {
  const toWrite = { ...weights, updated_at: new Date().toISOString() };
  const filePath = path.join(dataRoot, 'weights.json');

  try {
    await writeFileAtomic(filePath, JSON.stringify(toWrite, null, 2), { encoding: 'utf8' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[DevNeural] weights save error:', message);
  }
}
