"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  reminders as remindersClient,
  notifications as notificationsClient,
  completeReminder,
} from "@/lib/daemon-client";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";

export function RightRail() {
  const qc = useQueryClient();
  const remQ = useQuery({
    queryKey: ["reminders"],
    queryFn: remindersClient,
    refetchInterval: 30_000,
  });
  const notQ = useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: () => notificationsClient(30),
    refetchInterval: 8_000,
  });
  const toggleM = useMutation({
    mutationFn: ({ id, complete }: { id: string; complete: boolean }) =>
      completeReminder(id, complete),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reminders"] }),
  });

  const openReminders = (remQ.data?.reminders ?? []).filter(
    (r) => !r.completed_at && !r.archived_at,
  );
  const events = (notQ.data?.notifications ?? []).filter((n) => !n.dismissed_at).slice(0, 12);

  return (
    <aside className="w-80 flex-shrink-0 flex flex-col gap-4 p-4 hairline-soft border-l border-border2 overflow-y-auto">
      {/* reminders */}
      <section className="rounded-card bg-surface1 hairline">
        <div className="px-4 py-3 border-b border-border1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="ListChecks" className="text-brandSoft" size={16} />
            <h2 className="font-display text-sm font-emphasized">Reminders</h2>
          </div>
          <span className="text-nano text-txt3">{openReminders.length} open</span>
        </div>
        <ul className="divide-y divide-border2">
          {openReminders.length === 0 && (
            <li className="px-4 py-3 text-xs text-txt3">All caught up.</li>
          )}
          {openReminders.slice(0, 6).map((r) => (
            <li
              key={r.id}
              className="px-4 py-2.5 flex items-center gap-2.5 lift cursor-pointer"
            >
              <input
                type="checkbox"
                aria-label={`Mark ${r.title} complete`}
                onChange={(e) =>
                  toggleM.mutate({ id: r.id, complete: e.target.checked })
                }
                className="w-3.5 h-3.5 accent-brand bg-surface1"
              />
              <span className="flex-1 truncate text-txt2">{r.title}</span>
              {r.due_at && (
                <span className="text-[11px] font-mono text-txt3">
                  {new Date(r.due_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* live activity */}
      <section className="rounded-card bg-surface1 hairline">
        <div className="px-4 py-3 border-b border-border1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="Activity" className="text-brandSoft" size={16} />
            <h2 className="font-display text-sm font-emphasized">Live activity</h2>
          </div>
          <button
            className="text-[11px] font-mono text-txt3 hover:text-txt1 flex items-center gap-1"
            aria-label="Filter activity"
          >
            <Icon name="Filter" size={12} /> all
          </button>
        </div>
        <ul className="divide-y divide-border2">
          {events.length === 0 && (
            <li className="px-4 py-3 text-xs text-txt3 feed-item">
              Nothing moving right now.
            </li>
          )}
          {events.map((n) => {
            const dot =
              n.severity === "alert" ? "fail" : n.severity === "warn" ? "warn" : "ai";
            return (
              <li key={n.id} className="px-4 py-2.5 flex items-start gap-2.5 feed-item">
                <span className="mt-1">
                  <StatusDot status={dot} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-txt1 truncate">{n.title}</div>
                  {n.body && (
                    <div className="text-[11px] font-mono text-txt3 mt-0.5 truncate">
                      {n.body}
                    </div>
                  )}
                </div>
                <div className="text-[11px] font-mono text-txt3 shrink-0">
                  {new Date(n.ts).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}
