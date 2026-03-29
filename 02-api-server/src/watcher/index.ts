import chokidar from 'chokidar';
import fs from 'node:fs';
import type { InMemoryGraph, LogEntry, WeightsFile } from '../graph/types.js';
import { buildGraph } from '../graph/builder.js';

export interface WatcherOptions {
  /** awaitWriteFinish stabilityThreshold in ms. Default: 300. Set to 50 in tests. */
  stabilityThreshold?: number;
}

// Module-level state
let weightsWatcher: ReturnType<typeof chokidar.watch> | null = null;
let logsWatcher: ReturnType<typeof chokidar.watch> | null = null;
const fileOffsets = new Map<string, number>();
let eventBuffer: LogEntry[] = [];

/**
 * Starts both file watchers.
 */
export function startWatchers(
  weightsPath: string,
  logsDir: string,
  onGraphChange: (graph: InMemoryGraph) => void,
  onNewLogEntry: (entry: LogEntry, isStartup: boolean) => void,
  opts?: WatcherOptions
): void {
  const stabilityThreshold = opts?.stabilityThreshold ?? 300;

  const handleWeightsRead = async () => {
    try {
      const content = await fs.promises.readFile(weightsPath, 'utf-8');
      const parsed = JSON.parse(content) as WeightsFile;
      onGraphChange(buildGraph(parsed));
    } catch (err) {
      console.error('Failed to read/parse weights.json:', err);
    }
  };

  weightsWatcher = chokidar.watch(weightsPath, {
    awaitWriteFinish: {
      stabilityThreshold,
      pollInterval: 50,
    },
    ignoreInitial: true,
  });

  weightsWatcher
    .on('add', handleWeightsRead)
    .on('change', handleWeightsRead)
    .on('unlink', () => {
      const emptyWeights: WeightsFile = { connections: {}, last_updated: '', version: '' };
      onGraphChange(buildGraph(emptyWeights));
    });

  let isStartupScan = true;

  logsWatcher = chokidar.watch(logsDir, {
    depth: 0,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold,
      pollInterval: 50,
    },
  });

  logsWatcher
    .on('add', (filePath: string) => {
      if (!filePath.endsWith('.jsonl')) return;
      readNewBytes(filePath, isStartupScan, onNewLogEntry);
    })
    .on('change', (filePath: string) => {
      if (!filePath.endsWith('.jsonl')) return;
      readNewBytes(filePath, false, onNewLogEntry);
    })
    .on('ready', () => {
      isStartupScan = false;
    });
}

async function readNewBytes(
  filePath: string,
  startup: boolean,
  onNewLogEntry: (entry: LogEntry, isStartup: boolean) => void
): Promise<void> {
  try {
    const lastOffset = fileOffsets.get(filePath) ?? 0;
    const stat = await fs.promises.stat(filePath);
    if (stat.size <= lastOffset) return;

    const length = stat.size - lastOffset;
    const buf = Buffer.alloc(length);
    const fh = await fs.promises.open(filePath, 'r');
    try {
      await fh.read(buf, 0, length, lastOffset);
    } finally {
      await fh.close();
    }
    fileOffsets.set(filePath, stat.size);

    const lines = buf.toString('utf-8').split('\n').filter(l => l.trim().length > 0);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as LogEntry;
        prependToBuffer(entry);
        onNewLogEntry(entry, startup);
      } catch (err) {
        console.error('Failed to parse log line:', err);
      }
    }
  } catch (err) {
    console.error('Failed to read log file:', err);
  }
}

function prependToBuffer(entry: LogEntry): void {
  eventBuffer.unshift(entry);
  if (eventBuffer.length > 1000) {
    eventBuffer.pop();
  }
}

/**
 * Closes both chokidar watchers and resets all module-level state.
 * Safe to call multiple times.
 */
export async function stopWatchers(): Promise<void> {
  await Promise.all([
    weightsWatcher?.close(),
    logsWatcher?.close(),
  ]);
  weightsWatcher = null;
  logsWatcher = null;
  fileOffsets.clear();
  eventBuffer = [];
}

/**
 * Returns a shallow copy of the current event buffer (newest-first).
 */
export function getEventBuffer(): LogEntry[] {
  return [...eventBuffer];
}
