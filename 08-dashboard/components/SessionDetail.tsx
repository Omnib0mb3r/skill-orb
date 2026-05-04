"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sessionDetail } from "@/lib/daemon-client";
import { projectFromSlug, relTime } from "@/lib/session-helpers";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";

/* SessionDetail with optional in-transcript highlight + jump.
 *
 * When the user opens a session via the Wiki search rail, the URL
 * carries ?q=<term>. This component:
 *   - Wraps every case-insensitive occurrence of the term in <mark>.
 *   - Builds a refs array of those marks in DOM order.
 *   - Exposes a "match N of M" pill with ⟨ prev / next ⟩ buttons that
 *     scrollIntoView the active mark and ring-highlights it.
 *   - Manual scroll still works; the transcript pane is scrollable
 *     independently. Activating prev/next just nudges the active hit
 *     into view without trapping the user.
 *
 * Rendering: each chunk's text is split on the case-insensitive query
 * via String.split with a capturing group, so the alternating array is
 * [non-match, match, non-match, match, ...]. */

interface Props {
  sessionId: string;
  query?: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface RenderedTurn {
  parts: { text: string; isMatch: boolean }[];
  matchCount: number;
}

function renderTurn(text: string, q: string): RenderedTurn {
  if (!q) return { parts: [{ text, isMatch: false }], matchCount: 0 };
  const re = new RegExp(escapeRegex(q), "gi");
  const parts: { text: string; isMatch: boolean }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push({ text: text.slice(last, m.index), isMatch: false });
    }
    parts.push({ text: m[0], isMatch: true });
    count += 1;
    last = m.index + m[0].length;
    // Avoid zero-length match infinite loop.
    if (m[0].length === 0) re.lastIndex += 1;
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last), isMatch: false });
  }
  return { parts, matchCount: count };
}

export function SessionDetail({ sessionId, query }: Props) {
  const trimmedQueryEarly = (query ?? "").trim();
  const q = useQuery({
    queryKey: ["session", sessionId, trimmedQueryEarly],
    queryFn: () => sessionDetail(sessionId, trimmedQueryEarly || undefined),
    refetchInterval: 5_000,
    retry: false,
  });

  const trimmedQuery = trimmedQueryEarly;
  const transcriptScroll = useRef<HTMLDivElement | null>(null);
  const matchRefs = useRef<HTMLSpanElement[]>([]);
  const [activeMatch, setActiveMatch] = useState(0);

  // Reset matchRefs every render; fill in via callback ref on each <mark>.
  matchRefs.current = [];

  // Compute total matches from the rendered chunks once data is in.
  const chunks = q.data?.ok ? q.data.session.recent_chunks : [];
  const renderedChunks = useMemo(
    () =>
      (chunks ?? []).map((c) => ({
        chunk: c,
        rendered: renderTurn(c.text, trimmedQuery),
      })),
    [chunks, trimmedQuery],
  );
  const totalMatches = renderedChunks.reduce(
    (s, r) => s + r.rendered.matchCount,
    0,
  );

  // Reset / clamp activeMatch when query or total changes.
  useEffect(() => {
    if (totalMatches === 0) {
      setActiveMatch(0);
      return;
    }
    setActiveMatch((prev) => Math.min(prev, totalMatches - 1));
  }, [totalMatches, trimmedQuery]);

  // Scroll the active mark into view whenever it changes.
  useEffect(() => {
    if (totalMatches === 0) return;
    const el = matchRefs.current[activeMatch];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeMatch, totalMatches, trimmedQuery, q.dataUpdatedAt]);

  // Auto-jump to first match on initial load when ?q= is set.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (totalMatches > 0) {
      setActiveMatch(0);
      seededRef.current = true;
    }
  }, [totalMatches]);

  function step(delta: number): void {
    if (totalMatches === 0) return;
    setActiveMatch((p) => (p + delta + totalMatches) % totalMatches);
  }

  if (q.isLoading) {
    return (
      <div className="rounded-panel bg-surface1 hairline p-6 space-y-3">
        <div className="h-5 w-1/3 rounded bg-surface2 animate-pulse" />
        <div className="h-3 w-2/3 rounded bg-surface2 animate-pulse" />
        <div className="h-3 w-1/2 rounded bg-surface2 animate-pulse" />
      </div>
    );
  }
  if (q.isError || !q.data?.ok) {
    return (
      <div className="rounded-panel bg-surface1 hairline p-6 space-y-3">
        <div className="flex items-center gap-2 text-amber-400">
          <Icon name="AlertCircle" size={18} />
          <h3 className="font-display text-md font-emphasized">Session ended</h3>
        </div>
        <p className="text-sm text-txt3">
          The Claude session{" "}
          <code className="font-mono text-txt2">{sessionId.slice(0, 8)}</code>{" "}
          is no longer running. Pick a live tile from the rail, or open a new
          session in VS Code on OTLCDEV.
        </p>
        <Link
          href="/sessions"
          className="inline-flex items-center gap-1.5 text-xs text-brandSoft hover:underline"
        >
          <Icon name="ArrowLeft" size={14} /> See all sessions
        </Link>
      </div>
    );
  }

  const s = q.data.session;
  const project = projectFromSlug(s.project_slug);

  // Track DOM order of marks via a sequence counter consumed inside the
  // render loop. Each <mark> is assigned its global index; the callback
  // ref pushes the element into matchRefs at that index.
  let markCursor = 0;

  return (
    <div className="space-y-5">
      <div className="rounded-panel bg-surface1 hairline">
        <div className="px-5 py-3 border-b border-border1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="Terminal" className="text-brandSoft" size={16} />
            <h2 className="font-display text-sm font-emphasized">{project}</h2>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-txt3 ml-2">
              <StatusDot status={s.active ? "live" : "idle"} pulse={s.active} />
              {s.active ? "active" : "idle"}
            </span>
          </div>
          <div className="text-nano text-txt3 truncate max-w-md font-mono">
            {s.session_id.slice(0, 12)} · {relTime(s.last_modified_ms)} ago
          </div>
        </div>
        {s.task && (
          <div className="px-5 py-3 border-b border-border2">
            <div className="text-nano text-txt3 mb-1">Current task</div>
            <div className="text-sm text-txt1 whitespace-pre-wrap">{s.task}</div>
          </div>
        )}
        {s.summary && (
          <div className="px-5 py-3">
            <div className="text-nano text-txt3 mb-1">Rolling summary</div>
            <div className="text-sm text-txt2 whitespace-pre-wrap line-clamp-6">
              {s.summary}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-panel bg-surface1 hairline">
        <div className="px-5 py-3 border-b border-border1 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Icon name="ScrollText" className="text-brandSoft" size={16} />
            <h2 className="font-display text-sm font-emphasized">Recent transcript</h2>
            {trimmedQuery && (
              <span
                className="text-nano text-brandSoft font-mono px-2 py-0.5 rounded-pill bg-brand/10 ring-1 ring-brand/30 truncate max-w-[20ch]"
                title={`Highlighting "${trimmedQuery}"`}
              >
                &quot;{trimmedQuery}&quot;
              </span>
            )}
          </div>
          {trimmedQuery && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-nano text-txt3 font-mono">
                {totalMatches > 0
                  ? `${activeMatch + 1} / ${totalMatches}`
                  : "no matches"}
              </span>
              <button
                type="button"
                onClick={() => step(-1)}
                disabled={totalMatches === 0}
                aria-label="Previous match"
                className="w-7 h-7 rounded-card hairline grid place-items-center text-txt2 hover:text-txt1 disabled:opacity-40"
              >
                <Icon name="ChevronUp" size={14} />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                disabled={totalMatches === 0}
                aria-label="Next match"
                className="w-7 h-7 rounded-card hairline grid place-items-center text-txt2 hover:text-txt1 disabled:opacity-40"
              >
                <Icon name="ChevronDown" size={14} />
              </button>
            </div>
          )}
          {!trimmedQuery && (
            <span className="text-nano text-txt3">{chunks?.length ?? 0} turns</span>
          )}
        </div>
        <div
          ref={transcriptScroll}
          className="max-h-[60vh] overflow-y-auto divide-y divide-border2"
        >
          {renderedChunks.length === 0 && (
            <div className="px-5 py-4 text-xs text-txt3">No recent turns captured.</div>
          )}
          {renderedChunks.map(({ chunk: c, rendered }, i) => (
            <div key={i} className="px-5 py-3 flex gap-3">
              <span className="text-nano text-txt3 shrink-0 w-12 mt-0.5">
                {c.role.slice(0, 8)}
              </span>
              <div className="text-xs text-txt2 font-mono whitespace-pre-wrap flex-1 min-w-0 break-words">
                {rendered.parts.map((p, j) => {
                  if (!p.isMatch) {
                    return <span key={j}>{p.text}</span>;
                  }
                  const myIndex = markCursor;
                  markCursor += 1;
                  const isActive = myIndex === activeMatch;
                  return (
                    <mark
                      key={j}
                      ref={(el) => {
                        if (el) matchRefs.current[myIndex] = el;
                      }}
                      className={
                        isActive
                          ? "bg-[oklch(75%_0.18_85)] text-black rounded-sm px-0.5 ring-2 ring-brand"
                          : "bg-[oklch(85%_0.13_95)] text-black rounded-sm px-0.5"
                      }
                    >
                      {p.text}
                    </mark>
                  );
                })}
              </div>
              {c.timestamp && (
                <span className="text-nano text-txt3 shrink-0 mt-0.5">
                  {new Date(c.timestamp).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
