import * as fs from 'node:fs';
import { daemonPidFile, daemonLockDir, ensureDataRoot } from '../paths.js';

export function readPid(): number | null {
  const file = daemonPidFile();
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf-8').trim();
    const pid = Number.parseInt(raw, 10);
    if (!Number.isFinite(pid) || pid <= 1) {
      removeStalePid();
      return null;
    }
    if (!isAlive(pid)) {
      removeStalePid();
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

export function writePid(pid: number): void {
  ensureDataRoot();
  fs.writeFileSync(daemonPidFile(), String(pid), 'utf-8');
}

export function removeStalePid(): void {
  try {
    fs.unlinkSync(daemonPidFile());
  } catch {
    /* ignore */
  }
}

export function isAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return true;
    return false;
  }
}

export interface LockHandle {
  release: () => void;
}

export function acquireSpawnLock(): LockHandle | null {
  ensureDataRoot();
  const lock = daemonLockDir();
  try {
    fs.mkdirSync(lock);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw err;
  }
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      try {
        fs.rmdirSync(lock);
      } catch {
        /* ignore */
      }
    },
  };
}
