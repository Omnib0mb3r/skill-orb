/**
 * Notifications: server-side persistence + WS broadcast hook.
 *
 * Web push delivery (VAPID + service worker) is a Phase 3.7 add-on.
 * This module handles the persistence and the in-process event bus
 * that the dashboard subscribes to.
 *
 * Dismiss has per-scope semantics so the top-bar bell and the right-rail
 * live activity can be acknowledged independently. Bell catches every
 * notification (system + activity); activity rail filters to the brain
 * stream. Dismissing in one surface does not affect the other.
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
export type NotificationScope = 'bell' | 'activity';
export const ALL_SCOPES: NotificationScope[] = ['bell', 'activity'];

export interface Notification {
  id: string;
  ts: string;
  severity: Severity;
  source: string; // e.g. "ingest", "lint", "ollama", "system", "curator", "reinforcement"
  title: string;
  body?: string;
  link?: string;
  /** Legacy flag: true once dismissed in BOTH scopes. Kept so existing
   * callers / dashboards still see "all-dismissed" semantics. */
  dismissed: boolean;
  /** Per-surface dismiss tracking. Empty = visible everywhere. */
  dismissed_scopes: NotificationScope[];
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
    dismissed_scopes: [],
  };
  append(n);
  events.emit('notification', n);
  // Web push delivery (warn + alert only). Imported lazily to avoid a circular
  // load and to keep the persistence layer functional even if push setup fails.
  void (async () => {
    try {
      const { maybePushNotification } = await import('./push.js');
      await maybePushNotification(n);
    } catch {
      /* push delivery is best-effort */
    }
  })();
  return n;
}

interface NotificationOp {
  op: 'dismiss';
  id: string;
  ts: string;
  /** Omitted = legacy "dismiss everywhere"; one scope = surface-local. */
  scope?: NotificationScope | 'all';
}

function isOp(value: unknown): value is NotificationOp {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { op?: string }).op === 'dismiss',
  );
}

function applyDismiss(
  n: Notification,
  scope: NotificationScope | 'all' | undefined,
): void {
  const scopes = new Set<NotificationScope>(n.dismissed_scopes ?? []);
  if (!scope || scope === 'all') {
    for (const s of ALL_SCOPES) scopes.add(s);
  } else {
    scopes.add(scope);
  }
  n.dismissed_scopes = Array.from(scopes);
  n.dismissed = ALL_SCOPES.every((s) => scopes.has(s));
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
          if (existing) applyDismiss(existing, parsed.scope);
        } else {
          if (Date.parse(parsed.ts) < cutoff) continue;
          // Backfill: older records persisted dismissed:true without
          // dismissed_scopes; treat as dismissed in every scope so old
          // dismisses keep working after the schema change.
          if (!Array.isArray(parsed.dismissed_scopes)) {
            parsed.dismissed_scopes = parsed.dismissed ? [...ALL_SCOPES] : [];
          }
          parsed.dismissed = ALL_SCOPES.every((s) =>
            parsed.dismissed_scopes!.includes(s),
          );
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

export function dismissNotification(
  id: string,
  scope?: NotificationScope | 'all',
): void {
  ensureDir(DASHBOARD_DIR);
  const op: NotificationOp = {
    op: 'dismiss',
    id,
    ts: new Date().toISOString(),
    ...(scope ? { scope } : {}),
  };
  fs.appendFileSync(FILE, JSON.stringify(op) + '\n', 'utf-8');
}

export function unreadCount(scope: NotificationScope = 'bell'): number {
  return listNotifications().filter(
    (n) => !(n.dismissed_scopes ?? []).includes(scope),
  ).length;
}
