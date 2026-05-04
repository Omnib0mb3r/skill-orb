"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { wikiPage } from "@/lib/daemon-client";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";

/* Modal for previewing a wiki page from the search results.
 * The wiki has no dedicated detail route yet; this overlay lets the
 * user read the full Pattern + Evidence + Cross-refs without leaving
 * the search context. Esc / click outside / ✕ closes. */

interface Props {
  id: string;
  onClose: () => void;
}

export function WikiPageModal({ id, onClose }: Props) {
  const q = useQuery({
    queryKey: ["wiki-page", id],
    queryFn: () => wikiPage(id),
    retry: false,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-start pt-16 px-6"
      style={{ background: "var(--c-bg-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[80vh] overflow-y-auto rounded-panel bg-surface1 hairline"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border1 flex items-center justify-between gap-3 sticky top-0 bg-surface1 z-10">
          <div className="flex items-center gap-2 min-w-0">
            <Icon name="BookOpen" className="text-brandSoft" size={16} />
            <h2 className="font-display text-sm font-emphasized truncate">
              {q.data?.page?.title ?? id}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-txt3 hover:text-txt1"
          >
            <Icon name="X" size={18} />
          </button>
        </div>

        {q.isLoading && (
          <div className="p-6 text-xs text-txt3">loading page…</div>
        )}
        {q.isError && (
          <div className="p-6 text-xs text-err">
            Failed to load: {(q.error as Error).message}
          </div>
        )}
        {q.data && !q.data.ok && (
          <div className="p-6 text-xs text-err">{q.data.error}</div>
        )}
        {q.data?.ok && q.data.page && (
          <article className="p-6 space-y-5 text-sm">
            <div className="flex items-center gap-3 text-[11px] font-mono text-txt3">
              <span className="inline-flex items-center gap-1.5">
                <StatusDot
                  status={
                    q.data.page.status === "canonical"
                      ? "ok"
                      : q.data.page.status === "pending"
                        ? "ai"
                        : "idle"
                  }
                />
                {q.data.page.status}
              </span>
              <span>weight {q.data.page.weight.toFixed(2)}</span>
              <span>hits {q.data.page.hits}</span>
              <span>corrections {q.data.page.corrections}</span>
              <span>· last touched {q.data.page.last_touched}</span>
            </div>
            {q.data.page.summary && (
              <section>
                <div className="text-nano text-txt3 uppercase tracking-wider mb-1">
                  Summary
                </div>
                <p className="text-txt2 whitespace-pre-wrap">
                  {q.data.page.summary}
                </p>
              </section>
            )}
            {q.data.page.pattern && (
              <section>
                <div className="text-nano text-txt3 uppercase tracking-wider mb-1">
                  Pattern
                </div>
                <p className="text-txt2 whitespace-pre-wrap font-mono text-xs">
                  {q.data.page.pattern}
                </p>
              </section>
            )}
            {q.data.page.evidence?.length > 0 && (
              <section>
                <div className="text-nano text-txt3 uppercase tracking-wider mb-1">
                  Evidence
                </div>
                <ul className="text-txt2 text-xs space-y-1 list-disc pl-5">
                  {q.data.page.evidence.map((e, i) => (
                    <li key={i} className="font-mono">{e}</li>
                  ))}
                </ul>
              </section>
            )}
            {q.data.page.cross_refs?.length > 0 && (
              <section>
                <div className="text-nano text-txt3 uppercase tracking-wider mb-1">
                  Cross-references
                </div>
                <ul className="text-txt2 text-xs space-y-1 list-disc pl-5">
                  {q.data.page.cross_refs.map((c) => (
                    <li key={c} className="font-mono">{c}</li>
                  ))}
                </ul>
              </section>
            )}
            {q.data.page.log?.length > 0 && (
              <section>
                <div className="text-nano text-txt3 uppercase tracking-wider mb-1">
                  Log
                </div>
                <ul className="text-txt3 text-[11px] space-y-0.5 font-mono">
                  {q.data.page.log.slice(-10).map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </section>
            )}
            <div className="text-nano text-txt3 font-mono">
              id: {q.data.page.id}
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
