"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { logTail } from "@/lib/daemon-client";
import { Icon } from "./Icon";
import { lexPickStable } from "@/lib/lex";

/* Daemon log tail panel.
 *
 * Polls /dashboard/log-tail every 4s, renders the last N lines newest-last.
 * Filter input trims by case-insensitive substring on the daemon side so
 * the response stays small. Auto-scrolls to the bottom when new lines
 * arrive unless the user has scrolled up (then we leave them where they
 * are; common terminal-tail behavior). */

function highlightLevel(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("fatal:") || lower.includes(" error")) return "text-err";
  if (lower.includes("warn") || lower.includes("warning")) return "text-warn";
  if (lower.includes("[lint-queue]") || lower.includes("ingest ")) return "text-brandSoft";
  return "text-txt2";
}

export function LogTail() {
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const q = useQuery({
    queryKey: ["log-tail", filter],
    queryFn: () => logTail(200, filter),
    refetchInterval: paused ? false : 4_000,
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [q.data?.lines.length]);

  function onScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    stickToBottomRef.current = nearBottom;
  }

  const lines = q.data?.lines ?? [];

  return (
    <section className="rounded-panel bg-surface1 hairline">
      <div className="px-5 py-3 border-b border-border1 flex items-center gap-2">
        <Icon name="ScrollText" className="text-brandSoft" size={16} />
        <h2 className="font-display text-sm font-emphasized">Daemon log</h2>
        <input
          type="search"
          aria-label="Filter daemon log"
          placeholder="filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="ml-3 h-7 px-2 rounded-input bg-surface2 hairline text-xs font-mono outline-none focus:ring-1 focus:ring-brand/60 placeholder:text-txt3 w-40"
        />
        <button
          onClick={() => setPaused((p) => !p)}
          className="text-nano text-txt3 hover:text-txt1 ml-auto"
          aria-pressed={paused}
        >
          {paused ? "▶ resume" : "⏸ pause"}
        </button>
        <span className="text-nano text-txt3 ml-2">
          {lines.length} lines
          {q.data?.truncated && <span className="ml-1">(tail)</span>}
        </span>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="max-h-80 overflow-y-auto font-mono text-[11px] leading-relaxed px-5 py-3"
      >
        {q.isLoading && (
          <div className="text-txt3">{lexPickStable("loading_log", "log-tail")}</div>
        )}
        {!q.isLoading && lines.length === 0 && (
          <div className="text-txt3">
            {filter
              ? `No log lines matching "${filter}". Different keyword maybe.`
              : lexPickStable("empty_logs", "log-tail")}
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className={`${highlightLevel(l)} whitespace-pre-wrap break-all`}>
            {l}
          </div>
        ))}
      </div>
    </section>
  );
}
