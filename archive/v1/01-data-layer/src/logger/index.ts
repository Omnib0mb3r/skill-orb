import * as path from 'path';
import * as fs from 'fs';

import type { LogEntry, HookPayload, ProjectIdentity, ConnectionType } from '../types';

/** Returns the path to the daily JSONL log file for `dataRoot` and `date`.
 *  Uses UTC date components to avoid timezone-dependent filenames. */
export function getLogFilePath(dataRoot: string, date?: Date): string {
  const d = date ?? new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return path.join(dataRoot, 'logs', `${year}-${month}-${day}.jsonl`);
}

/** Constructs a LogEntry from a hook payload, resolved project identity, and connection metadata.
 *  Pure function — no I/O, no side effects. */
export function buildLogEntry(
  payload: HookPayload,
  identity: ProjectIdentity,
  connectionType: ConnectionType,
  sourceNode: string,
  targetNode: string,
  stage?: string,
  tags?: string[],
): LogEntry {
  return {
    schema_version: 1,
    timestamp: new Date().toISOString(),
    session_id: payload.session_id,
    tool_use_id: payload.tool_use_id,
    project: identity.id,
    project_source: identity.source,
    tool_name: payload.tool_name,
    tool_input: payload.tool_input,
    connection_type: connectionType,
    source_node: sourceNode,
    target_node: targetNode,
    ...(stage !== undefined ? { stage } : {}),
    ...(tags !== undefined ? { tags } : {}),
  };
}

/** Appends a log entry as a JSON line to the daily log file.
 *  Creates the logs/ directory if it doesn't exist. Never throws. */
export async function appendLogEntry(entry: LogEntry, dataRoot: string): Promise<void> {
  try {
    const filePath = getLogFilePath(dataRoot);
    const logsDir = path.dirname(filePath);
    await fs.promises.mkdir(logsDir, { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    await fs.promises.appendFile(filePath, line, 'utf8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[DevNeural] logger error:', message);
  }
}
