import * as path from 'node:path';
import * as fs from 'node:fs';

export const DATA_ROOT =
  process.env.DEVNEURAL_DATA_ROOT?.replace(/\\/g, '/') ??
  'C:/dev/data/skill-connections';

export const projectsRoot = (): string => path.posix.join(DATA_ROOT, 'projects');
export const globalDir = (): string => path.posix.join(DATA_ROOT, 'global');
export const projectDir = (projectId: string): string =>
  path.posix.join(projectsRoot(), projectId);
export const observationsFile = (projectId: string): string =>
  path.posix.join(projectDir(projectId), 'observations.jsonl');
export const observationsArchive = (projectId: string): string =>
  path.posix.join(projectDir(projectId), 'observations.archive');
export const projectMetaFile = (projectId: string): string =>
  path.posix.join(projectDir(projectId), 'project.json');
export const transcriptsFile = (projectId: string): string =>
  path.posix.join(projectDir(projectId), 'transcripts.jsonl');
export const signalCounterFile = (projectId: string): string =>
  path.posix.join(projectDir(projectId), '.observer-signal-counter');
export const lastPurgeFile = (projectId: string): string =>
  path.posix.join(projectDir(projectId), '.last-purge');
export const projectsRegistry = (): string =>
  path.posix.join(DATA_ROOT, 'projects.json');
export const daemonPidFile = (): string =>
  path.posix.join(DATA_ROOT, 'daemon.pid');
export const daemonLockDir = (): string =>
  path.posix.join(DATA_ROOT, 'daemon.lock');
export const daemonLogFile = (): string =>
  path.posix.join(DATA_ROOT, 'daemon.log');
export const daemonSocketFile = (): string =>
  path.posix.join(DATA_ROOT, 'daemon.sock');

export const wikiRoot = (): string => path.posix.join(DATA_ROOT, 'wiki');
export const wikiPagesDir = (): string => path.posix.join(wikiRoot(), 'pages');
export const wikiPendingDir = (): string =>
  path.posix.join(wikiRoot(), 'pending');
export const wikiArchiveDir = (): string =>
  path.posix.join(wikiRoot(), 'archive');
export const wikiSchemaFile = (): string =>
  path.posix.join(wikiRoot(), 'DEVNEURAL.md');
export const wikiIndexFile = (): string =>
  path.posix.join(wikiRoot(), 'index.md');
export const wikiLogFile = (): string => path.posix.join(wikiRoot(), 'log.md');
export const wikiWhatsNewFile = (): string =>
  path.posix.join(wikiRoot(), 'whats-new.md');

export const wikiGlossaryDir = (): string =>
  path.posix.join(wikiRoot(), 'glossary');
export const wikiGlossaryFile = (projectId: string): string =>
  path.posix.join(wikiGlossaryDir(), `${projectId}.md`);

export const sessionStateDir = (): string =>
  path.posix.join(DATA_ROOT, 'session-state');
export const sessionSummaryFile = (sessionId: string): string =>
  path.posix.join(sessionStateDir(), `${sessionId}.summary.md`);
export const sessionTaskFile = (sessionId: string): string =>
  path.posix.join(sessionStateDir(), `${sessionId}.task.md`);
export const sessionMetaFile = (sessionId: string): string =>
  path.posix.join(sessionStateDir(), `${sessionId}.meta.json`);

export const referenceRoot = (): string =>
  path.posix.join(DATA_ROOT, 'reference');
export const referenceQueueDir = (): string =>
  path.posix.join(referenceRoot(), 'queue');
export const referenceDocsDir = (): string =>
  path.posix.join(referenceRoot(), 'docs');
export const referenceImagesDir = (): string =>
  path.posix.join(referenceRoot(), 'images');
export const referenceAudioDir = (): string =>
  path.posix.join(referenceRoot(), 'audio');
export const referenceVideoDir = (): string =>
  path.posix.join(referenceRoot(), 'video');

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function ensureProjectDir(projectId: string): string {
  const dir = projectDir(projectId);
  ensureDir(dir);
  return dir;
}

export function ensureDataRoot(): void {
  ensureDir(DATA_ROOT);
  ensureDir(projectsRoot());
  ensureDir(globalDir());
}
