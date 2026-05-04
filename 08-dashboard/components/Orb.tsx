"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { graph as fetchGraph, type GraphNode, type GraphEdge } from "@/lib/daemon-client";

/* react-force-graph-2d touches `window` at module load via its `force-graph`
 * dep (uses canvas + d3-force). Dynamic import with ssr:false is the only
 * way to keep `next build` (static export) from blowing up. */
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => <OrbSkeleton />,
});

/* Canvas color literals.
 * The canvas API does not read CSS custom properties, so the orb cannot use
 * var(--c-accent) directly. These oklch() literals are exact mirrors of the
 * tokens in app/globals.css. If a token shifts, update the matching constant
 * here so the orb keeps reading from the same visual language. */
const COLOR_ACCENT     = "oklch(64% 0.20 295)";
const COLOR_AI         = "oklch(72% 0.13 270)";
const COLOR_DISABLED   = "oklch(46% 0.011 263)";
const COLOR_PROMOTED   = "oklch(82% 0.15 80)";
const COLOR_EDGE       = "oklch(96% 0.005 250 / 0.08)";
const COLOR_EDGE_HOVER = "oklch(96% 0.005 250 / 0.28)";
const COLOR_LABEL      = "oklch(85% 0.012 250)";

interface ForceNode extends GraphNode {
  x?: number;
  y?: number;
}

interface ForceLink {
  source: string | ForceNode;
  target: string | ForceNode;
  kind?: GraphEdge["kind"];
}

function statusColor(status: GraphNode["status"]): string {
  switch (status) {
    case "canonical": return COLOR_ACCENT;
    case "pending":   return COLOR_AI;
    case "archived":  return COLOR_DISABLED;
  }
}

function isRecentlyPromoted(node: GraphNode): boolean {
  if (!node.promoted_at) return false;
  const ms = Date.now() - new Date(node.promoted_at).getTime();
  return ms >= 0 && ms <= 24 * 60 * 60 * 1000;
}

function nodeRadius(weight: number): number {
  return 2.5 + Math.max(0, Math.min(1, weight)) * 6;
}

export function Orb() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [hovered, setHovered] = useState<ForceNode | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const q = useQuery({
    queryKey: ["graph"],
    queryFn: fetchGraph,
    refetchInterval: 30_000,
  });

  const graphData = useMemo(() => {
    const nodes: ForceNode[] = (q.data?.nodes ?? []).map((n) => ({ ...n }));
    const links: ForceLink[] = (q.data?.edges ?? []).map((e) => ({
      source: e.source,
      target: e.target,
      ...(e.kind ? { kind: e.kind } : {}),
    }));
    return { nodes, links };
  }, [q.data]);

  const onNodeClick = useCallback(
    (n: ForceNode) => {
      if (!n.id) return;
      router.push(`/wiki?page=${encodeURIComponent(String(n.id))}`);
    },
    [router],
  );

  const onNodeHover = useCallback((n: ForceNode | null) => {
    setHovered(n ?? null);
  }, []);

  const drawNode = useCallback(
    (raw: ForceNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = raw.x ?? 0;
      const y = raw.y ?? 0;
      const r = nodeRadius(raw.weight);

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2, false);
      ctx.fillStyle = statusColor(raw.status);
      ctx.fill();

      if (isRecentlyPromoted(raw)) {
        ctx.beginPath();
        ctx.arc(x, y, r + 2.5, 0, Math.PI * 2, false);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = COLOR_PROMOTED;
        ctx.stroke();
      }

      // Labels appear once the user has zoomed in enough that they don't
      // overlap. globalScale is the d3-zoom k factor; threshold tuned by eye.
      if (globalScale >= 1.6) {
        const fontSize = Math.max(8, 10 / globalScale * 1.2);
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = COLOR_LABEL;
        const label = raw.title.length > 60 ? raw.title.slice(0, 57) + "..." : raw.title;
        ctx.fillText(label, x, y + r + 2);
      }
    },
    [],
  );

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPointer({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  if (q.isLoading) return <OrbSkeleton />;
  if (q.isError) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="rounded-panel bg-surface1 hairline px-6 py-5 text-sm text-txt3">
          Failed to load graph. The daemon may be offline.
        </div>
      </div>
    );
  }

  const isEmpty = (q.data?.nodes.length ?? 0) === 0;
  if (isEmpty) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="rounded-panel bg-surface1 hairline px-8 py-7 max-w-md text-center">
          <div className="font-display text-xl font-emphasized mb-2">No wiki pages yet</div>
          <p className="text-txt3 text-sm">
            The orb visualizes your wiki as a graph. Pages appear here as the daemon
            ingests transcripts and writes transferable insights.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      onMouseMove={onMouseMove}
    >
      {size.w > 0 && size.h > 0 && (
        // The lib's NodeType generic is loose (`{ id?, x?, y? }`) so the
        // accessor callbacks would not type-check against our richer
        // ForceNode. Casts are localized to this prop set.
        <ForceGraph2D
          graphData={graphData as unknown as { nodes: object[]; links: object[] }}
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          nodeRelSize={1}
          nodeId="id"
          nodeVal={((n: object) => Math.max(1, nodeRadius((n as ForceNode).weight))) as never}
          nodeColor={((n: object) => statusColor((n as ForceNode).status)) as never}
          nodeLabel={(() => "") as never}
          nodeCanvasObjectMode={(() => "replace") as never}
          nodeCanvasObject={
            ((raw: object, ctx: CanvasRenderingContext2D, scale: number) =>
              drawNode(raw as ForceNode, ctx, scale)) as never
          }
          linkColor={
            ((l: object) => {
              const link = l as ForceLink;
              const src = link.source;
              const tgt = link.target;
              const hit = hovered && (
                (typeof src === "object" && (src as ForceNode).id === hovered.id) ||
                (typeof tgt === "object" && (tgt as ForceNode).id === hovered.id)
              );
              return hit ? COLOR_EDGE_HOVER : COLOR_EDGE;
            }) as never
          }
          linkWidth={0.8}
          linkDirectionalParticles={0}
          cooldownTicks={120}
          onNodeClick={((n: object) => onNodeClick(n as ForceNode)) as never}
          onNodeHover={((n: object | null) => onNodeHover(n as ForceNode | null)) as never}
          enableNodeDrag={true}
          enablePointerInteraction={true}
        />
      )}

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 rounded-panel bg-surface2 hairline px-3 py-2 text-xs"
          style={{
            left: Math.min(pointer.x + 12, size.w - 240),
            top: Math.min(pointer.y + 12, size.h - 80),
            maxWidth: 240,
          }}
        >
          <div className="font-display font-emphasized text-txt1 mb-0.5 leading-snug">
            {hovered.title}
          </div>
          <div className="flex items-center gap-2 text-txt3">
            <StatusBadge status={hovered.status} />
            {hovered.project_id && (
              <span className="text-nano text-txt3">{hovered.project_id}</span>
            )}
          </div>
        </div>
      )}

      <Legend />
    </div>
  );
}

function StatusBadge({ status }: { status: GraphNode["status"] }) {
  const cls =
    status === "canonical"
      ? "text-brandSoft"
      : status === "pending"
        ? "text-ai"
        : "text-txt4";
  return <span className={`text-nano ${cls}`}>{status}</span>;
}

function Legend() {
  return (
    <div className="absolute left-4 bottom-4 rounded-panel bg-surface1/80 hairline px-3 py-2 text-nano text-txt3 backdrop-blur-sm flex items-center gap-3">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLOR_ACCENT }} />
        canonical
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLOR_AI }} />
        pending
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLOR_DISABLED }} />
        archived
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ boxShadow: `0 0 0 1.5px ${COLOR_PROMOTED}` }}
        />
        promoted (24h)
      </span>
    </div>
  );
}

function OrbSkeleton() {
  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="relative">
        <div
          className="h-40 w-40 rounded-full opacity-40"
          style={{
            background: `radial-gradient(closest-side, ${COLOR_ACCENT}, transparent 70%)`,
            filter: "blur(8px)",
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center text-nano text-txt3">
          loading orb
        </div>
      </div>
    </div>
  );
}
