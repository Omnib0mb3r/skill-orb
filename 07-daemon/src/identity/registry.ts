import * as fs from 'node:fs';
import { ensureDataRoot, projectsRegistry, projectMetaFile, ensureProjectDir } from '../paths.js';
import type { ProjectIdentity, ProjectRegistryEntry } from '../types.js';

interface RegistryFile {
  version: 1;
  projects: Record<string, ProjectRegistryEntry>;
}

function loadRegistry(): RegistryFile {
  ensureDataRoot();
  const file = projectsRegistry();
  if (!fs.existsSync(file)) {
    return { version: 1, projects: {} };
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as RegistryFile;
    if (parsed.version !== 1 || typeof parsed.projects !== 'object') {
      return { version: 1, projects: {} };
    }
    return parsed;
  } catch {
    return { version: 1, projects: {} };
  }
}

function saveRegistry(reg: RegistryFile): void {
  fs.writeFileSync(projectsRegistry(), JSON.stringify(reg, null, 2), 'utf-8');
}

export function recordIdentity(identity: ProjectIdentity): void {
  if (identity.id === 'global') return;
  const now = new Date().toISOString();
  const reg = loadRegistry();
  const existing = reg.projects[identity.id];
  if (existing) {
    existing.last_seen = now;
    if (existing.name !== identity.name) existing.name = identity.name;
    if (existing.root !== identity.root) existing.root = identity.root;
    if (existing.remote !== identity.remote) existing.remote = identity.remote;
  } else {
    reg.projects[identity.id] = {
      id: identity.id,
      name: identity.name,
      root: identity.root,
      remote: identity.remote,
      first_seen: now,
      last_seen: now,
    };
  }
  saveRegistry(reg);

  ensureProjectDir(identity.id);
  fs.writeFileSync(
    projectMetaFile(identity.id),
    JSON.stringify(reg.projects[identity.id], null, 2),
    'utf-8',
  );
}

export function listProjects(): ProjectRegistryEntry[] {
  return Object.values(loadRegistry().projects);
}

export function getProject(id: string): ProjectRegistryEntry | undefined {
  return loadRegistry().projects[id];
}
