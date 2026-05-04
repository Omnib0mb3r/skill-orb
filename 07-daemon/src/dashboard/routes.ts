/**
 * Dashboard routes registration.
 *
 * One function that wires every Phase 3 endpoint onto the existing
 * Fastify instance owned by the daemon. Auth middleware applied to
 * every route except the small public set in auth.ts.
 */
import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import type { Store } from '../store/index.js';
import { authMiddleware, registerAuthRoutes, isPinSet } from './auth.js';
import { ReferenceStore } from '../reference/store.js';
import { ingestUpload } from '../reference/process.js';
import { getSystemMetrics } from './system-metrics.js';
import { checkAll, rollupStatus } from './services.js';
import {
  listSessions,
  getSessionDetail,
  queueSessionPrompt,
  queueSessionFocus,
  queueSessionKey,
  isNavKey,
} from './sessions.js';
import { setPhase, type SessionPhase } from './session-phase.js';
import { lintQueueStatus } from '../wiki/lint-queue.js';
import { providerStatus } from '../llm/index.js';
import { embedderStats } from '../embedder/index.js';
import {
  runBackfillRaw,
  runBackfillWiki,
  getBackfillStatus,
  requestBackfillCancel,
  resetBackfill,
} from '../wiki/backfill.js';
import { repairWikiCrossRefs } from '../wiki/repair.js';
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
import { buildGraph } from './graph.js';
import {
  vapidPublicKey,
  saveSubscription,
  removeSubscription,
  listSubscriptions,
} from './push.js';

export async function registerDashboardRoutes(
  app: FastifyInstance,
  store: Store,
  log: (msg: string) => void = () => undefined,
): Promise<void> {
  const referenceStore = await ReferenceStore.open(log);
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

  /* Consolidated diagnostics: store sizes, lint queue, provider, embedder
   * stats, active session counts. Polled by the System tab (~8s) so we
   * surface the brain's actual state, not just host vitals. Cheap: every
   * field is in-memory or a single fs.statSync. */
  app.get('/dashboard/diagnostics', async () => {
    const sessions = listSessions();
    const active = sessions.filter((s) => s.active);
    const byPhase: Record<string, number> = {
      thinking: 0, tool: 0, permission: 0, idle: 0, unknown: 0,
    };
    for (const s of active) {
      byPhase[s.phase] = (byPhase[s.phase] ?? 0) + 1;
    }
    return {
      ok: true,
      store: {
        raw_chunks: store.rawChunks.stats(),
        wiki_pages: store.wikiPages.stats(),
        reference_chunks: referenceStore.chunks.stats(),
      },
      lint_queue: lintQueueStatus(),
      llm: providerStatus(),
      embedder: embedderStats(),
      sessions: {
        total: sessions.length,
        active: active.length,
        by_phase: byPhase,
      },
      generated_at: new Date().toISOString(),
    };
  });

  /* Daemon log tail. Reads the last ~64KB of daemon.log and returns the
   * last N lines, newest last. 64KB cap keeps it cheap; the daemon log
   * grows but log lines are short so 64KB is comfortably > 200 lines.
   * Filter param trims by substring match (case-insensitive). */
  app.get('/dashboard/log-tail', async (req) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { DATA_ROOT } = await import('../paths.js');
    const logFile = path.posix.join(DATA_ROOT, 'daemon.log');
    const query = req.query as { n?: string; filter?: string };
    const n = Math.min(Math.max(Number(query.n ?? '200') || 200, 10), 1000);
    const filter = (query.filter ?? '').toLowerCase();
    if (!fs.existsSync(logFile)) {
      return { ok: true, lines: [], total_bytes: 0 };
    }
    const stat = fs.statSync(logFile);
    const READ = 64 * 1024;
    const start = Math.max(0, stat.size - READ);
    const fd = fs.openSync(logFile, 'r');
    try {
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const text = buf.toString('utf-8');
      const firstNl = start === 0 ? -1 : text.indexOf('\n');
      const usable = firstNl === -1 ? text : text.slice(firstNl + 1);
      let lines = usable.split('\n').filter((l) => l.length > 0);
      if (filter) lines = lines.filter((l) => l.toLowerCase().includes(filter));
      return {
        ok: true,
        lines: lines.slice(-n),
        total_bytes: stat.size,
        truncated: start > 0,
      };
    } finally {
      fs.closeSync(fd);
    }
  });

  // ── Wiki graph for the orb ───────────────────────────────────────
  app.get('/graph', async () => buildGraph());

  // ── Single wiki page fetch (for the search-result modal) ─────────
  app.get('/wiki/page/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!/^[a-z0-9][a-z0-9-]+$/.test(id)) {
      reply.code(400);
      return { ok: false, error: 'invalid id' };
    }
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { wikiPagesDir, wikiPendingDir, wikiArchiveDir } = await import('../paths.js');
    const { readPage } = await import('../wiki/schema.js');
    const candidates: Array<{ dir: string; status: 'canonical' | 'pending' | 'archived' }> = [
      { dir: wikiPagesDir(), status: 'canonical' },
      { dir: wikiPendingDir(), status: 'pending' },
      { dir: wikiArchiveDir(), status: 'archived' },
    ];
    for (const c of candidates) {
      const file = path.posix.join(c.dir, `${id}.md`);
      if (!fs.existsSync(file)) continue;
      try {
        const page = readPage(file);
        return {
          ok: true,
          page: {
            id: page.frontmatter.id,
            title: page.frontmatter.title,
            trigger: page.frontmatter.trigger,
            insight: page.frontmatter.insight,
            summary: page.frontmatter.summary,
            status: c.status,
            weight: page.frontmatter.weight,
            hits: page.frontmatter.hits,
            corrections: page.frontmatter.corrections,
            created: page.frontmatter.created,
            last_touched: page.frontmatter.last_touched,
            projects: page.frontmatter.projects,
            pattern: page.sections.pattern,
            cross_refs: page.sections.crossRefs,
            evidence: page.sections.evidence,
            log: page.sections.log,
          },
        };
      } catch (err) {
        reply.code(500);
        return { ok: false, error: `parse failed: ${(err as Error).message}` };
      }
    }
    reply.code(404);
    return { ok: false, error: 'page not found' };
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
    const query = (req.query as { q?: string }).q ?? '';
    const opts = query
      ? { recentLimit: 200, query }
      : { recentLimit: 30 };
    const detail = getSessionDetail(id, opts);
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

  /* Nav-mode key injection. The dashboard's Stream Deck rail enters Nav
   * mode on a re-tap of the already-focused tile and exposes the same
   * 5x3 grid the hardware deck does. Each press POSTs here, daemon
   * queues for the bridge, bridge SendInputs into the focused window. */
  app.post('/sessions/:id/key', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { key?: unknown };
    if (!isNavKey(body.key)) {
      reply.code(400);
      return {
        ok: false,
        error:
          'key must be one of: up, down, left, right, enter, backspace, 1-5, mic',
      };
    }
    return queueSessionKey(id, body.key);
  });

  /* Phase ping. Hook-runner POSTs here on every Pre/Post/Prompt/Stop so
   * the dashboard's Stream Deck rail can paint the live tile color. */
  app.post('/sessions/:id/phase', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = req.body as { phase?: string };
    const valid: SessionPhase[] = ['thinking', 'tool', 'permission', 'idle', 'unknown'];
    const phase = (valid as string[]).includes(body.phase ?? '')
      ? (body.phase as SessionPhase)
      : 'idle';
    setPhase(id, phase);
    reply.code(200);
    return { ok: true };
  });

  // ── Search across all collections ────────────────────────────────
  app.post('/search/all', async (req) => {
    const body = (req.body ?? {}) as {
      q?: string;
      project_id?: string;
      collections?: Array<'wiki_page' | 'raw_chunk' | 'reference_chunk'>;
      top_k?: number;
      limit?: number;
      offset?: number;
    };
    if (!body.q) return { ok: false, error: 'q required' };
    const page = await searchAll(
      store,
      {
        query: body.q,
        ...(body.project_id ? { project_id: body.project_id } : {}),
        ...(body.collections ? { collections: body.collections } : {}),
        ...(body.top_k ? { top_k: body.top_k } : {}),
        ...(typeof body.limit === 'number' ? { limit: body.limit } : {}),
        ...(typeof body.offset === 'number' ? { offset: body.offset } : {}),
      },
      referenceStore,
    );
    return {
      ok: true,
      results: page.results,
      total: page.total,
      offset: page.offset,
      limit: page.limit,
    };
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

  // ── Web push (VAPID) ────────────────────────────────────────────
  app.get('/push/vapid-public-key', async () => ({
    ok: true,
    public_key: vapidPublicKey(),
  }));

  app.post('/push/subscribe', async (req, reply) => {
    const body = req.body as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
      user_agent?: string;
    };
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      reply.code(400);
      return { ok: false, error: 'endpoint + keys.{p256dh,auth} required' };
    }
    const sub = saveSubscription({
      endpoint: body.endpoint,
      keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
      ...(body.user_agent ? { user_agent: body.user_agent } : {}),
    });
    return { ok: true, id: sub.id };
  });

  app.delete('/push/subscribe/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    removeSubscription(id);
    return { ok: true };
  });

  app.get('/push/subscriptions', async () => ({
    ok: true,
    subscriptions: listSubscriptions().map((s) => ({
      id: s.id,
      endpoint: s.endpoint,
      created_at: s.created_at,
      user_agent: s.user_agent,
    })),
  }));

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

  // ── Reference upload + corpus management ─────────────────────────
  app.post('/upload', async (req, reply) => {
    const isMultipart = req.isMultipart && req.isMultipart();
    if (!isMultipart) {
      reply.code(400);
      return { ok: false, error: 'multipart upload required' };
    }
    // Single pass: stream the file into a buffer when encountered, capture
    // all field parts. Field order in the multipart is not guaranteed.
    let filename: string | undefined;
    let buffer: Buffer | undefined;
    let projectId = 'global';
    let tags: string[] = [];
    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (filename) {
            // Already have a file; consume and discard extras to drain stream
            await part.toBuffer();
            continue;
          }
          filename = (part as MultipartFile).filename;
          buffer = await (part as MultipartFile).toBuffer();
        } else {
          if (part.fieldname === 'project_id' && typeof part.value === 'string') {
            projectId = part.value;
          }
          if (part.fieldname === 'tags' && typeof part.value === 'string') {
            tags = part.value
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean);
          }
        }
      }
    } catch (err) {
      reply.code(400);
      return { ok: false, error: `upload parse failed: ${(err as Error).message}` };
    }
    if (!filename || !buffer) {
      reply.code(400);
      return { ok: false, error: 'no file in upload' };
    }

    const r = await ingestUpload(
      referenceStore,
      { filename, buffer, project_id: projectId, tags },
      log,
    );
    return r;
  });

  app.get('/reference', async (req) => {
    const projectId = (req.query as { project_id?: string }).project_id;
    return {
      ok: true,
      docs: referenceStore.listDocs({
        ...(projectId ? { project_id: projectId } : {}),
      }),
    };
  });

  app.get('/reference/:doc_id', async (req, reply) => {
    const docId = (req.params as { doc_id: string }).doc_id;
    const doc = referenceStore.getDoc(docId);
    if (!doc) {
      reply.code(404);
      return { ok: false, error: 'doc not found' };
    }
    return { ok: true, doc };
  });

  // ── Admin: one-time backfill of historical Claude transcripts ───
  /* These endpoints are gated behind authMiddleware (registered above on
   * preHandler). They kick off long-running in-process work and return
   * immediately; clients poll /admin/backfill/status for progress. Single
   * -flight per mode; calling start while one is running is a no-op. */
  app.get('/admin/backfill/status', async () => ({
    ok: true,
    ...getBackfillStatus(),
  }));

  app.post('/admin/backfill/raw', async (req, reply) => {
    const body = (req.body ?? {}) as { reset?: boolean };
    if (body.reset) resetBackfill('raw');
    const before = getBackfillStatus().raw;
    if (before.running) {
      return { ok: true, already_running: true, status: before };
    }
    void runBackfillRaw(store, log).catch((err) =>
      log(`[backfill-raw] uncaught: ${(err as Error).message}`),
    );
    reply.code(202);
    return { ok: true, started: true };
  });

  app.post('/admin/backfill/wiki', async (req, reply) => {
    const body = (req.body ?? {}) as { reset?: boolean };
    if (body.reset) resetBackfill('wiki');
    const before = getBackfillStatus().wiki;
    if (before.running) {
      return { ok: true, already_running: true, status: before };
    }
    void runBackfillWiki(store, log).catch((err) =>
      log(`[backfill-wiki] uncaught: ${(err as Error).message}`),
    );
    reply.code(202);
    return { ok: true, started: true };
  });

  /* One-shot cleanup of existing wiki pages on disk. Re-renders every
   * page through the current schema so historical qwen3 ./.md.md drift
   * gets normalised to ./id.md. Idempotent. Safe to run while a wiki
   * backfill is in flight. */
  app.post('/admin/repair/wiki-cross-refs', async () => {
    const r = repairWikiCrossRefs(log);
    return { ok: true, ...r };
  });

  app.post('/admin/backfill/:mode/cancel', async (req, reply) => {
    const mode = (req.params as { mode: string }).mode;
    if (mode !== 'raw' && mode !== 'wiki') {
      reply.code(400);
      return { ok: false, error: 'mode must be raw or wiki' };
    }
    requestBackfillCancel(mode);
    return { ok: true };
  });

  // Use the notification event bus to suppress unused-import lint
  void notificationEvents;
}
