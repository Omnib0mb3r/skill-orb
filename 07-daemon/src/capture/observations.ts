import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  observationsFile,
  observationsArchive,
  ensureProjectDir,
  lastPurgeFile,
  signalCounterFile,
} from '../paths.js';
import type { Observation } from '../types.js';

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ARCHIVE_RETENTION_DAYS = 30;
const SIGNAL_EVERY_N = Number(process.env.DEVNEURAL_SIGNAL_EVERY_N ?? 20);

export function appendObservation(projectId: string, obs: Observation): void {
  ensureProjectDir(projectId);
  rotateIfLarge(projectId);
  fs.appendFileSync(observationsFile(projectId), JSON.stringify(obs) + '\n', 'utf-8');
}

function rotateIfLarge(projectId: string): void {
  const file = observationsFile(projectId);
  if (!fs.existsSync(file)) return;
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return;
  }
  if (size < MAX_FILE_SIZE_BYTES) return;

  const archiveDir = observationsArchive(projectId);
  fs.mkdirSync(archiveDir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[:T]/g, '-')
    .replace(/\..+$/, '');
  const target = path.posix.join(
    archiveDir,
    `observations-${stamp}-${process.pid}.jsonl`,
  );
  try {
    fs.renameSync(file, target);
  } catch {
    /* concurrent rotation; ignore */
  }
}

export function purgeOldArchivesOncePerDay(projectId: string): void {
  const marker = lastPurgeFile(projectId);
  const dayMs = 24 * 60 * 60 * 1000;
  try {
    if (fs.existsSync(marker)) {
      const age = Date.now() - fs.statSync(marker).mtimeMs;
      if (age < dayMs) return;
    }
  } catch {
    /* fall through and try purge */
  }

  const archiveDir = observationsArchive(projectId);
  if (fs.existsSync(archiveDir)) {
    const cutoff = Date.now() - ARCHIVE_RETENTION_DAYS * dayMs;
    for (const name of fs.readdirSync(archiveDir)) {
      if (!name.startsWith('observations-') || !name.endsWith('.jsonl')) continue;
      const full = path.posix.join(archiveDir, name);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
      } catch {
        /* ignore */
      }
    }
  }

  try {
    fs.writeFileSync(marker, '', 'utf-8');
  } catch {
    /* ignore */
  }
}

export interface SignalDecision {
  shouldSignal: boolean;
  count: number;
}

export function bumpSignalCounter(projectId: string): SignalDecision {
  const file = signalCounterFile(projectId);
  let current = 0;
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8').trim();
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= 0) current = parsed;
    }
  } catch {
    /* ignore */
  }

  const next = current + 1;
  const shouldSignal = next >= SIGNAL_EVERY_N;
  const writeValue = shouldSignal ? 0 : next;

  try {
    fs.writeFileSync(file, String(writeValue), 'utf-8');
  } catch {
    /* ignore */
  }

  return { shouldSignal, count: next };
}
