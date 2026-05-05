"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  sessionDetail,
  queuePrompt,
  clearPendingPrompt,
  DaemonError,
  type PendingPrompt,
} from "@/lib/daemon-client";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";
import { lexPickStable } from "@/lib/lex";

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
  /* Auto-scroll the transcript to the latest turn unless the user has
   * scrolled up to read history. Heuristic: if the scroll position is
   * within AUTOSCROLL_NEAR_BOTTOM_PX of the bottom we treat the user as
   * "following" and keep pinning to the latest on each chunk update.
   * The moment they scroll away we stop following so we don't yank
   * them back mid-read; scrolling back to the bottom resumes follow. */
  const AUTOSCROLL_NEAR_BOTTOM_PX = 80;
  const followLatestRef = useRef(true);

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

  /* Pin to the latest turn when new chunks arrive AND the user is at
   * (or close to) the bottom. Skipped when ?q= is set so the
   * highlighting jump logic above stays in control. Runs on every
   * chunks-array change. */
  useEffect(() => {
    if (trimmedQuery) return;
    const el = transcriptScroll.current;
    if (!el || !followLatestRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [renderedChunks.length, trimmedQuery]);

  /* Initial pin on first data load: nothing to anchor against on the
   * very first render so the effect above doesn't fire until the next
   * refetch. Force one scroll-to-bottom once we have data. */
  useEffect(() => {
    if (trimmedQuery) return;
    if (!q.data?.ok) return;
    const el = transcriptScroll.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // Re-assert follow in case the container grew after layout.
    followLatestRef.current = true;
  }, [q.data?.ok, trimmedQuery]);

  function onTranscriptScroll(e: React.UIEvent<HTMLDivElement>): void {
    const t = e.currentTarget;
    const distance = t.scrollHeight - t.scrollTop - t.clientHeight;
    followLatestRef.current = distance <= AUTOSCROLL_NEAR_BOTTOM_PX;
  }

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
    const notFound =
      q.error instanceof DaemonError && q.error.status === 404;
    return (
      <div className="rounded-panel bg-surface1 hairline p-6 space-y-3">
        <div className="flex items-center gap-2 text-amber-400">
          <Icon name="AlertCircle" size={18} />
          <h3 className="font-display text-md font-emphasized">
            {notFound ? "Session not found" : "Session ended"}
          </h3>
        </div>
        <p className="text-sm text-txt3">
          {notFound ? (
            <>
              No Claude session matching{" "}
              <code className="font-mono text-txt2">{sessionId.slice(0, 12)}</code>{" "}
              exists on this host. The link may be stale or the id may have come
              from a test record.
            </>
          ) : (
            <>
              The Claude session{" "}
              <code className="font-mono text-txt2">{sessionId.slice(0, 8)}</code>{" "}
              is no longer running. Pick a live tile from the rail, or open a new
              session in VS Code on OTLCDEV.
            </>
          )}
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

  // Track DOM order of marks via a sequence counter consumed inside the
  // render loop. Each <mark> is assigned its global index; the callback
  // ref pushes the element into matchRefs at that index.
  let markCursor = 0;

  return (
    <div className="space-y-5">
      {(s.task || s.summary) && (
        <div className="rounded-panel bg-surface1 hairline">
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
      )}

      {s.pending_prompt && (
        <PendingPromptPanel
          sessionId={s.session_id}
          pending={s.pending_prompt}
        />
      )}

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
        {/* Terminal-styled transcript pane. Each turn rendered as a
         * shell-like block:
         *
         *   > ai           (role tag, color-coded)
         *   timestamp      (right-aligned, dim)
         *   ┃ message body (vertical bar + monospace, indented)
         *
         * Roles map to a short label + color so the user reads as a
         * conversation log rather than a JSON dump:
         *   user      -> "you"   (green prompt)
         *   assistant -> "lex"   (brand-soft prompt)
         *   tool      -> "tool"  (cyan)
         *   else      -> first 8 chars of the role (lower-cased)
         */}
        <div
          ref={transcriptScroll}
          onScroll={onTranscriptScroll}
          className="max-h-[60vh] overflow-y-auto bg-[oklch(11%_0_0)] font-mono text-xs"
        >
          {renderedChunks.length === 0 && (
            <div className="px-5 py-4 text-xs text-txt3">
              {lexPickStable("empty_recent_turns", "session-detail")}
            </div>
          )}
          {renderedChunks.map(({ chunk: c, rendered }, i) => {
            const role = (c.role ?? "").toLowerCase();
            const tag =
              role === "assistant" ? "lex"
              : role === "user" ? "you"
              : role === "tool" ? "tool"
              : role.slice(0, 8) || "?";
            const tagColor =
              tag === "lex" ? "text-brandSoft"
              : tag === "you" ? "text-ok"
              : tag === "tool" ? "text-ai"
              : "text-txt3";
            const barColor =
              tag === "lex" ? "bg-brandSoft/40"
              : tag === "you" ? "bg-ok/40"
              : tag === "tool" ? "bg-ai/40"
              : "bg-border1";
            return (
              <div
                key={i}
                className="px-4 py-2 border-b border-border2/40 hover:bg-[oklch(13%_0_0)] transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`${tagColor} font-emphasized`}>
                    <span className="text-txt3">&gt;</span> {tag}
                  </span>
                  {c.timestamp && (
                    <span className="ml-auto text-txt3 text-[11px]">
                      {new Date(c.timestamp).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
                <div className="flex">
                  <span className={`w-0.5 ${barColor} shrink-0 mr-3`} />
                  <pre className="text-txt2 whitespace-pre-wrap break-words flex-1 min-w-0 leading-relaxed">
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
                  </pre>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* Pending permission/elicitation prompt panel.
 *
 * Renders the question text Claude sent over the Notification hook plus
 * answer buttons. We try to auto-detect numbered choices ("1) yes  2) no")
 * and surface them as one-tap buttons; anything else falls back to a free
 * text input. Submit posts the answer through the existing prompt queue
 * (commit:true so the bridge presses Enter), then DELETEs the pending
 * record so the badge clears immediately. */
function PendingPromptPanel(props: {
  sessionId: string;
  pending: PendingPrompt;
}) {
  const { sessionId, pending } = props;
  const qc = useQueryClient();
  const [custom, setCustom] = useState("");

  const choices = useMemo(() => parseNumberedChoices(pending.message), [
    pending.message,
  ]);

  const submit = useMutation({
    mutationFn: async (text: string) => {
      const r = await queuePrompt(sessionId, text);
      if (!r.ok) throw new Error(r.error ?? "queue failed");
      try {
        await clearPendingPrompt(sessionId);
      } catch {
        /* non-fatal: pending will TTL out or get cleared by the next user_prompt hook */
      }
      return r;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["session", sessionId] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      setCustom("");
    },
  });

  const dismiss = useMutation({
    mutationFn: () => clearPendingPrompt(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["session", sessionId] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const ageS = Math.max(0, Math.round((Date.now() - pending.received_at) / 1000));

  return (
    <div className="rounded-panel bg-surface1 ring-1 ring-warn/40">
      <div className="px-5 py-3 border-b border-border1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status="fail" pulse />
          <h2 className="font-display text-sm font-emphasized text-warn">
            Claude is waiting on you
          </h2>
          <span className="text-nano text-txt3 font-mono ml-2">
            {pending.kind} · {ageS}s
          </span>
        </div>
        <button
          type="button"
          onClick={() => dismiss.mutate()}
          disabled={dismiss.isPending}
          className="text-nano text-txt3 hover:text-txt1 px-2 py-1"
          aria-label="Dismiss this question (e.g. answered in CC directly)"
        >
          dismiss
        </button>
      </div>
      <div className="px-5 py-3 border-b border-border2">
        <pre className="text-sm text-txt1 whitespace-pre-wrap break-words font-mono leading-relaxed">
          {pending.message}
        </pre>
      </div>
      <div className="px-5 py-3 space-y-3">
        {choices.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {choices.map((c) => (
              <button
                key={c.digit}
                type="button"
                onClick={() => submit.mutate(c.digit)}
                disabled={submit.isPending}
                className="lift px-3 py-1.5 rounded-pill bg-surface2 hairline text-sm text-txt1 hover:text-brandSoft disabled:opacity-50"
                aria-label={`Answer ${c.digit}: ${c.label}`}
              >
                <span className="font-mono text-brandSoft mr-2">{c.digit}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const text = custom.trim();
            if (!text) return;
            submit.mutate(text);
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={
              choices.length > 0
                ? "or type a custom answer…"
                : "type your answer…"
            }
            className="flex-1 px-3 py-1.5 rounded-card bg-surface2 hairline text-sm text-txt1 placeholder:text-txt3 focus:outline-none focus:ring-1 focus:ring-brand"
            disabled={submit.isPending}
          />
          <button
            type="submit"
            disabled={submit.isPending || !custom.trim()}
            className="lift px-3 py-1.5 rounded-pill bg-brand text-white text-sm disabled:opacity-50"
          >
            {submit.isPending ? "sending…" : "send"}
          </button>
        </form>
        {submit.isError && (
          <div className="text-xs text-fail">
            {(submit.error as Error)?.message ?? "send failed"}
          </div>
        )}
      </div>
    </div>
  );
}

/* Cheap numbered-choice parser. Matches lines like:
 *   "1) yes" / "1. yes" / "1: yes" / "[1] yes"
 * Captures the digit and label. Anything that doesn't match falls back
 * to free-text input below the choice row. */
function parseNumberedChoices(message: string): { digit: string; label: string }[] {
  const lines = message.split(/\r?\n/);
  const re = /^\s*(?:\[?(\d{1,2})\]?[).:\-]\s+|(\d{1,2})\s*[).:\-]\s+)(.+?)\s*$/;
  const out: { digit: string; label: string }[] = [];
  for (const line of lines) {
    const m = re.exec(line);
    if (!m) continue;
    const digit = (m[1] ?? m[2]) || "";
    const label = (m[3] ?? "").trim();
    if (!digit || !label) continue;
    if (out.some((x) => x.digit === digit)) continue;
    out.push({ digit, label });
  }
  return out;
}
