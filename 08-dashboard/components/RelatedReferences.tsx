"use client";

import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { searchAll, type SearchHit } from "@/lib/daemon-client";
import { Icon } from "./Icon";

/* Sidebar that surfaces reference docs related to the currently-open
 * session, keyed by the same search term that brought the user here.
 *
 * Uses the existing /search/all endpoint with collections filtered to
 * reference_chunk only, so it shares the brain's vector index instead
 * of building a parallel ranker. Fetched on demand when query changes;
 * idle when no query. */

interface Props {
  query: string;
}

function refTitle(r: SearchHit): string {
  const meta = r.metadata ?? {};
  if (typeof r.title === "string" && r.title) return r.title;
  if (typeof meta.filename === "string" && meta.filename) return meta.filename;
  if (typeof meta.doc_id === "string" && meta.doc_id) return meta.doc_id;
  return "reference";
}

function refPreview(r: SearchHit): string {
  const meta = r.metadata ?? {};
  if (typeof r.preview === "string" && r.preview) return r.preview;
  if (typeof meta.text_preview === "string") return meta.text_preview;
  return "";
}

export function RelatedReferences({ query }: Props) {
  const m = useMutation({
    mutationFn: (q: string) =>
      searchAll(q, { collections: ["reference_chunk"], top_k: 8 }),
  });

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    m.mutate(trimmed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  if (!query.trim()) return null;

  const hits = m.data?.results ?? [];

  return (
    <section className="rounded-panel bg-surface1 hairline">
      <div className="px-5 py-3 border-b border-border1 flex items-center gap-2">
        <Icon name="Library" className="text-brandSoft" size={16} />
        <h2 className="font-display text-sm font-emphasized">
          Related reference
        </h2>
        <span className="text-nano text-txt3 ml-auto font-mono">
          {m.isPending ? "searching…" : `${hits.length} hits`}
        </span>
      </div>
      <ul className="divide-y divide-border2 max-h-[60vh] overflow-y-auto">
        {!m.isPending && hits.length === 0 && (
          <li className="px-5 py-4 text-xs text-txt3">
            No reference docs match this search yet. Drop PDFs / images / audio
            into the Wiki tab to build the corpus.
          </li>
        )}
        {hits.map((h, i) => (
          <li key={i} className="px-5 py-3">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="FileText" size={12} className="text-brandSoft" />
              <span className="text-xs font-emphasized text-txt1 truncate">
                {refTitle(h)}
              </span>
              <span className="ml-auto text-nano text-txt3 font-mono">
                {h.score.toFixed(2)}
              </span>
            </div>
            <p className="text-[11px] text-txt2 line-clamp-3 font-mono whitespace-pre-wrap">
              {refPreview(h)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
