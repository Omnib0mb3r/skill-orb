/**
 * Dashboard routes registration.
 *
 * One function that wires every Phase 3 endpoint onto the existing
 * Fastify instance owned by the daemon. Auth middleware applied to
 * every route except the small public set in auth.ts.
 */
import type { FastifyInstance } from 'fastify';
import type { Store } from '../store/index.js';
import { authMiddleware, registerAuthRoutes, isPinSet } from './auth.js';
import { getSystemMetrics } from './system-metrics.js';
import { checkAll, rollupStatus } from './services.js';
import {
  listSessions,
  getSessionDetail,
  queueSessionPrompt,
  queueSessionFocus,
} from './sessions.js';
import { getDailyBrief } from './daily-brief.js';
import { searchAll } from './search-all.js';
import {
  listReminders,
  createReminder,
  updateReminder,
  completeReminder,
  uncompleteReminder,
  archiveReminder,
  deleteReminder,
} from './reminders.js';
import {
  listNotifications,
  dismissNotification,
  emitNotification,
  unreadCount,
  events as notificationEvents,
} from './notifications.js';
import { createProject } from './projects-new.js';

export async function registerDashboardRoutes(
  app: FastifyInstance,
  store: Store,
  log: (msg: string) => void = () => undefined,
): Promise<void> {
  // Auth middleware on every request before route handlers
  app.addHook('preHandler', (req, reply, done) => {
    authMiddleware(req, reply, done);
  });

  registerAuthRoutes(app);

  // ── Dashboard surface ─────────────────────────────────────────────
  app.get('/dashboard/health', async () => {
    const metrics = await getSystemMetrics();
    const services = await checkAll();
    return {
      ok: true,
      pin_set: isPinSet(),
      rollup: rollupStatus(services),
      services_total: services.length,
      services_failing: services.filter((s) => s.status === 'fail').length,
      unread_notifications: unreadCount(),
      cpu_percent: metrics.cpu.usage_percent,
      memory_percent: metrics.memory.used_percent,
      generated_at: metrics.timestamp,
    };
  });

  app.get('/dashboard/daily-brief', async () => getDailyBrief());

  app.get('/dashboard/system-metrics', async () => {
    return getSystemMetrics();
  });

  // ── Services manifest ─────────────────────────────────────────────
  app.get('/services', async () => {
    const services = await checkAll();
    return { ok: true, services, rollup: rollupStatus(services) };
  });

  // ── Sessions ─────────────────────────────────────────────────────
  app.get('/sessions', async () => ({ ok: true, sessions: listSessions() }));

  app.get('/sessions/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const detail = getSessionDetail(id, { recentLimit: 30 });
    if (!detail) {
      reply.code(404);
      return { ok: false, error: 'session not found' };
    }
    return { ok: true, session: detail };
  });

  app.get('/sessions/:id/transcript', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const limit = Number(
      (req.query as { limit?: string }).limit ?? '60',
    );
    const detail = getSessionDetail(id, { recentLimit: limit });
    if (!detail) {
      reply.code(404);
      return { ok: false, error: 'session not found' };
    }
    return { ok: true, chunks: detail.recent_chunks };
  });

  app.post('/sessions/:id/prompt', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = req.body as { text?: string };
    if (!body.text || typeof body.text !== 'string') {
      reply.code(400);
      return { ok: false, error: 'text required' };
    }
    const r = queueSessionPrompt(id, body.text);
    log(`[dashboard] prompt queued for session ${id}`);
    return r;
  });

  app.post('/sessions/:id/focus', async (req) => {
    const id = (req.params as { id: string }).id;
    return queueSessionFocus(id);
  });

  // ── Search across all collections ────────────────────────────────
  app.post('/search/all', async (req) => {
    const body = (req.body ?? {}) as {
      q?: string;
      project_id?: string;
      collections?: Array<'wiki_page' | 'raw_chunk' | 'reference_chunk'>;
      top_k?: number;
    };
    if (!body.q) return { ok: false, error: 'q required' };
    const results = await searchAll(store, {
      query: body.q,
      ...(body.project_id ? { project_id: body.project_id } : {}),
      ...(body.collections ? { collections: body.collections } : {}),
      ...(body.top_k ? { top_k: body.top_k } : {}),
    });
    return { ok: true, results };
  });

  // ── Reminders ─────────────────────────────────────────────────────
  app.get('/reminders', async () => ({ ok: true, reminders: listReminders() }));

  app.post('/reminders', async (req, reply) => {
    const body = req.body as {
      title?: string;
      due_at?: string;
      project_id?: string;
      tags?: string[];
    };
    if (!body.title) {
      reply.code(400);
      return { ok: false, error: 'title required' };
    }
    return {
      ok: true,
      reminder: createReminder({
        title: body.title,
        ...(body.due_at ? { due_at: body.due_at } : {}),
        ...(body.project_id ? { project_id: body.project_id } : {}),
        ...(body.tags ? { tags: body.tags } : {}),
      }),
    };
  });

  app.patch('/reminders/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = req.body as {
      title?: string;
      due_at?: string;
      project_id?: string;
      tags?: string[];
      complete?: boolean;
    };
    if (body.complete === true) completeReminder(id);
    else if (body.complete === false) uncompleteReminder(id);
    if (Object.keys(body).some((k) => k !== 'complete')) {
      const patch: Record<string, unknown> = {};
      if (body.title) patch.title = body.title;
      if (body.due_at) patch.due_at = body.due_at;
      if (body.project_id) patch.project_id = body.project_id;
      if (body.tags) patch.tags = body.tags;
      if (Object.keys(patch).length > 0) {
        const ok = updateReminder(id, patch as Partial<{ title: string; due_at: string; project_id: string; tags: string[] }>);
        if (!ok) {
          reply.code(404);
          return { ok: false, error: 'not found' };
        }
      }
    }
    return { ok: true };
  });

  app.delete('/reminders/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    deleteReminder(id);
    return { ok: true };
  });

  app.post('/reminders/:id/archive', async (req) => {
    const id = (req.params as { id: string }).id;
    archiveReminder(id);
    return { ok: true };
  });

  // ── Notifications ────────────────────────────────────────────────
  app.get('/notifications', async (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? '50');
    return { ok: true, notifications: listNotifications({ limit }) };
  });

  app.post('/notifications', async (req, reply) => {
    const body = req.body as {
      severity?: 'info' | 'warn' | 'alert';
      source?: string;
      title?: string;
      body?: string;
      link?: string;
    };
    if (!body.title || !body.severity || !body.source) {
      reply.code(400);
      return { ok: false, error: 'severity, source, title required' };
    }
    return {
      ok: true,
      notification: emitNotification({
        severity: body.severity,
        source: body.source,
        title: body.title,
        ...(body.body ? { body: body.body } : {}),
        ...(body.link ? { link: body.link } : {}),
      }),
    };
  });

  app.post('/notifications/:id/dismiss', async (req) => {
    const id = (req.params as { id: string }).id;
    dismissNotification(id);
    return { ok: true };
  });

  // ── Projects (new) ────────────────────────────────────────────────
  app.post('/projects/new', async (req, reply) => {
    const body = req.body as {
      name?: string;
      stage?: 'alpha' | 'beta' | 'deployed' | 'archived';
      tags?: string[];
      description?: string;
      open_vscode?: boolean;
    };
    if (!body.name) {
      reply.code(400);
      return { ok: false, error: 'name required' };
    }
    const r = await createProject(body as Parameters<typeof createProject>[0]);
    if (!r.ok) {
      reply.code(400);
      return r;
    }
    return r;
  });

  // ── Reference upload (Phase 3.2 stub) ────────────────────────────
  app.post('/upload', async (_req, reply) => {
    reply.code(501);
    return {
      ok: false,
      error:
        'reference corpus pipeline ships in Phase 3.2. Endpoint is reserved.',
    };
  });

  // Use the notification event bus to suppress unused-import lint
  void notificationEvents;
}
