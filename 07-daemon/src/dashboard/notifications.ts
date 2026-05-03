/**
 * Notifications: server-side persistence + WS broadcast hook.
 *
 * Web push delivery (VAPID + service worker) is a Phase 3.7 add-on.
 * This module handles the persistence and the in-process event bus
 * that the dashboard subscribes to.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { DATA_ROOT, ensureDir } from '../paths.js';

const DASHBOARD_DIR = path.posix.join(DATA_ROOT, 'dashboard');
const FILE = path.posix.join(DASHBOARD_DIR, 'notifications.jsonl');
const RETENTION_DAYS = 30;

export type Severity = 'info' | 'warn' | 'alert';

export interface Notification {
  id: string;
  ts: string;
  severity: Severity;
  source: string; // e.g. "ingest", "lint", "ollama", "system"
  title: string;
  body?: string;
  link?: string;
  dismissed: boolean;
}

export const events = new EventEmitter();

function append(n: Notification): void {
  ensureDir(DASHBOARD_DIR);
  fs.appendFileSync(FILE, JSON.stringify(n) + '\n', 'utf-8');
}

export function emitNotification(input: {
  severity: Severity;
  source: string;
  title: string;
  body?: string;
  link?: string;
}): Notification {
  const n: Notification = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    severity: input.severity,
    source: input.source,
    title: input.title,
    ...(input.body ? { body: input.body } : {}),
    ...(input.link ? { link: input.link } : {}),
    dismissed: false,
  };
  append(n);
  events.emit('notification', n);
  return n;
}

interface NotificationOp {
  op: 'dismiss';
  id: string;
  ts: string;
}

function isOp(value: unknown): value is NotificationOp {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { op?: string }).op === 'dismiss',
  );
}

export function listNotifications(options: { limit?: number } = {}): Notification[] {
  const limit = options.limit ?? 200;
  if (!fs.existsSync(FILE)) return [];
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const map = new Map<string, Notification>();
  try {
    const lines = fs.readFileSync(FILE, 'utf-8').split('\n').filter((l) => l.trim());
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Notification | NotificationOp;
        if (isOp(parsed)) {
          const existing = map.get(parsed.id);
          if (existing) existing.dismissed = true;
        } else {
          if (Date.parse(parsed.ts) < cutoff) continue;
          map.set(parsed.id, parsed);
        }
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }
  return Array.from(map.values())
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    .slice(0, limit);
}

export function dismissNotification(id: string): void {
  ensureDir(DASHBOARD_DIR);
  fs.appendFileSync(
    FILE,
    JSON.stringify({ op: 'dismiss', id, ts: new Date().toISOString() }) + '\n',
    'utf-8',
  );
}

export function unreadCount(): number {
  return listNotifications().filter((n) => !n.dismissed).length;
}
