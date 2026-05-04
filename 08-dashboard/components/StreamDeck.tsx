"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sessions as sessionsClient, type SessionSummary } from "@/lib/daemon-client";
import { projectFromSlug, relTime } from "@/lib/session-helpers";
import { Icon } from "./Icon";

/* Stream Deck rail — vertical port of the physical Elgato Stream Deck
 * controller at github.com/Omnib0mb3r/stream-deck. Each tile represents
 * a live Claude Code session in the same way the hardware does:
 *
 *   - tile color reflects session state (blue=idle, green=active/working,
 *     red blinking=needs permission, gray=stale/old)
 *   - top line: folder basename (project)
 *   - bottom line: first 3 chars of sessionId (disambiguates same-folder
 *     sessions, matches the deck's bottom label)
 *   - tap → opens session detail (the dashboard's analog to "focus the
 *     VSCode window" since the dashboard runs over Tailscale and can't
 *     focus a window remotely)
 *
 * The hardware deck is 5x3; this is a vertical N-tile column. Same
 * tile language, different orientation. */

const STALE_HIDE_MS = 7 * 24 * 60 * 60 * 1000;

type TileState = "active" | "idle" | "permission" | "stale";

function tileState(s: SessionSummary): TileState {
  if (s.active) return "active";
  if (Date.now() - s.last_modified_ms > STALE_HIDE_MS) return "stale";
  return "idle";
}

const TILE_COLORS: Record<TileState, { bg: string; ring: string; label: string }> = {
  active:     { bg: "var(--c-ok)",    ring: "var(--c-ok-soft)",    label: "var(--c-bg)" },
  idle:       { bg: "var(--c-live)",  ring: "var(--c-live-soft)",  label: "var(--c-bg)" },
  permission: { bg: "var(--c-err)",   ring: "var(--c-err-soft)",   label: "var(--c-bg)" },
  stale:      { bg: "var(--c-bg-elev-2)", ring: "var(--c-border)", label: "var(--c-fg-muted)" },
};

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
    <aside className="w-64 flex-shrink-0 flex flex-col gap-2 p-3 hairline-soft border-r border-border2 overflow-y-auto">
      <div className="flex items-center justify-between mb-1 px-1">
        <div className="text-nano text-txt3">Stream deck</div>
        <span className="text-nano text-txt3 font-mono">
          {fresh.filter((s) => s.active).length}/{fresh.length}
        </span>
      </div>

      {q.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="aspect-[5/3] rounded-card bg-surface1 animate-pulse" />
          ))}
        </div>
      )}

      {!q.isLoading && visible.length === 0 && (
        <div className="text-xs text-txt3 px-2 py-3">
          No active sessions. Open a Claude session in any VSCode window on OTLCDEV; a tile
          appears here within 5s.
        </div>
      )}

      {visible.map((s) => {
        const state = tileState(s);
        const colors = TILE_COLORS[state];
        const project = projectFromSlug(s.project_slug);
        const sidShort = s.session_id.slice(0, 3).toUpperCase();
        const blinking = state === "permission";
        return (
          <Link
            key={s.session_id}
            href={`/sessions/detail?id=${encodeURIComponent(s.session_id)}`}
            className="block relative aspect-[5/3] rounded-card overflow-hidden lift focus:outline-none focus:ring-2 focus:ring-brand/60"
            style={{
              background: colors.bg,
              boxShadow: `inset 0 0 0 2px ${colors.ring}`,
            }}
            aria-label={`Session ${project} (${state}); ${s.session_id}`}
          >
            <div
              className={`absolute inset-0 flex flex-col items-center justify-center px-2 ${
                blinking ? "pulse-live" : ""
              }`}
              style={{ color: colors.label }}
            >
              <div className="font-display text-sm font-bold text-center leading-tight truncate w-full">
                {project}
              </div>
              <div className="font-mono text-[11px] tracking-widest opacity-80 mt-0.5">
                {sidShort}
              </div>
            </div>

            {/* tiny corner badges for captured task/summary */}
            {(s.has_task || s.has_summary) && (
              <div className="absolute top-1.5 right-1.5 flex gap-1" style={{ color: colors.label }}>
                {s.has_task && <Icon name="ListTodo" size={10} />}
                {s.has_summary && <Icon name="ScrollText" size={10} />}
              </div>
            )}
            <div
              className="absolute bottom-1 left-2 text-[9px] font-mono opacity-70"
              style={{ color: colors.label }}
            >
              {relTime(s.last_modified_ms)}
            </div>
          </Link>
        );
      })}

      <button
        className="aspect-[5/3] lift rounded-card border-2 border-dashed border-border1 text-txt3 hover:text-txt1 flex items-center justify-center gap-1.5 text-xs font-mono mt-1"
      >
        <Icon name="Plus" size={14} /> new
      </button>

      {staleCount > 0 && (
        <button
          onClick={() => setShowStale((v) => !v)}
          className="text-nano text-txt3 hover:text-txt1 mt-1 px-2 py-1 text-left"
          aria-expanded={showStale}
        >
          {showStale
            ? `Hide ${staleCount} stale tile${staleCount === 1 ? "" : "s"}`
            : `+${staleCount} stale tile${staleCount === 1 ? "" : "s"} (>7d)`}
        </button>
      )}
    </aside>
  );
}
