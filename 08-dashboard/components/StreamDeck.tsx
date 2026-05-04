"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sessions as sessionsClient, type SessionSummary } from "@/lib/daemon-client";
import { projectFromSlug, relTime } from "@/lib/session-helpers";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";

/* Stream Deck rail.
 *
 * Visuals: long card-per-session with a status LED dot. Same look as the
 * pre-redesign rail; only the data/code changed.
 *
 * What's new under the hood vs the v1 card:
 *  - state derives from a single tileState() helper (active / idle /
 *    permission / stale) so future logic (LED blink on permission, color
 *    change on tool-use waiting, etc.) lives in one place
 *  - "stale" filter still hides sessions older than 7d behind a toggle so
 *    the rail doesn't fill with months of dead jsonl files
 *  - active/total counter in the header makes the rail's at-a-glance
 *    answer honest (used to imply 0 active when there were stale tiles)
 *
 * Tap a tile -> opens session detail (the dashboard analog of "focus the
 * VSCode window," since the dashboard runs over Tailscale and can't
 * focus a window on the host remotely). */

const STALE_HIDE_MS = 7 * 24 * 60 * 60 * 1000;

type TileState = "active" | "idle" | "permission" | "stale";

function tileState(s: SessionSummary): TileState {
  if (s.active) return "active";
  if (Date.now() - s.last_modified_ms > STALE_HIDE_MS) return "stale";
  return "idle";
}

function ledStatus(state: TileState): "live" | "ok" | "fail" | "idle" {
  switch (state) {
    case "active":     return "live";
    case "permission": return "fail";
    case "idle":       return "idle";
    case "stale":      return "idle";
  }
}

export function StreamDeck() {
  const q = useQuery({
    queryKey: ["sessions"],
    queryFn: sessionsClient,
    refetchInterval: 5_000,
  });
  const [showStale, setShowStale] = useState(false);

  const all: SessionSummary[] = q.data?.sessions ?? [];
  const fresh = all.filter((s) => tileState(s) !== "stale");
  const staleCount = all.length - fresh.length;
  const visible = [...(showStale ? all : fresh)].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return b.last_modified_ms - a.last_modified_ms;
  });

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col gap-3 p-4 hairline-soft border-r border-border2 overflow-y-auto">
      <div className="flex items-center justify-between mb-1">
        <div className="text-nano text-txt3">Stream deck</div>
        <span className="text-nano text-txt3 font-mono">
          {fresh.filter((s) => s.active).length}/{fresh.length}
        </span>
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

      {visible.map((s) => {
        const state = tileState(s);
        const led = ledStatus(state);
        const project = projectFromSlug(s.project_slug);
        const ring =
          state === "active"
            ? "ring-live"
            : state === "permission"
              ? "ring-warn"
              : "";
        return (
          <Link
            key={s.session_id}
            href={`/sessions/detail?id=${encodeURIComponent(s.session_id)}`}
            className={`block text-left p-3 rounded-card bg-surface1 hairline lift ${ring}`}
            aria-label={`Session ${project} (${state})`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="font-display text-sm font-emphasized truncate text-txt1">
                {project}
              </div>
              <StatusDot status={led} pulse={state === "active" || state === "permission"} />
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

      {staleCount > 0 && (
        <button
          onClick={() => setShowStale((v) => !v)}
          className="text-nano text-txt3 hover:text-txt1 mt-1 px-2 py-1 text-left"
          aria-expanded={showStale}
        >
          {showStale
            ? `Hide ${staleCount} stale session${staleCount === 1 ? "" : "s"}`
            : `+${staleCount} stale session${staleCount === 1 ? "" : "s"} (>7d)`}
        </button>
      )}
    </aside>
  );
}
