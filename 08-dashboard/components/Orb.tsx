"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { graph as fetchGraph, type GraphNode, type GraphEdge } from "@/lib/daemon-client";
import type { OrbCanvasMethods } from "./OrbCanvas";

/* react-force-graph-2d touches `window` at module load via its `force-graph`
 * dep (uses canvas + d3-force). We dynamic-import a thin forwardRef wrapper
 * (OrbCanvas) instead of the lib directly because Next.js `dynamic` shims
 * the ref to expose only `{ retry }`. Our wrapper restores the real
 * imperative API (zoomToFit, d3Force, centerAt). */
const OrbCanvas = dynamic(() => import("./OrbCanvas"), {
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
const COLOR_EDGE_HOVER = "oklch(96% 0.005 250 / 0.55)";
const COLOR_LABEL      = "oklch(85% 0.012 250)";

/* Edge heat gradient (cool to warm). Lifted from the v1 orb's visuals.ts:
 * weak edges are deep blue, medium are cyan, strong are gold, hottest are
 * red-orange. v1 weight = co-occurrence count; v2 weight = average of
 * endpoint page weights, so visually-prominent edges connect visually-
 * prominent pages. Same heat language, new data driving it. */
function lerpHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}
function hexToRgba(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function edgeHeatColor(normalized: number): string {
  const w = Math.max(0, Math.min(1, normalized));
  let hex: number;
  if (w < 0.25)      hex = lerpHex(0x0d1f5c, 0x1a5faa, w / 0.25);
  else if (w < 0.5)  hex = lerpHex(0x1a5faa, 0x22bbcc, (w - 0.25) / 0.25);
  else if (w < 0.75) hex = lerpHex(0x22bbcc, 0xeecc22, (w - 0.5)  / 0.25);
  else               hex = lerpHex(0xeecc22, 0xff4411, (w - 0.75) / 0.25);
  // Cooler edges are dimmer so the eye gravitates to hot ones.
  const alpha = 0.32 + w * 0.55;
  return hexToRgba(hex, alpha);
}

interface ForceNode extends GraphNode {
  x?: number;
  y?: number;
}

interface ForceLink {
  source: string | ForceNode;
  target: string | ForceNode;
  kind?: GraphEdge["kind"];
  weight?: number;
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

interface OrbProps {
  /** Embedded mode for the home view: hides legend, smaller hover tooltip,
   * disables drag so the parent card doesn't lock interaction. */
  compact?: boolean;
}

export function Orb({ compact = false }: OrbProps = {}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<OrbCanvasMethods | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [hovered, setHovered] = useState<ForceNode | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const q = useQuery({
    queryKey: ["graph"],
    queryFn: fetchGraph,
    refetchInterval: 30_000,
  });

  const graphData = useMemo(() => {
    const rawEdges = q.data?.edges ?? [];
    // Normalize edge weights against the max in this snapshot. With only
    // a handful of pages early on, even the "hottest" edge has low absolute
    // weight; relative normalization keeps the heat gradient meaningful at
    // every wiki size. Falls back to absolute if the daemon ever omits
    // weight (older deploy).
    const maxW = rawEdges.reduce(
      (m, e) => Math.max(m, typeof e.weight === "number" ? e.weight : 0),
      0,
    );
    const norm = (w: number | undefined): number => {
      if (typeof w !== "number") return 0.5;
      if (maxW <= 0) return 0;
      return w / maxW;
    };
    const nodes: ForceNode[] = (q.data?.nodes ?? []).map((n) => ({ ...n }));
    const links: ForceLink[] = rawEdges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: norm(e.weight),
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

  /* Tune d3-force so the layout looks good in every regime, especially the
   * early-life "lots of nodes, no edges" case where d3's defaults push
   * everything to the canvas perimeter.
   *
   * - charge: weaker repulsion than default (-30) so nodes don't fly apart.
   * - center: keeps the cluster anchored at (0,0) which we then frame.
   * - link: a soft default distance; once edges populate, the force-graph
   *   default link strength still applies. */
  const tuneForces = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    try {
      const charge = fg.d3Force("charge") as { strength?: (s: number) => unknown } | undefined;
      if (charge && typeof charge.strength === "function") {
        charge.strength(-60);
      }
      const center = fg.d3Force("center") as { strength?: (s: number) => unknown } | undefined;
      if (center && typeof center.strength === "function") {
        // Default centerForce in force-graph is fairly weak; bump so a fully
        // disconnected node set still pulls toward the middle.
        center.strength(0.05);
      }
      const link = fg.d3Force("link") as { distance?: (d: number) => unknown } | undefined;
      if (link && typeof link.distance === "function") {
        link.distance(36);
      }
    } catch {
      // Force methods are best-effort. If the lib's API ever changes shape
      // the layout still runs with defaults; the orb just frames less tightly.
    }
  }, []);

  /* Frame the graph in the viewport. Called on a few staggered timers
   * after data/size changes; once the user has interacted (panned or
   * zoomed) we stop fighting them. */
  const userInteractedRef = useRef(false);
  const frame = useCallback(() => {
    const fg = fgRef.current;
    if (!fg || userInteractedRef.current) return;
    const padding = compact ? 32 : 48;
    try {
      fg.zoomToFit(400, padding);
    } catch {
      // ignore: lib API drift would just leave the graph at default zoom.
    }
  }, [compact]);

  const nodeCount = q.data?.nodes.length ?? 0;
  const edgeCount = q.data?.edges.length ?? 0;

  // Re-tune forces and re-frame whenever the data set or container size
  // changes. Staggered timers cover the layout's settle window: by 350ms
  // the warm-up ticks have spread the cluster, by 1200ms it has fully
  // converged. Reset the user-interaction flag on data/size change so a
  // refetch reframes even after the user previously zoomed.
  useEffect(() => {
    if (nodeCount === 0 || size.w === 0 || size.h === 0) return;
    userInteractedRef.current = false;
    const t1 = setTimeout(tuneForces, 50);
    const t2 = setTimeout(frame, 350);
    const t3 = setTimeout(frame, 1200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [nodeCount, edgeCount, size.w, size.h, tuneForces, frame]);

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
      if (globalScale >= 1.4) {
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

  // Real user-interaction signals. We listen on the container so we don't
  // confuse our own programmatic zoomToFit transitions with a user gesture.
  // Once flipped, the staggered re-frame timers stop fighting the user.
  const markInteracted = useCallback(() => {
    userInteractedRef.current = true;
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

  // Particles are an animated flourish along edges. With zero edges they
  // cost nothing but also do nothing; we still gate them so the lib does
  // not allocate per-frame particle bookkeeping it never uses. With many
  // edges they remain on; weight controls density and speed.
  const particlesEnabled = edgeCount > 0;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      onMouseMove={onMouseMove}
      onWheel={markInteracted}
      onMouseDown={markInteracted}
      onTouchStart={markInteracted}
    >
      {size.w > 0 && size.h > 0 && (
        // The lib's NodeType generic is loose (`{ id?, x?, y? }`) so the
        // accessor callbacks would not type-check against our richer
        // ForceNode. Casts are localized to this prop set.
        <OrbCanvas
          ref={fgRef}
          graphData={graphData as unknown as { nodes: object[]; links: object[] }}
          width={size.w}
          height={size.h}
          onEngineStop={frame as never}
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
              if (hit) return COLOR_EDGE_HOVER;
              return edgeHeatColor(link.weight ?? 0.5);
            }) as never
          }
          linkWidth={
            ((l: object) => {
              const w = (l as ForceLink).weight ?? 0.5;
              // Cold edges 0.6px hairlines, hot edges scale up to 2.4px.
              return 0.6 + Math.max(0, Math.min(1, w)) * 1.8;
            }) as never
          }
          /* Animated particles flowing along each edge. Density and speed
           * scale with weight so the eye follows the most active pathways.
           * Source-to-target direction comes from the cross-reference graph;
           * particles visually convey "this insight points to that one."
           * Disabled when there are no edges so the lib does not allocate
           * per-frame bookkeeping for an empty edge set. */
          linkDirectionalParticles={
            ((l: object) => {
              if (!particlesEnabled) return 0;
              const w = (l as ForceLink).weight ?? 0.5;
              return Math.max(1, Math.round(w * 4));
            }) as never
          }
          linkDirectionalParticleSpeed={
            ((l: object) => {
              const w = (l as ForceLink).weight ?? 0.5;
              return 0.0035 + w * 0.008;
            }) as never
          }
          linkDirectionalParticleWidth={
            ((l: object) => {
              const w = (l as ForceLink).weight ?? 0.5;
              return 1.2 + w * 1.6;
            }) as never
          }
          linkDirectionalParticleColor={
            ((l: object) =>
              edgeHeatColor(((l as ForceLink).weight ?? 0.5) * 1.0)) as never
          }
          /* Cooldown short enough that the layout settles, long enough that
           * the warm-up ticks spread nodes from the origin before we frame
           * them. force-graph internally caps to a finite number, so we keep
           * this modest. */
          cooldownTicks={200}
          warmupTicks={40}
          d3AlphaDecay={0.025}
          d3VelocityDecay={0.3}
          onNodeClick={((n: object) => onNodeClick(n as ForceNode)) as never}
          onNodeHover={((n: object | null) => onNodeHover(n as ForceNode | null)) as never}
          enableNodeDrag={!compact}
          enablePointerInteraction={true}
          minZoom={0.3}
          maxZoom={6}
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

      {!compact && <Legend />}
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
