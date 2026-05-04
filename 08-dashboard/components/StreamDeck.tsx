"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { focusSession, sessions as sessionsClient, type SessionSummary } from "@/lib/daemon-client";
import { projectFromSlug, relTime } from "@/lib/session-helpers";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";

/* Stream Deck rail = remote analog of the physical Elgato deck.
 *
 * Tap a tile = POST /sessions/:id/focus, which writes to the session-bridge
 * queue. The 09-bridge VS Code extension on OTLCDEV picks it up and brings
 * the matching VSCode window forward, exactly like the hardware deck does.
 *
 * No navigation: the rail is a remote control surface, not a navigation
 * affordance. Sessions tab is where you go to read transcripts and send
 * prompts; this rail is just "make this window the active one on my PC."
 *
 * Visual feedback: the tile briefly pulses brand color while the focus
 * request is in flight so the user knows their tap was registered even
 * when they can't see the host monitor (e.g. on phone over Tailscale). */

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

  /* Only ACTIVE sessions go on the rail. The hardware Stream Deck only
   * paints tiles for live Claude sessions; tiles you tap actually do
   * something. Idle sessions are jsonl files with no live process to
   * focus or send a prompt to, so they belong on the /sessions tab as
   * a list, not on the deck. The "show inactive" toggle pops them back
   * in if the user explicitly wants to see history. */
  const all: SessionSummary[] = q.data?.sessions ?? [];
  const active = all.filter((s) => s.active);
  const inactive = all.filter((s) => !s.active);
  const visible = [...(showStale ? all : active)].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return b.last_modified_ms - a.last_modified_ms;
  });

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col gap-3 p-4 hairline-soft border-r border-border2 overflow-y-auto">
      <div className="flex items-center justify-between mb-1">
        <div className="text-nano text-txt3">Stream deck</div>
        <span className="text-nano text-txt3 font-mono">
          {active.length} live
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
          No active sessions to control right now. Start a Claude session in any VS Code window
          on OTLCDEV; a tile appears here within 5s.
        </div>
      )}

      {visible.map((s) => (
        <DeckTile key={s.session_id} session={s} />
      ))}

      <a
        href="/sessions"
        className="mt-1 lift p-3 rounded-card bg-surface1 hairline border-dashed text-txt2 hover:text-txt1 flex items-center justify-center gap-2 text-sm font-medium"
        aria-label="Manage sessions on the Sessions tab"
      >
        <Icon name="Plus" size={16} /> new session
      </a>

      {inactive.length > 0 && (
        <button
          onClick={() => setShowStale((v) => !v)}
          className="text-nano text-txt3 hover:text-txt1 mt-1 px-2 py-1 text-left"
          aria-expanded={showStale}
        >
          {showStale
            ? `Hide ${inactive.length} inactive`
            : `+${inactive.length} inactive (history)`}
        </button>
      )}
    </aside>
  );
}

/* Single deck tile. Encapsulates the focus mutation so each tile manages
 * its own pulse state independently of siblings. */
function DeckTile({ session: s }: { session: SessionSummary }) {
  const state = tileState(s);
  const led = ledStatus(state);
  const project = projectFromSlug(s.project_slug);
  const ring =
    state === "active"
      ? "ring-live"
      : state === "permission"
        ? "ring-warn"
        : "";
  const focusM = useMutation({
    mutationFn: () => focusSession(s.session_id),
  });
  return (
    <button
      type="button"
      onClick={() => focusM.mutate()}
      disabled={focusM.isPending}
      className={`block text-left p-3 rounded-card bg-surface1 hairline lift transition-shadow ${ring} ${
        focusM.isPending ? "ring-1 ring-brand/60" : ""
      }`}
      aria-label={`Focus VS Code window for ${project} (${state})`}
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
        <span>
          {focusM.isPending
            ? "focusing…"
            : focusM.isSuccess
              ? "focused ✓"
              : `last ${relTime(s.last_modified_ms)} ago`}
        </span>
        <span className="flex items-center gap-1">
          {s.has_task && <Icon name="ListTodo" size={11} />}
          {s.has_summary && <Icon name="ScrollText" size={11} />}
        </span>
      </div>
    </button>
  );
}
