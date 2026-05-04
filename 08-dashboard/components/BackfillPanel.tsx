"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  backfillStatus,
  backfillStart,
  backfillCancel,
  type BackfillRunStatus,
} from "@/lib/daemon-client";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";

/* One-time backfill panel.
 *
 * Walks ~/.claude/projects/<slug>/<session>.jsonl on the host and feeds
 * historical sessions through the same pipelines the live capture uses:
 *
 *   raw  - re-embed every user/assistant turn into store.rawChunks. Cheap.
 *          After completion /search/all returns hits over your full Claude
 *          history.
 *   wiki - per-session ~8KB blobs sent through runIngest, producing
 *          distilled wiki pages. Expensive, runs through ollama.
 *
 * Cursors persisted under DATA_ROOT/.backfill-{raw|wiki}.json so a kill
 * mid-run is resumable. "Reset" toggle clears the cursor before starting -
 * use it when you've corruption-recovered and want a clean rebuild. */

function fmtBytes(bytes: number): string {
  if (!bytes) return "0";
  const u = ["B", "K", "M", "G", "T"];
  const i = Math.min(u.length - 1, Math.floor(Math.log10(bytes) / 3));
  return `${(bytes / 10 ** (i * 3)).toFixed(1)}${u[i]}`;
}

function fmtAge(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

interface RowProps {
  label: string;
  description: string;
  s: BackfillRunStatus;
  onStart: (reset: boolean) => void;
  onCancel: () => void;
  starting: boolean;
}

function Row({ label, description, s, onStart, onCancel, starting }: RowProps) {
  const pct = s.files_total > 0 ? (s.files_done + s.files_skipped) / s.files_total : 0;
  return (
    <div className="p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusDot
              status={
                s.running
                  ? "ai"
                  : s.errors > 0
                    ? "warn"
                    : s.completed_at
                      ? "ok"
                      : "idle"
              }
              pulse={s.running}
            />
            <span className="font-display text-sm font-emphasized text-txt1">
              {label}
            </span>
            <span className="text-[11px] font-mono text-txt3">
              {s.running
                ? "running"
                : s.completed_at
                  ? `done ${fmtAge(s.completed_at)}`
                  : s.started_at
                    ? `stopped ${fmtAge(s.started_at)}`
                    : "never run"}
            </span>
          </div>
          <p className="text-xs text-txt3 mt-1">{description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {s.running ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={s.cancel_requested}
              className="h-8 px-3 rounded-input bg-surface2 hairline text-xs text-txt2 hover:text-txt1 disabled:opacity-40"
            >
              {s.cancel_requested ? "stopping…" : "cancel"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onStart(false)}
                disabled={starting}
                className="h-8 px-3 rounded-input bg-brand/10 hairline ring-1 ring-brand/30 text-brandSoft text-xs font-emphasized hover:bg-brand/15 disabled:opacity-40"
              >
                {starting ? "starting…" : "start"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    confirm(
                      "Reset will clear all per-file cursors and re-process every session from scratch. Continue?",
                    )
                  ) {
                    onStart(true);
                  }
                }}
                disabled={starting}
                className="h-8 px-3 rounded-input text-xs text-txt3 hover:text-txt1 disabled:opacity-40"
                title="Clear cursor and rebuild from scratch"
              >
                reset + start
              </button>
            </>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <div className="h-1.5 rounded-pill bg-surface2 overflow-hidden">
          <div
            className="h-full rounded-pill transition-all duration-base"
            style={{
              width: `${Math.min(100, Math.max(0, pct * 100))}%`,
              background: s.errors > 0 ? "var(--c-warn)" : "var(--c-brand)",
            }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] font-mono text-txt3">
          <span>
            {s.files_done.toLocaleString()} done ·{" "}
            {s.files_skipped.toLocaleString()} skipped · {s.files_total.toLocaleString()} total
          </span>
          <span>
            {s.mode === "raw"
              ? `${s.chunks_or_pages.toLocaleString()} chunks`
              : `${s.chunks_or_pages.toLocaleString()} page actions`}{" "}
            · {fmtBytes(s.bytes_processed)}
          </span>
        </div>
        {s.current_file && (
          <div className="text-nano text-txt3 truncate font-mono" title={s.current_file}>
            current: {s.current_file.split("/").slice(-2).join("/")}
          </div>
        )}
        {s.last_error && (
          <div className="text-[11px] font-mono text-warn truncate" title={s.last_error}>
            last error: {s.last_error}
          </div>
        )}
        {s.verification && (
          <div
            className={`mt-1 rounded-card p-2.5 text-[11px] font-mono space-y-1 ${
              s.verification.ok
                ? "bg-ok/5 border border-ok/30"
                : "bg-err/5 border border-err/30"
            }`}
          >
            <div className="flex items-center gap-2">
              <StatusDot status={s.verification.ok ? "ok" : "fail"} />
              <span className={s.verification.ok ? "text-ok" : "text-err"}>
                {s.verification.ok
                  ? "verification PASSED — embeddings are searchable"
                  : "verification FAILED — embed/store/search loop is broken"}
              </span>
              <span className="text-txt3 ml-auto">
                cosine {s.verification.top_score.toFixed(3)} (≥{" "}
                {s.verification.threshold})
              </span>
            </div>
            <div className="text-txt3 truncate" title={s.verification.query_preview}>
              query: {s.verification.query_preview}
            </div>
            <div className="text-txt3 truncate" title={s.verification.top_hit_preview}>
              top hit: {s.verification.top_hit_preview}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function BackfillPanel() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["backfill-status"],
    queryFn: backfillStatus,
    // Poll faster while running; keep it cheap when idle.
    refetchInterval: (query) => {
      const d = query.state.data;
      if (d && (d.raw.running || d.wiki.running)) return 2_000;
      return 8_000;
    },
  });
  const startM = useMutation({
    mutationFn: ({ mode, reset }: { mode: "raw" | "wiki"; reset: boolean }) =>
      backfillStart(mode, reset),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backfill-status"] }),
  });
  const cancelM = useMutation({
    mutationFn: (mode: "raw" | "wiki") => backfillCancel(mode),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backfill-status"] }),
  });

  return (
    <section className="rounded-panel bg-surface1 hairline">
      <div className="px-5 py-3 border-b border-border1 flex items-center gap-2">
        <Icon name="History" className="text-brandSoft" size={16} />
        <h2 className="font-display text-sm font-emphasized">
          Bootstrap from history
        </h2>
        <span className="text-nano text-txt3 ml-2">
          one-time backfill of ~/.claude/projects
        </span>
      </div>
      <div className="divide-y divide-border2">
        {q.data ? (
          <>
            <Row
              label="Raw chunks"
              description="Re-embed every user + assistant turn from every historical session into the search corpus. Fast (~5ms per turn through the local embedder)."
              s={q.data.raw}
              onStart={(reset) =>
                startM.mutate({ mode: "raw", reset })
              }
              onCancel={() => cancelM.mutate("raw")}
              starting={startM.isPending && startM.variables?.mode === "raw"}
            />
            <Row
              label="Wiki pages"
              description="Per-session blobs through runIngest to distill insight pages. Slow (5-30s per blob through ollama). Run overnight."
              s={q.data.wiki}
              onStart={(reset) =>
                startM.mutate({ mode: "wiki", reset })
              }
              onCancel={() => cancelM.mutate("wiki")}
              starting={startM.isPending && startM.variables?.mode === "wiki"}
            />
          </>
        ) : (
          <div className="p-5 text-xs text-txt3">loading…</div>
        )}
      </div>
    </section>
  );
}
