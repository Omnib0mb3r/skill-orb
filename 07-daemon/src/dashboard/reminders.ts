/**
 * Reminders.
 *
 * Append-only jsonl with full history. Read aggregates the current
 * state by replaying ops. Simple, robust, easy to back up.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_ROOT, ensureDir } from '../paths.js';

const DASHBOARD_DIR = path.posix.join(DATA_ROOT, 'dashboard');
const FILE = path.posix.join(DASHBOARD_DIR, 'reminders.jsonl');

export interface Reminder {
  id: string;
  title: string;
  due_at?: string;
  project_id?: string;
  tags: string[];
  created_at: string;
  completed_at?: string;
  archived: boolean;
}

interface Op {
  ts: string;
  op: 'create' | 'update' | 'complete' | 'uncomplete' | 'archive' | 'delete';
  id: string;
  patch?: Partial<Reminder>;
}

function append(op: Op): void {
  ensureDir(DASHBOARD_DIR);
  fs.appendFileSync(FILE, JSON.stringify(op) + '\n', 'utf-8');
}

function readOps(): Op[] {
  if (!fs.existsSync(FILE)) return [];
  try {
    return fs
      .readFileSync(FILE, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Op);
  } catch {
    return [];
  }
}

export function listReminders(): Reminder[] {
  const ops = readOps();
  const map = new Map<string, Reminder>();
  for (const op of ops) {
    if (op.op === 'create' && op.patch) {
      map.set(op.id, {
        id: op.id,
        title: op.patch.title ?? '',
        due_at: op.patch.due_at,
        project_id: op.patch.project_id,
        tags: op.patch.tags ?? [],
        created_at: op.ts,
        archived: false,
      });
    }
    const existing = map.get(op.id);
    if (!existing) continue;
    if (op.op === 'update' && op.patch) {
      Object.assign(existing, op.patch);
    }
    if (op.op === 'complete') existing.completed_at = op.ts;
    if (op.op === 'uncomplete') existing.completed_at = undefined;
    if (op.op === 'archive') existing.archived = true;
    if (op.op === 'delete') map.delete(op.id);
  }
  // Default sort: open first by due, completed/archived at the bottom
  const sorted = Array.from(map.values()).sort((a, b) => {
    const aOpen = a.completed_at ? 1 : 0;
    const bOpen = b.completed_at ? 1 : 0;
    if (aOpen !== bOpen) return aOpen - bOpen;
    const aDue = a.due_at ? Date.parse(a.due_at) : Infinity;
    const bDue = b.due_at ? Date.parse(b.due_at) : Infinity;
    return aDue - bDue;
  });
  return sorted.filter((r) => !r.archived);
}

export function createReminder(input: {
  title: string;
  due_at?: string;
  project_id?: string;
  tags?: string[];
}): Reminder {
  const id = randomUUID();
  append({
    ts: new Date().toISOString(),
    op: 'create',
    id,
    patch: {
      title: input.title,
      ...(input.due_at ? { due_at: input.due_at } : {}),
      ...(input.project_id ? { project_id: input.project_id } : {}),
      tags: input.tags ?? [],
    },
  });
  return (
    listReminders().find((r) => r.id === id) ?? {
      id,
      title: input.title,
      tags: input.tags ?? [],
      created_at: new Date().toISOString(),
      archived: false,
    }
  );
}

export function updateReminder(
  id: string,
  patch: Partial<Pick<Reminder, 'title' | 'due_at' | 'project_id' | 'tags'>>,
): boolean {
  const r = listReminders().find((x) => x.id === id);
  if (!r) return false;
  append({
    ts: new Date().toISOString(),
    op: 'update',
    id,
    patch,
  });
  return true;
}

export function completeReminder(id: string): boolean {
  const r = listReminders().find((x) => x.id === id);
  if (!r) return false;
  append({ ts: new Date().toISOString(), op: 'complete', id });
  return true;
}

export function uncompleteReminder(id: string): boolean {
  append({ ts: new Date().toISOString(), op: 'uncomplete', id });
  return true;
}

export function archiveReminder(id: string): boolean {
  append({ ts: new Date().toISOString(), op: 'archive', id });
  return true;
}

export function deleteReminder(id: string): boolean {
  append({ ts: new Date().toISOString(), op: 'delete', id });
  return true;
}
