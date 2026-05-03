"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { sessions as sessionsClient, type SessionSummary } from "@/lib/daemon-client";
import { projectFromSlug, relTime } from "@/lib/session-helpers";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";

export function StreamDeck() {
  const q = useQuery({
    queryKey: ["sessions"],
    queryFn: sessionsClient,
    refetchInterval: 5_000,
  });

  const all: SessionSummary[] = q.data?.sessions ?? [];
  // Sort: active first, then by recency.
  const visible = [...all].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return b.last_modified_ms - a.last_modified_ms;
  });

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col gap-3 p-4 hairline-soft border-r border-border2 overflow-y-auto">
      <div className="flex items-center justify-between mb-1">
        <div className="text-nano text-txt3">Stream deck</div>
        <button className="text-txt3 hover:text-txt1" aria-label="Pin stream deck">
          <Icon name="Pin" size={14} />
        </button>
      </div>

      {q.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-card bg-surface1 animate-pulse" />
          ))}
        </div>
      )}

      {!q.isLoading && visible.length === 0 && (
        <div className="text-xs text-txt3 px-2 py-3">
          No sessions captured yet. Start a Claude session in any VS Code window on OTLCDEV
          and it&apos;ll appear here within a few seconds.
        </div>
      )}

      {visible.slice(0, 20).map((s) => {
        const project = projectFromSlug(s.project_slug);
        const ring = s.active ? "ring-live" : "";
        return (
          <Link
            key={s.session_id}
            href={`/sessions/${s.session_id}`}
            className={`block text-left p-3 rounded-card bg-surface1 hairline lift ${ring}`}
            aria-label={`Session ${project}, ${s.active ? "active" : "idle"}`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="font-display text-sm font-emphasized truncate text-txt1">
                {project}
              </div>
              <StatusDot status={s.active ? "live" : "idle"} pulse={s.active} />
            </div>
            <div className="text-xs text-txt3 truncate font-mono">
              {s.session_id.slice(0, 8)}
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono text-txt3">
              <span>last {relTime(s.last_modified_ms)} ago</span>
              <span className="flex items-center gap-1">
                {s.has_task && <Icon name="ListTodo" size={11} />}
                {s.has_summary && <Icon name="ScrollText" size={11} />}
              </span>
            </div>
          </Link>
        );
      })}

      <button className="mt-1 lift p-3 rounded-card bg-surface1 hairline border-dashed text-txt2 hover:text-txt1 flex items-center justify-center gap-2 text-sm font-medium">
        <Icon name="Plus" size={16} /> new session
      </button>
    </aside>
  );
}
