"use client";

import { useQuery } from "@tanstack/react-query";
import { sessions as sessionsClient, type SessionSummary } from "@/lib/daemon-client";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";

function relTime(ts: string | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const diffS = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (diffS < 60) return `${Math.round(diffS)}s`;
  if (diffS < 3600) return `${Math.round(diffS / 60)}m`;
  if (diffS < 86400) return `${Math.round(diffS / 3600)}h`;
  return `${Math.round(diffS / 86400)}d`;
}

function projectFromCwd(cwd: string): string {
  return cwd.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "unknown";
}

export function StreamDeck() {
  const q = useQuery({
    queryKey: ["sessions"],
    queryFn: sessionsClient,
    refetchInterval: 5_000,
  });

  const sessions: SessionSummary[] = q.data?.sessions ?? [];

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col gap-3 p-4 hairline-soft border-r border-border2">
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

      {!q.isLoading && sessions.length === 0 && (
        <div className="text-xs text-txt3 px-2 py-3">
          No active sessions. Start a Claude session in any VS Code window on OTLCDEV.
        </div>
      )}

      {sessions.map((s) => {
        const project = s.project_id ?? projectFromCwd(s.cwd);
        const ring =
          s.status === "active"
            ? "ring-live"
            : s.status === "errored"
              ? "ring-warn"
              : s.status === "idle"
                ? ""
                : "";
        return (
          <button
            key={s.id}
            className={`text-left p-3 rounded-card bg-surface1 hairline lift ${ring}`}
            aria-label={`Session ${project}, status ${s.status}`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="font-display text-sm font-emphasized truncate text-txt1">
                {project}
              </div>
              <StatusDot
                status={s.status === "active" ? "live" : s.status === "errored" ? "fail" : "idle"}
                pulse={s.status === "active"}
              />
            </div>
            <div className="text-xs text-txt3 truncate font-mono">{s.id.slice(0, 8)}</div>
            {s.current_task && (
              <div className="mt-1 text-xs text-txt2 line-clamp-2">{s.current_task}</div>
            )}
            <div className="mt-1.5 text-[11px] font-mono text-txt3">
              last {relTime(s.last_activity)} ago
            </div>
          </button>
        );
      })}

      <button className="mt-1 lift p-3 rounded-card bg-surface1 hairline border-dashed text-txt2 hover:text-txt1 flex items-center justify-center gap-2 text-sm font-medium">
        <Icon name="Plus" size={16} /> new session
      </button>
    </aside>
  );
}
