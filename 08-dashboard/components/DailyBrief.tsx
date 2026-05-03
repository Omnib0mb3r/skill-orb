"use client";

import { useQuery } from "@tanstack/react-query";
import { dailyBrief } from "@/lib/daemon-client";
import { Icon } from "./Icon";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Working late,";
  if (h < 12) return "Good morning,";
  if (h < 18) return "Afternoon,";
  return "Evening,";
}

/* Tiny markdown renderer — handles headings, bold, lists, links, paragraphs.
 * Avoids pulling in a full marked/remark dep just for the whats-new digest.
 * If the wiki ever needs richer rendering, swap this for `marked` then. */
function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  let listBuf: string[] = [];
  const flushList = () => {
    if (listBuf.length === 0) return;
    out.push(
      <ul key={out.length} className="list-disc pl-5 space-y-1 my-2">
        {listBuf.map((item, i) => (
          <li key={i} className="text-sm text-txt2">
            {inline(item)}
          </li>
        ))}
      </ul>,
    );
    listBuf = [];
  };
  function inline(text: string): React.ReactNode {
    // **bold** then [text](url)
    const parts: React.ReactNode[] = [];
    const re = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
    let last = 0;
    let m;
    let key = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith("**")) {
        parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
      } else {
        const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!;
        parts.push(
          <a key={key++} href={lm[2]} className="text-brandSoft hover:underline">
            {lm[1]}
          </a>,
        );
      }
      last = m.index + tok.length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  }

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^# /.test(line)) {
      flushList();
      out.push(
        <h2 key={out.length} className="font-display text-md font-emphasized mt-4 mb-2 text-txt1">
          {line.replace(/^# /, "")}
        </h2>,
      );
    } else if (/^## /.test(line)) {
      flushList();
      out.push(
        <h3 key={out.length} className="font-display text-sm font-emphasized mt-3 mb-1 text-txt1">
          {line.replace(/^## /, "")}
        </h3>,
      );
    } else if (/^[-*] /.test(line)) {
      listBuf.push(line.replace(/^[-*] /, ""));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      out.push(
        <p key={out.length} className="text-sm text-txt2 mb-2">
          {inline(line)}
        </p>,
      );
    }
  }
  flushList();
  return out;
}

export function DailyBrief() {
  const q = useQuery({
    queryKey: ["daily-brief"],
    queryFn: dailyBrief,
    refetchInterval: 60_000,
  });

  const summary = q.data?.summary;
  const md = q.data?.whats_new_markdown ?? "";

  return (
    <section className="rounded-panel bg-surface1 hairline relative overflow-hidden">
      <div className="absolute inset-0 grid-bg pointer-events-none" />
      <div className="relative px-7 py-6 flex items-start gap-5">
        <div className="flex-1 min-w-0">
          <div className="text-nano text-txt3 mb-1">
            Daily brief ·{" "}
            {new Date().toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </div>
          <h1 className="font-display text-3xl font-bold leading-snug text-txt1 mb-2">
            {greeting()} <span className="text-brandSoft">Michael</span>.
          </h1>
          {q.isLoading ? (
            <div className="space-y-1.5">
              <div className="h-3 w-3/4 rounded bg-surface2 animate-pulse" />
              <div className="h-3 w-1/2 rounded bg-surface2 animate-pulse" />
            </div>
          ) : summary ? (
            <p className="text-txt2 text-md max-w-2xl">
              {summary.projects_total} projects, {summary.active_sessions} active session
              {summary.active_sessions === 1 ? "" : "s"}, {summary.unread_notifications}{" "}
              unread{" "}
              {summary.unread_notifications === 1 ? "notification" : "notifications"}.{" "}
              {summary.whats_new_present
                ? `Wiki digest from ${
                    summary.whats_new_age_hours != null
                      ? Math.round(summary.whats_new_age_hours) + "h ago"
                      : "—"
                  }.`
                : "No wiki digest yet."}
            </p>
          ) : (
            <p className="text-txt3 text-sm">Daemon not reachable.</p>
          )}
        </div>
        <button
          className="shrink-0 h-9 px-3.5 rounded-card bg-brand/10 hairline ring-1 ring-brand/30 text-brandSoft text-xs font-emphasized hover:bg-brand/15 flex items-center gap-2"
          aria-label="Refresh brief"
          onClick={() => q.refetch()}
        >
          <Icon name="RefreshCw" size={14} /> refresh
        </button>
      </div>

      {md && (
        <div className="relative border-t border-border2 px-7 py-5">
          <div className="text-nano text-txt3 mb-2">What&apos;s new</div>
          <div className="prose prose-invert max-w-none">{renderMarkdown(md)}</div>
        </div>
      )}
    </section>
  );
}
