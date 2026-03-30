import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionData, LogEntry, ConnectionEvent } from '../types.js';

export async function readSessionLog(
  date: string,
  dataRoot: string,
): Promise<SessionData | null> {
  const logPath = join(dataRoot, 'logs', `${date}.jsonl`);

  try {
    await access(logPath);
  } catch {
    console.warn(`[log-reader] No log file found for ${date}: ${logPath}`);
    return null;
  }

  const raw = await readFile(logPath, { encoding: 'utf-8' });
  const lines = raw.split('\n').filter(l => l.trim().length > 0);

  const entries: LogEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      entries.push(JSON.parse(lines[i]) as LogEntry);
    } catch {
      console.warn(`[log-reader] Failed to parse line ${i + 1}, skipping`);
    }
  }

  if (entries.length === 0) {
    return {
      date,
      primary_project: '', // sentinel for empty log
      all_projects: [],
      entries: [],
      session_start: '',
      session_end: '',
      connection_events: [],
    };
  }

  // Derive primary_project by frequency count (ties: first encountered wins)
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.project, (counts.get(entry.project) ?? 0) + 1);
  }
  let primary_project = '';
  let maxCount = 0;
  for (const [project, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      primary_project = project;
    }
  }

  const all_projects = [...new Set(entries.map(e => e.project))];

  // Sort by Date value to handle timezone offsets and non-UTC strings safely
  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const session_start = sorted[0].timestamp;
  const session_end = sorted[sorted.length - 1].timestamp;

  // Include ALL entries as connection events (forward-compat: don't filter by type)
  const connection_events: ConnectionEvent[] = entries.map(e => ({
    source_node: e.source_node,
    target_node: e.target_node,
    connection_type: e.connection_type,
    timestamp: e.timestamp,
  }));

  return {
    date,
    primary_project,
    all_projects,
    entries,
    session_start,
    session_end,
    connection_events,
  };
}
