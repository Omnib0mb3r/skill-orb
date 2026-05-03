"use client";

import Link from "next/link";
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

export function SessionsTable() {
  const q = useQuery({
    queryKey: ["sessions"],
    queryFn: sessionsClient,
    refetchInterval: 5_000,
  });

  const sessions: SessionSummary[] = q.data?.sessions ?? [];

  return (
    <div className="rounded-panel bg-surface1 hairline overflow-hidden">
      <div className="px-5 py-3 border-b border-border1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="Terminal" className="text-brandSoft" size={16} />
          <h2 className="font-display text-sm font-emphasized">Active sessions</h2>
        </div>
        <span className="text-nano text-txt3">{sessions.length} running</span>
      </div>

      {q.isLoading && (
        <div className="p-6 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 rounded-card bg-surface2 animate-pulse" />
          ))}
        </div>
      )}

      {!q.isLoading && sessions.length === 0 && (
        <div className="p-8 text-center text-txt3 text-sm">
          No active sessions on OTLCDEV.
        </div>
      )}

      {sessions.length > 0 && (
        <table className="w-full">
          <thead>
            <tr className="text-left text-nano text-txt3 border-b border-border2">
              <th className="px-5 py-2 font-normal">Project</th>
              <th className="px-3 py-2 font-normal">Session ID</th>
              <th className="px-3 py-2 font-normal">Status</th>
              <th className="px-3 py-2 font-normal">Current task</th>
              <th className="px-5 py-2 font-normal text-right">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const project = s.project_id ?? projectFromCwd(s.cwd);
              return (
                <tr key={s.id} className="border-b border-border2 lift">
                  <td className="px-5 py-3">
                    <Link
                      href={`/sessions/${s.id}`}
                      className="text-txt1 hover:text-brandSoft font-emphasized text-sm"
                    >
                      {project}
                    </Link>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-txt3">
                    {s.id.slice(0, 12)}
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <StatusDot
                        status={
                          s.status === "active"
                            ? "live"
                            : s.status === "errored"
                              ? "fail"
                              : "idle"
                        }
                        pulse={s.status === "active"}
                      />
                      {s.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-txt2 truncate max-w-md">
                    {s.current_task ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-right text-[11px] font-mono text-txt3">
                    {relTime(s.last_activity)} ago
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
