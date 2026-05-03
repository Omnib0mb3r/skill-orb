/**
 * Thin daemon client.
 *
 * In dev, every request hits the Next dev server which rewrites to the daemon
 * (see next.config.mjs). The browser sees a single origin, so HttpOnly cookies
 * set by the daemon (dn_session) flow normally.
 *
 * In prod the daemon serves the static export directly, so all paths
 * resolve to the same origin without any rewriting.
 */

export class DaemonError extends Error {
  constructor(public status: number, public payload: unknown, message: string) {
    super(message);
    this.name = "DaemonError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const isForm = opts.body instanceof FormData;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(isForm ? {} : { "Content-Type": "application/json" }),
    ...(opts.headers ?? {}),
  };
  const res = await fetch(path, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers,
    body: isForm
      ? (opts.body as FormData)
      : opts.body !== undefined
        ? JSON.stringify(opts.body)
        : undefined,
    credentials: "include",
    signal: opts.signal,
  });

  let payload: unknown = undefined;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    payload = await res.json();
  } else {
    payload = await res.text();
  }

  if (!res.ok) {
    throw new DaemonError(res.status, payload, `daemon ${res.status} on ${path}`);
  }
  return payload as T;
}

// ── auth ──────────────────────────────────────────────────────────
export const authStatus = () =>
  request<{ pin_set: boolean; locked: boolean }>("/auth/status");

export const setPin = (pin: string, current_pin?: string) =>
  request<{ ok: boolean; error?: string }>("/auth/pin", {
    method: "POST",
    body: current_pin ? { pin, current_pin } : { pin },
  });

export const unlock = (pin: string) =>
  request<{ ok: boolean; reason?: string; retry_after_ms?: number }>(
    "/auth/unlock",
    { method: "POST", body: { pin } },
  );

export const lock = () => request("/auth/lock", { method: "POST" });

// ── dashboard ────────────────────────────────────────────────────
export interface DashboardHealth {
  ok: boolean;
  pin_set: boolean;
  rollup: "ok" | "warn" | "fail";
  services_total: number;
  services_failing: number;
  unread_notifications: number;
  cpu_percent: number;
  memory_percent: number;
  generated_at: string;
}
export const dashboardHealth = () => request<DashboardHealth>("/dashboard/health");

export interface DailyBrief {
  brief: string;
  whats_new: string[];
  generated_at?: string;
}
export const dailyBrief = () =>
  request<DailyBrief>("/dashboard/daily-brief");

export interface SystemMetrics {
  cpu: { usage_percent: number; cores: number; load_avg?: number[] };
  memory: { total_bytes: number; used_bytes: number; used_percent: number };
  disks: Array<{ mount: string; total_bytes: number; used_bytes: number; used_percent: number }>;
  ollama: { reachable: boolean; model?: string; version?: string };
  data_root_bytes: number;
  timestamp: string;
}
export const systemMetrics = () => request<SystemMetrics>("/dashboard/system-metrics");

// ── services ────────────────────────────────────────────────────
export interface ServiceStatus {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail?: string;
  checked_at: string;
}
export const services = () =>
  request<{ ok: boolean; services: ServiceStatus[]; rollup: "ok" | "warn" | "fail" }>(
    "/services",
  );

// ── sessions ────────────────────────────────────────────────────
export interface SessionSummary {
  id: string;
  cwd: string;
  project_id?: string;
  status: "active" | "idle" | "errored";
  last_activity: string;
  current_task?: string;
}
export const sessions = () =>
  request<{ ok: boolean; sessions: SessionSummary[] }>("/sessions");

export interface SessionDetail extends SessionSummary {
  rolling_summary?: string;
  recent_chunks: Array<{ ts: string; role: string; text: string }>;
}
export const sessionDetail = (id: string) =>
  request<{ ok: boolean; session: SessionDetail }>(`/sessions/${id}`);

export const queuePrompt = (id: string, text: string) =>
  request<{ ok: boolean; queued_at?: string }>(
    `/sessions/${id}/prompt`,
    { method: "POST", body: { text } },
  );

export const focusSession = (id: string) =>
  request<{ ok: boolean }>(`/sessions/${id}/focus`, { method: "POST" });

// ── search ──────────────────────────────────────────────────────
export interface SearchHit {
  source: "wiki_page" | "raw_chunk" | "reference_chunk";
  score: number;
  title?: string;
  preview: string;
  url?: string;
  doc_id?: string;
  page_id?: string;
}
export const searchAll = (
  q: string,
  opts: {
    project_id?: string;
    top_k?: number;
    collections?: Array<"wiki_page" | "raw_chunk" | "reference_chunk">;
  } = {},
) =>
  request<{ ok: boolean; results: SearchHit[] }>("/search/all", {
    method: "POST",
    body: { q, ...opts },
  });

// ── reminders ────────────────────────────────────────────────────
export interface Reminder {
  id: string;
  title: string;
  due_at?: string;
  project_id?: string;
  tags?: string[];
  completed_at?: string;
  archived_at?: string;
}
export const reminders = () => request<{ ok: boolean; reminders: Reminder[] }>("/reminders");
export const createReminder = (input: { title: string; due_at?: string; project_id?: string; tags?: string[] }) =>
  request<{ ok: boolean; reminder: Reminder }>("/reminders", { method: "POST", body: input });
export const completeReminder = (id: string, complete: boolean) =>
  request<{ ok: boolean }>(`/reminders/${id}`, { method: "PATCH", body: { complete } });
export const deleteReminder = (id: string) =>
  request<{ ok: boolean }>(`/reminders/${id}`, { method: "DELETE" });

// ── notifications ────────────────────────────────────────────────
export interface Notification {
  id: string;
  severity: "info" | "warn" | "alert";
  source: string;
  title: string;
  body?: string;
  link?: string;
  ts: string;
  dismissed_at?: string;
}
export const notifications = (limit = 50) =>
  request<{ ok: boolean; notifications: Notification[] }>(
    `/notifications?limit=${limit}`,
  );
export const dismissNotification = (id: string) =>
  request<{ ok: boolean }>(`/notifications/${id}/dismiss`, { method: "POST" });

// ── projects ────────────────────────────────────────────────────
export interface ProjectRecord {
  id: string;
  name: string;
  stage?: string;
  description?: string;
  tags?: string[];
  last_activity?: string;
  active_sessions?: number;
  alerts?: number;
}
// /projects list endpoint not yet shipped — projects-new is. Stub a list call
// that hits a future endpoint and returns an empty list gracefully.
export const projects = () =>
  request<{ ok: boolean; projects: ProjectRecord[] }>("/projects").catch(() => ({
    ok: false,
    projects: [] as ProjectRecord[],
  }));
export const createProject = (input: {
  name: string;
  stage?: "alpha" | "beta" | "deployed" | "archived";
  tags?: string[];
  description?: string;
  open_vscode?: boolean;
}) =>
  request<{ ok: boolean; project?: ProjectRecord; error?: string }>(
    "/projects/new",
    { method: "POST", body: input },
  );

// ── reference docs ──────────────────────────────────────────────
export interface ReferenceDoc {
  doc_id: string;
  filename: string;
  kind: string;
  project_id: string;
  tags: string[];
  uploaded_at: string;
  chunk_count?: number;
}
export const referenceDocs = (project_id?: string) =>
  request<{ ok: boolean; docs: ReferenceDoc[] }>(
    `/reference${project_id ? `?project_id=${encodeURIComponent(project_id)}` : ""}`,
  );

export const uploadReference = (file: File, opts: { project_id?: string; tags?: string[] } = {}) => {
  const fd = new FormData();
  fd.append("file", file);
  if (opts.project_id) fd.append("project_id", opts.project_id);
  if (opts.tags?.length) fd.append("tags", opts.tags.join(","));
  return request<{ ok: boolean; doc_id?: string; error?: string }>("/upload", { body: fd });
};
