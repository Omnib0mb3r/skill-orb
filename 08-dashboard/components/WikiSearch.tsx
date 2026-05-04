"use client";

import { useState, useEffect } from "react";
import { useQueries } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { searchAll, type SearchHit } from "@/lib/daemon-client";
import { Icon } from "./Icon";
import { WikiPageModal } from "./WikiPageModal";

/* Wiki / Transcripts / Reference are paginated as separate sections.
 * Earlier the server-merged result list crowded out the lower-scoring
 * collections (e.g. wiki insights vs proper-name transcript hits) and
 * the user couldn't see anything but transcripts. Each section now
 * does its own /search/all call with collections=[<one>], paged
 * independently. Wiki hits open a modal preview; transcript hits
 * deep-link to the session detail with highlight + jump. */

const COLLECTIONS = [
  { id: "wiki_page",       label: "Wiki",       short: "wiki" },
  { id: "raw_chunk",       label: "Transcripts", short: "transcript" },
  { id: "reference_chunk", label: "Reference",  short: "reference" },
] as const;

type CollectionId = (typeof COLLECTIONS)[number]["id"];

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

const SOURCE_COLORS: Record<SearchHit["source"], string> = {
  wiki_page: "var(--c-accent)",
  raw_chunk: "var(--c-ai)",
  reference_chunk: "var(--c-promoted)",
};

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

function transcriptTarget(r: SearchHit, query: string): string | null {
  if (r.source !== "raw_chunk") return null;
  const meta = r.metadata ?? {};
  const sid = typeof meta.session_id === "string" ? meta.session_id : null;
  if (!sid) return null;
  const params = new URLSearchParams({ id: sid, q: query });
  if (r.id) params.set("hit", r.id);
  return `/sessions/detail?${params.toString()}`;
}

function wikiPageId(r: SearchHit): string | null {
  if (r.source !== "wiki_page") return null;
  const meta = r.metadata ?? {};
  if (typeof r.id === "string" && r.id) return r.id;
  if (typeof meta.id === "string") return meta.id;
  return null;
}

export function WikiSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<Set<CollectionId>>(
    new Set(COLLECTIONS.map((c) => c.id)),
  );
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10);
  const [pages, setPages] = useState<Record<CollectionId, number>>({
    wiki_page: 1,
    raw_chunk: 1,
    reference_chunk: 1,
  });
  const [openWikiId, setOpenWikiId] = useState<string | null>(null);

  // Debounce search input + reset pagination on query change.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q.trim());
      setPages({ wiki_page: 1, raw_chunk: 1, reference_chunk: 1 });
    }, 320);
    return () => clearTimeout(t);
  }, [q]);

  // One query per enabled collection; each can paginate independently.
  const queries = useQueries({
    queries: COLLECTIONS.map((c) => ({
      queryKey: ["search", c.id, debounced, pages[c.id], pageSize, filters.has(c.id)],
      queryFn: () =>
        searchAll(debounced, {
          collections: [c.id],
          limit: pageSize,
          offset: (pages[c.id] - 1) * pageSize,
        }),
      enabled: debounced.length > 0 && filters.has(c.id),
      staleTime: 30_000,
    })),
  });

  function toggleFilter(id: CollectionId) {
    setFilters((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next.size === 0 ? new Set([id]) : next;
    });
  }

  function setPage(id: CollectionId, p: number): void {
    setPages((prev) => ({ ...prev, [id]: Math.max(1, p) }));
  }

  function openHit(r: SearchHit): void {
    const tx = transcriptTarget(r, debounced);
    if (tx) {
      router.push(tx);
      return;
    }
    const wid = wikiPageId(r);
    if (wid) {
      setOpenWikiId(wid);
      return;
    }
    // reference_chunk has no detail view yet; no-op.
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

        <div className="mt-3 flex items-center gap-3 flex-wrap">
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
          <span className="text-nano text-txt3 ml-auto">Per page:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number]);
              setPages({ wiki_page: 1, raw_chunk: 1, reference_chunk: 1 });
            }}
            className="text-xs font-mono bg-surface2 hairline rounded-pill px-2 h-6 text-txt2"
            aria-label="Results per page"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!debounced && (
        <div className="rounded-panel bg-surface1 hairline p-8 text-center text-txt3 text-sm">
          Type a query above. Each enabled collection runs its own search and paginates separately.
        </div>
      )}

      {COLLECTIONS.map((c, i) => {
        if (!filters.has(c.id) || !debounced) return null;
        const query = queries[i];
        if (!query) return null;
        const data = query.data;
        const total = data?.total ?? 0;
        const hits = data?.results ?? [];
        const pageNum = pages[c.id];
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        return (
          <section key={c.id} className="rounded-panel bg-surface1 hairline">
            <div className="px-5 py-3 border-b border-border1 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="text-nano px-2 py-0.5 rounded-pill"
                  style={{
                    background: `${SOURCE_COLORS[c.id]}20`,
                    color: SOURCE_COLORS[c.id],
                  }}
                >
                  {c.label}
                </span>
                <span className="text-nano text-txt3 font-mono">
                  {query.isPending
                    ? "searching…"
                    : total === 0
                      ? "0 results"
                      : `${(pageNum - 1) * pageSize + 1}–${Math.min(pageNum * pageSize, total)} of ${total.toLocaleString()}`}
                </span>
              </div>
              {total > pageSize && (
                <Pager
                  page={pageNum}
                  totalPages={totalPages}
                  onChange={(p) => setPage(c.id, p)}
                />
              )}
            </div>

            {!query.isPending && hits.length === 0 && (
              <div className="px-5 py-6 text-xs text-txt3">
                No {c.short} results for &quot;{debounced}&quot;.
              </div>
            )}

            <ul className="divide-y divide-border2">
              {hits.map((r, j) => {
                const preview = hitPreview(r);
                const tx = transcriptTarget(r, debounced);
                const wid = wikiPageId(r);
                const clickable = tx != null || wid != null;
                const cta =
                  tx != null
                    ? "open session →"
                    : wid != null
                      ? "preview page →"
                      : null;
                return (
                  <li
                    key={j}
                    onClick={clickable ? () => openHit(r) : undefined}
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
                    className={`px-5 py-3 ${
                      clickable
                        ? "cursor-pointer hover:bg-surface2/40"
                        : ""
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {r.title && (
                        <span className="font-emphasized text-sm text-txt1 truncate">
                          {r.title}
                        </span>
                      )}
                      {cta && (
                        <span className="text-nano text-brandSoft">{cta}</span>
                      )}
                      <span className="ml-auto text-nano text-txt3 font-mono">
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

            {total > pageSize && (
              <div className="px-5 py-3 border-t border-border2 flex items-center justify-between text-nano text-txt3">
                <span>
                  Showing page {pageNum} of {totalPages}
                </span>
                <Pager
                  page={pageNum}
                  totalPages={totalPages}
                  onChange={(p) => setPage(c.id, p)}
                />
              </div>
            )}
          </section>
        );
      })}

      {openWikiId && (
        <WikiPageModal id={openWikiId} onClose={() => setOpenWikiId(null)} />
      )}
    </div>
  );
}

/* Compact pager. ⟨ ⟩ for prev / next, numeric buttons with elision
 * (…) for graphs with > 7 pages. Disabled at boundaries. */
function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  const pages = pageRange(page, totalPages);
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="w-7 h-7 rounded-pill hairline grid place-items-center text-txt2 hover:text-txt1 disabled:opacity-40"
        aria-label="Previous page"
      >
        <Icon name="ChevronLeft" size={14} />
      </button>
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`g-${i}`} className="text-nano text-txt3 px-1">…</span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            disabled={p === page}
            className={`min-w-[1.75rem] h-7 px-1.5 rounded-pill text-xs font-mono transition ${
              p === page
                ? "bg-brand text-base ring-1 ring-brand"
                : "hairline text-txt2 hover:text-txt1"
            }`}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="w-7 h-7 rounded-pill hairline grid place-items-center text-txt2 hover:text-txt1 disabled:opacity-40"
        aria-label="Next page"
      >
        <Icon name="ChevronRight" size={14} />
      </button>
    </div>
  );
}

function pageRange(page: number, total: number): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const out: (number | "...")[] = [1];
  const lo = Math.max(2, page - 1);
  const hi = Math.min(total - 1, page + 1);
  if (lo > 2) out.push("...");
  for (let p = lo; p <= hi; p++) out.push(p);
  if (hi < total - 1) out.push("...");
  out.push(total);
  return out;
}
