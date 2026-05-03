import type { SessionSummary } from "./daemon-client";

/** Decode a project_slug into something readable.
 * Daemon slugs come from ~/.claude/projects/<slug>/ which is the cwd path
 * with separators replaced by `-`. e.g. `c--dev-Projects-DevNeural` →
 * "DevNeural". Best effort — fall back to the slug itself if we can't
 * recover a clean leaf. */
export function projectFromSlug(slug: string): string {
  if (!slug) return "unknown";
  const parts = slug
    .replace(/^c--/, "")
    .replace(/^[a-z]--/, "")
    .split("-")
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : slug;
}

/** Turn last_modified_ms into a relative time string. */
export function relTime(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  const diffS = Math.max(0, (Date.now() - ms) / 1000);
  if (diffS < 60) return `${Math.round(diffS)}s`;
  if (diffS < 3600) return `${Math.round(diffS / 60)}m`;
  if (diffS < 86400) return `${Math.round(diffS / 3600)}h`;
  return `${Math.round(diffS / 86400)}d`;
}

/** Group sessions by project slug so we can badge the projects grid. */
export function sessionsByProject(list: SessionSummary[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of list) {
    if (!s.active) continue;
    const key = projectFromSlug(s.project_slug);
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
}
