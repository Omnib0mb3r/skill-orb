"use client";

import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { searchAll, type SearchHit } from "@/lib/daemon-client";
import { Icon } from "./Icon";

const COLLECTIONS = [
  { id: "wiki_page", label: "Wiki" },
  { id: "raw_chunk", label: "Transcripts" },
  { id: "reference_chunk", label: "Reference" },
] as const;

type CollectionId = (typeof COLLECTIONS)[number]["id"];

const SOURCE_LABELS: Record<SearchHit["source"], string> = {
  wiki_page: "wiki",
  raw_chunk: "transcript",
  reference_chunk: "reference",
};

const SOURCE_COLORS: Record<SearchHit["source"], string> = {
  wiki_page: "var(--c-accent)",
  raw_chunk: "var(--c-ai)",
  reference_chunk: "var(--c-promoted)",
};

/* Pull the most useful preview string out of a hit. raw_chunks store
 * `text_preview` on the metadata record; wiki_pages and reference_chunks
 * use the top-level preview the daemon returns. Falls back to title. */
function hitPreview(r: SearchHit): string {
  const meta = r.metadata ?? {};
  const candidates: string[] = [
    typeof r.preview === "string" ? r.preview : "",
    typeof meta.text_preview === "string" ? meta.text_preview : "",
    typeof meta.summary === "string" ? meta.summary : "",
    typeof r.title === "string" ? r.title : "",
  ];
  return candidates.find((c) => c.trim().length > 0) ?? "";
}

/* Resolve where clicking a hit should send the user. Transcript hits
 * deep-link to /sessions/detail with a query param so the session view
 * can highlight + jump between matches. Wiki and reference hits stay
 * inline on /wiki for now. */
function hitTarget(r: SearchHit, query: string): string | null {
  if (r.source === "raw_chunk") {
    const meta = r.metadata ?? {};
    const sid = typeof meta.session_id === "string" ? meta.session_id : null;
    if (!sid) return null;
    const params = new URLSearchParams({ id: sid, q: query });
    if (r.id) params.set("hit", r.id);
    return `/sessions/detail?${params.toString()}`;
  }
  return null;
}

export function WikiSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Set<CollectionId>>(
    new Set(COLLECTIONS.map((c) => c.id)),
  );

  const m = useMutation({
    mutationFn: (query: string) =>
      searchAll(query, { collections: Array.from(filters), top_k: 20 }),
  });

  // debounce search input
  useEffect(() => {
    if (!q.trim()) return;
    const t = setTimeout(() => {
      m.mutate(q.trim());
    }, 320);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filters]);

  const results = m.data?.results ?? [];

  function toggleFilter(id: CollectionId) {
    setFilters((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next.size === 0 ? new Set([id]) : next;
    });
  }

  function openHit(r: SearchHit): void {
    const target = hitTarget(r, q.trim());
    if (target) router.push(target);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-panel bg-surface1 hairline p-4">
        <div className="flex items-center gap-2.5 h-11 px-3 rounded-card bg-surface2 hairline focus-within:ring-1 focus-within:ring-brand/60 transition">
          <Icon name="Search" className="text-txt3" size={18} />
          <label htmlFor="wiki-search" className="sr-only">
            Search across wiki, transcripts, reference docs
          </label>
          <input
            id="wiki-search"
            name="wiki-search"
            type="search"
            autoFocus
            placeholder="Search wiki pages, transcripts, and reference docs..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="bg-transparent flex-1 text-base outline-none text-txt1 placeholder:text-txt3"
          />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className="text-nano text-txt3">Collections:</span>
          {COLLECTIONS.map((c) => {
            const on = filters.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleFilter(c.id)}
                className={`text-xs font-mono px-2.5 h-6 rounded-pill hairline transition ${
                  on
                    ? "bg-brand/15 text-brandSoft ring-1 ring-brand/30"
                    : "text-txt3 hover:text-txt1"
                }`}
                aria-pressed={on}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {m.isPending && q && (
        <div className="text-nano text-txt3 px-2">searching…</div>
      )}

      {!m.isPending && q && results.length === 0 && (
        <div className="rounded-panel bg-surface1 hairline p-8 text-center text-txt3 text-sm">
          No results for &quot;{q}&quot; across selected collections.
        </div>
      )}

      <ul className="space-y-2">
        {results.map((r, i) => {
          const target = hitTarget(r, q.trim());
          const preview = hitPreview(r);
          const clickable = target != null;
          const handle = clickable ? () => openHit(r) : undefined;
          return (
            <li
              key={i}
              onClick={handle}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openHit(r);
                      }
                    }
                  : undefined
              }
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              className={`rounded-card bg-surface1 hairline lift p-4 ${
                clickable ? "cursor-pointer hover:ring-1 hover:ring-brand/40" : ""
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="text-nano px-1.5 py-0.5 rounded-pill"
                  style={{ background: `${SOURCE_COLORS[r.source]}20`, color: SOURCE_COLORS[r.source] }}
                >
                  {SOURCE_LABELS[r.source]}
                </span>
                {r.title && (
                  <span className="font-emphasized text-sm text-txt1 truncate">
                    {r.title}
                  </span>
                )}
                {clickable && (
                  <span className="text-nano text-txt3 ml-1">
                    open session →
                  </span>
                )}
                <span className="ml-auto text-nano text-txt3">
                  score {r.score.toFixed(2)}
                </span>
              </div>
              {preview && (
                <p className="text-xs text-txt2 line-clamp-3 font-mono whitespace-pre-wrap">
                  {preview}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
