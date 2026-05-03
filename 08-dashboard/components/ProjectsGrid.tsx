"use client";

import { useQuery } from "@tanstack/react-query";
import { projects as projectsClient, sessions as sessionsClient } from "@/lib/daemon-client";
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

export function ProjectsGrid() {
  const projQ = useQuery({
    queryKey: ["projects"],
    queryFn: projectsClient,
    refetchInterval: 30_000,
  });
  const sessQ = useQuery({
    queryKey: ["sessions"],
    queryFn: sessionsClient,
    refetchInterval: 5_000,
  });

  const list = projQ.data?.projects ?? [];
  const sessByProject = new Map<string, number>();
  (sessQ.data?.sessions ?? []).forEach((s) => {
    const key = s.project_id ?? s.cwd;
    sessByProject.set(key, (sessByProject.get(key) ?? 0) + 1);
  });

  if (projQ.isLoading) {
    return (
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-28 rounded-card bg-surface1 hairline animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="rounded-panel bg-surface1 hairline p-10 text-center">
        <Icon name="FolderPlus" className="text-brandSoft mx-auto mb-3" size={32} />
        <h3 className="font-display text-md font-emphasized mb-1">
          No projects registered yet.
        </h3>
        <p className="text-txt3 text-sm">
          Hit &ldquo;new project&rdquo; above, or run a Claude session in any
          DevNeural-aware repo on OTLCDEV — it auto-registers.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      {list.map((p) => {
        const liveSessions = sessByProject.get(p.id) ?? 0;
        return (
          <div
            key={p.id}
            className="rounded-card bg-surface1 hairline lift p-4 cursor-pointer"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="font-display text-sm font-emphasized truncate">
                {p.name}
              </div>
              {liveSessions > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-live">
                  <StatusDot status="live" pulse /> {liveSessions}
                </span>
              )}
            </div>
            <div className="text-nano text-txt3 truncate" title={p.root}>
              {p.root}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-txt3">
              <span className="truncate" title={p.remote ?? "no remote"}>
                {p.remote ? new URL(p.remote.replace(/^git@([^:]+):/, "https://$1/")).pathname.replace(/^\//, "").replace(/\.git$/, "") : "no remote"}
              </span>
              <span>{relTime(p.last_seen)} ago</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
