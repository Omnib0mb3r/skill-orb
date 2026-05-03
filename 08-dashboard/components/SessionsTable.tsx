"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { sessions as sessionsClient, type SessionSummary } from "@/lib/daemon-client";
import { projectFromSlug, relTime } from "@/lib/session-helpers";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";

export function SessionsTable() {
  const q = useQuery({
    queryKey: ["sessions"],
    queryFn: sessionsClient,
    refetchInterval: 5_000,
  });

  const list: SessionSummary[] = q.data?.sessions ?? [];
  const visible = [...list].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return b.last_modified_ms - a.last_modified_ms;
  });

  return (
    <div className="rounded-panel bg-surface1 hairline overflow-hidden">
      <div className="px-5 py-3 border-b border-border1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="Terminal" className="text-brandSoft" size={16} />
          <h2 className="font-display text-sm font-emphasized">Sessions on OTLCDEV</h2>
        </div>
        <span className="text-nano text-txt3">
          {visible.filter((s) => s.active).length} active · {visible.length} total
        </span>
      </div>

      {q.isLoading && (
        <div className="p-6 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 rounded-card bg-surface2 animate-pulse" />
          ))}
        </div>
      )}

      {!q.isLoading && visible.length === 0 && (
        <div className="p-8 text-center text-txt3 text-sm">
          No Claude sessions captured yet. Open a Claude Code terminal in any VS Code window on
          OTLCDEV, type one prompt, then refresh.
        </div>
      )}

      {visible.length > 0 && (
        <table className="w-full">
          <thead>
            <tr className="text-left text-nano text-txt3 border-b border-border2">
              <th className="px-5 py-2 font-normal">Project</th>
              <th className="px-3 py-2 font-normal">Session ID</th>
              <th className="px-3 py-2 font-normal">Status</th>
              <th className="px-3 py-2 font-normal">Captured state</th>
              <th className="px-5 py-2 font-normal text-right">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <tr key={s.session_id} className="border-b border-border2 lift">
                <td className="px-5 py-3">
                  <Link
                    href={`/sessions/${s.session_id}`}
                    className="text-txt1 hover:text-brandSoft font-emphasized text-sm"
                  >
                    {projectFromSlug(s.project_slug)}
                  </Link>
                </td>
                <td className="px-3 py-3 font-mono text-xs text-txt3">
                  {s.session_id.slice(0, 12)}
                </td>
                <td className="px-3 py-3">
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <StatusDot status={s.active ? "live" : "idle"} pulse={s.active} />
                    {s.active ? "active" : "idle"}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs text-txt2">
                  <span className="inline-flex items-center gap-2">
                    {s.has_task && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-txt3">
                        <Icon name="ListTodo" size={12} /> task
                      </span>
                    )}
                    {s.has_summary && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-txt3">
                        <Icon name="ScrollText" size={12} /> summary
                      </span>
                    )}
                    {!s.has_task && !s.has_summary && <span className="text-txt3">—</span>}
                  </span>
                </td>
                <td className="px-5 py-3 text-right text-[11px] font-mono text-txt3">
                  {relTime(s.last_modified_ms)} ago
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
