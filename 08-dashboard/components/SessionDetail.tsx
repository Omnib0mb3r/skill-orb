"use client";

import { useQuery } from "@tanstack/react-query";
import { sessionDetail } from "@/lib/daemon-client";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const q = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => sessionDetail(sessionId),
    refetchInterval: 5_000,
  });

  if (q.isLoading) {
    return (
      <div className="rounded-panel bg-surface1 hairline p-6 space-y-3">
        <div className="h-5 w-1/3 rounded bg-surface2 animate-pulse" />
        <div className="h-3 w-2/3 rounded bg-surface2 animate-pulse" />
        <div className="h-3 w-1/2 rounded bg-surface2 animate-pulse" />
      </div>
    );
  }
  if (!q.data?.ok) {
    return (
      <div className="rounded-panel bg-surface1 hairline p-6 text-sm text-err">
        Session not found or daemon unreachable.
      </div>
    );
  }

  const s = q.data.session;

  return (
    <div className="space-y-5">
      <div className="rounded-panel bg-surface1 hairline">
        <div className="px-5 py-3 border-b border-border1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="Terminal" className="text-brandSoft" size={16} />
            <h2 className="font-display text-sm font-emphasized">{s.id.slice(0, 12)}</h2>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-txt3 ml-2">
              <StatusDot
                status={
                  s.status === "active" ? "live" : s.status === "errored" ? "fail" : "idle"
                }
                pulse={s.status === "active"}
              />
              {s.status}
            </span>
          </div>
          <div className="text-nano text-txt3 truncate max-w-md">{s.cwd}</div>
        </div>
        {s.current_task && (
          <div className="px-5 py-3 border-b border-border2">
            <div className="text-nano text-txt3 mb-1">Current task</div>
            <div className="text-sm text-txt1">{s.current_task}</div>
          </div>
        )}
        {s.rolling_summary && (
          <div className="px-5 py-3">
            <div className="text-nano text-txt3 mb-1">Rolling summary</div>
            <div className="text-sm text-txt2 whitespace-pre-wrap line-clamp-6">
              {s.rolling_summary}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-panel bg-surface1 hairline">
        <div className="px-5 py-3 border-b border-border1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="ScrollText" className="text-brandSoft" size={16} />
            <h2 className="font-display text-sm font-emphasized">Recent transcript</h2>
          </div>
          <span className="text-nano text-txt3">{s.recent_chunks?.length ?? 0} turns</span>
        </div>
        <div className="max-h-[400px] overflow-y-auto divide-y divide-border2">
          {(s.recent_chunks ?? []).length === 0 && (
            <div className="px-5 py-4 text-xs text-txt3">No recent turns captured.</div>
          )}
          {(s.recent_chunks ?? []).map((c, i) => (
            <div key={i} className="px-5 py-3 flex gap-3">
              <span className="text-nano text-txt3 shrink-0 w-12 mt-0.5">
                {c.role.slice(0, 8)}
              </span>
              <div className="text-xs text-txt2 font-mono whitespace-pre-wrap flex-1 min-w-0">
                {c.text}
              </div>
              <span className="text-nano text-txt3 shrink-0 mt-0.5">
                {new Date(c.ts).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
