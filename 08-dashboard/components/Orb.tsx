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

/* Phase-driven modulators. force-graph redraws every animation frame as
 * long as the physics simulation is barely warm, so reading Date.now()
 * inside drawNode/linkColor lets us layer breathing animations on top
 * of the static heat language without spinning our own RAF loop. */
function breathe(phase: number, low = 0.85, high = 1.15): number {
  // [low, high] sine, period ~3.5s
  const t = (Date.now() / 3500 + phase) * Math.PI * 2;
  return low + (Math.sin(t) * 0.5 + 0.5) * (high - low);
}
function edgeBreathe(phase: number): number {
  // Subtle alpha ebb, period ~5s, range [0.85, 1.0]
  const t = (Date.now() / 5000 + phase) * Math.PI * 2;
  return 0.85 + (Math.sin(t) * 0.5 + 0.5) * 0.15;
}
/* Hash a string into a stable [0,1) phase offset so adjacent nodes/edges
 * don't breathe in lockstep. */
function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function isRecentlyPromoted(node: GraphNode): boolean {
  if (!node.promoted_at) return false;
  const ms = Date.now() - new Date(node.promoted_at).getTime();
  return ms >= 0 && ms <= 24 * 60 * 60 * 1000;
}

function nodeRadius(weight: number): number {
  // Bigger across the board so the dashboard orb reads at a glance
  // instead of looking like loose constellation dots. Hot pages scale
  // up further so the eye finds them first.
  return 4.5 + Math.max(0, Math.min(1, weight)) * 9;
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
      const w = Math.floor(r.width);
      const h = Math.floor(r.height);
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    /* Multi-stage measurement.
     *
     * On the home tab the orb panel is inside a CSS grid that doesn't
     * lay out until after the first paint. ResizeObserver fires once on
     * observe(), but at that moment the parent grid has often not
     * resolved column widths yet, so we read 0x0 and gate the canvas off.
     * Then nothing changes (stable layout, no resize event) and the orb
     * never mounts until the user navigates away + back, which forces a
     * fresh layout pass.
     *
     * Defense in depth: measure now, on the next animation frame, on
     * the load event (covers webfont/JS chunks finishing), AND keep
     * the ResizeObserver for live resizes.
     */
    measure();
    const raf1 = requestAnimationFrame(measure);
    const raf2 = requestAnimationFrame(() => {
      requestAnimationFrame(measure);
    });
    const t = setTimeout(measure, 120);
    const onLoad = () => measure();
    window.addEventListener("load", onLoad);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(t);
      window.removeEventListener("load", onLoad);
      ro.disconnect();
    };
  }, []);

  const q = useQuery({
    queryKey: ["graph"],
    queryFn: fetchGraph,
    refetchInterval: 30_000,
  });

  const graphData = useMemo(() => {
    const rawEdges = q.data?.edges ?? [];
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

  /* Refs that the custom isolation-pull d3-force reads at every tick.
   * Reading state directly inside the closure would capture stale data
   * after a refetch; refs always reflect the latest graph. */
  const graphDataRef = useRef<{ nodes: ForceNode[]; links: ForceLink[] }>({
    nodes: [],
    links: [],
  });
  const connectedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    graphDataRef.current = graphData;
    const ids = new Set<string>();
    for (const l of graphData.links) {
      const sId = typeof l.source === "object" ? (l.source as ForceNode).id : String(l.source);
      const tId = typeof l.target === "object" ? (l.target as ForceNode).id : String(l.target);
      ids.add(sId);
      ids.add(tId);
    }
    connectedIdsRef.current = ids;
  }, [graphData]);

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

  /* Tune d3-force so isolated nodes don't drift to the canvas perimeter
   * and connected clusters bind tightly enough to read as clusters.
   *
   * Default d3-force gives every node the same charge repulsion. With no
   * counter-pull, nodes without edges settle wherever charge balances
   * with the global center force - which is far away when charge is
   * stronger than center, exactly the case the user reported (zoom way
   * out to find a lone node). Two layers fix that:
   *
   *   1. Tighter base forces. Lower charge, shorter link distance,
   *      stronger global center pull so the whole graph wants to be
   *      compact.
   *
   *   2. Custom 'isolation-pull' force at every tick. Per-node check:
   *      if the node has no incident edges, pull it toward the origin
   *      with extra strength scaled by current alpha. Connected nodes
   *      ignore this force entirely so link/charge balance still drives
   *      cluster layout.
   *
   * Link strength gets a weight bonus so important edges (high page
   * weight) shorten faster than weak ones, making cluster topology
   * legible. */
  const tuneForces = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    try {
      const charge = fg.d3Force("charge") as { strength?: (s: number) => unknown } | undefined;
      if (charge && typeof charge.strength === "function") {
        charge.strength(-22);
      }
      const center = fg.d3Force("center") as { strength?: (s: number) => unknown } | undefined;
      if (center && typeof center.strength === "function") {
        center.strength(0.22);
      }
      const link = fg.d3Force("link") as {
        distance?: (d: ((l: { weight?: number }) => number) | number) => unknown;
        strength?: (s: ((l: { weight?: number }) => number) | number) => unknown;
      } | undefined;
      if (link) {
        if (typeof link.distance === "function") {
          // Weighted edges contract more; weak edges get a longer rest
          // length so weak co-mentions don't pull unrelated clusters
          // together.
          link.distance(((l: { weight?: number }) => 22 + (1 - (l.weight ?? 0.5)) * 18) as never);
        }
        if (typeof link.strength === "function") {
          link.strength(((l: { weight?: number }) => 0.4 + (l.weight ?? 0.5) * 0.5) as never);
        }
      }

      // Custom force: extra pull on edgeless nodes toward origin. d3-force
      // calls this every tick with the current alpha; nodes carry mutable
      // x/y/vx/vy. We read connected-id set from the latest graphData on
      // each call so the force tracks data refetches without a re-tune.
      type ForceNodeWithVel = ForceNode & { vx?: number; vy?: number };
      const isolationPull = (alpha: number): void => {
        const nodes = (graphDataRef.current.nodes as ForceNodeWithVel[]) ?? [];
        const connected = connectedIdsRef.current;
        if (nodes.length === 0) return;
        for (const n of nodes) {
          if (connected.has(n.id)) continue;
          if (typeof n.x !== "number" || typeof n.y !== "number") continue;
          // Pull toward origin; stronger when far. 0.06 chosen by feel:
          // strong enough to gather strays in 2-3s, weak enough that a
          // user-dragged node doesn't snap back instantly.
          n.vx = (n.vx ?? 0) + -n.x * 0.06 * alpha;
          n.vy = (n.vy ?? 0) + -n.y * 0.06 * alpha;
        }
      };
      fg.d3Force("isolation-pull", isolationPull as unknown);
    } catch {
      // Force methods are best-effort. If the lib's API ever changes shape
      // the layout still runs with defaults; the orb just frames less tightly.
    }
  }, []);

  /* Frame the graph in the viewport. zoomToFit() uses the raw bbox of
   * every node which gets blown out by the disconnected stragglers
   * d3-force pushes to the canvas perimeter early in life. We compute
   * the bbox of the *connected* subgraph instead (any node that has at
   * least one edge), then centerAt + zoom against the actual container
   * size so the dense cluster fills the panel.
   *
   * Falls back to zoomToFit if there are no edges yet (everything's
   * disconnected) so a fresh wiki still gets framed sensibly. */
  const userInteractedRef = useRef(false);
  const frame = useCallback(() => {
    const fg = fgRef.current;
    if (!fg || userInteractedRef.current) return;
    if (size.w === 0 || size.h === 0) return;
    const padding = compact ? 8 : 16;

    try {
      const nodes = graphData.nodes as ForceNode[];
      const links = graphData.links as ForceLink[];

      // Collect ids that participate in at least one edge.
      const connectedIds = new Set<string>();
      for (const l of links) {
        const sId = typeof l.source === "object" ? (l.source as ForceNode).id : String(l.source);
        const tId = typeof l.target === "object" ? (l.target as ForceNode).id : String(l.target);
        connectedIds.add(sId);
        connectedIds.add(tId);
      }

      const target = connectedIds.size >= 2
        ? nodes.filter((n) => connectedIds.has(n.id))
        : nodes;

      if (target.length === 0) {
        fg.zoomToFit(400, padding);
        return;
      }

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let any = false;
      for (const n of target) {
        if (typeof n.x !== "number" || typeof n.y !== "number") continue;
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
        any = true;
      }
      if (!any) {
        fg.zoomToFit(400, padding);
        return;
      }

      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      // Add 20% margin so node radii + glow halos don't clip the edges.
      const w = Math.max(maxX - minX, 1) * 1.2 + padding * 2;
      const h = Math.max(maxY - minY, 1) * 1.2 + padding * 2;

      const zoomX = size.w / w;
      const zoomY = size.h / h;
      // Cap the zoom so a tiny graph (3 nodes huddled together) doesn't
      // blow up to fill the viewport with comically-large blobs.
      const targetZoom = Math.min(zoomX, zoomY, 3);

      fg.centerAt(cx, cy, 600);
      fg.zoom(targetZoom, 600);
    } catch {
      // Force methods are best-effort; fall through silently.
    }
  }, [compact, graphData, size.w, size.h]);

  const nodeCount = q.data?.nodes.length ?? 0;
  const edgeCount = q.data?.edges.length ?? 0;

  // Tune + frame logic. Two problems to handle:
  //
  //   1. fgRef.current is null until the dynamic-imported OrbCanvas
  //      finishes loading. Fixed timers fire before the canvas ref is
  //      attached on slow first-paint, so the orb appears empty until
  //      navigation forces a remount.
  //
  //   2. With cooldownTicks=Infinity the engine never fires onEngineStop,
  //      so we can't rely on it to know when to frame.
  //
  // Solution: a ready-poll that runs every 80ms until fgRef.current
  // exists, then fires tune + a few staggered frames. Cancellable on
  // unmount + on data/size change so we don't pile up timers.
  useEffect(() => {
    if (nodeCount === 0 || size.w === 0 || size.h === 0) return;
    userInteractedRef.current = false;

    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    const armOnReady = (): void => {
      if (cancelled) return;
      const fg = fgRef.current;
      if (!fg) {
        timeouts.push(setTimeout(armOnReady, 80));
        return;
      }
      tuneForces();
      // Schedule frames at staggered intervals once the ref is real.
      // Layout settle window: warmup ticks spread by 400ms, links
      // contract by 1500ms, long-tail drift by 3000ms.
      timeouts.push(setTimeout(frame, 60));
      timeouts.push(setTimeout(frame, 400));
      timeouts.push(setTimeout(frame, 1500));
      timeouts.push(setTimeout(frame, 3000));
    };
    armOnReady();

    return () => {
      cancelled = true;
      for (const t of timeouts) clearTimeout(t);
    };
  }, [nodeCount, edgeCount, size.w, size.h, tuneForces, frame]);

  const drawNode = useCallback(
    (raw: ForceNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = raw.x ?? 0;
      const y = raw.y ?? 0;
      const phase = strHash(raw.id);
      const r = nodeRadius(raw.weight);

      // Soft outer glow that breathes. Canonical pages glow strongest,
      // pending half as much, archived stays flat. Render glow with
      // explicit rgba() so the canvas API renders it on every browser
      // instead of relying on inconsistent oklch() alpha-channel support
      // in Canvas2D.
      const glowMul =
        raw.status === "canonical" ? 1.0 : raw.status === "pending" ? 0.65 : 0;
      if (glowMul > 0) {
        const glowR = r * 3.2 * breathe(phase, 0.9, 1.2);
        const grad = ctx.createRadialGradient(x, y, r * 0.5, x, y, glowR);
        // Match status colors (oklch() in CSS, RGB approximation here so
        // gradients render reliably). Accent ~ violet, AI ~ indigo.
        const rgb =
          raw.status === "canonical"
            ? "168, 116, 240"   // accent (violet)
            : "150, 150, 230";  // ai (indigo)
        grad.addColorStop(0, `rgba(${rgb}, ${(0.42 * glowMul).toFixed(3)})`);
        grad.addColorStop(0.55, `rgba(${rgb}, ${(0.18 * glowMul).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, glowR, 0, Math.PI * 2, false);
        ctx.fill();
      }

      // Core fill. Slight scale breathing so even archived nodes have
      // some life, but tiny so the cluster doesn't visibly throb.
      const coreR = r * breathe(phase, 0.95, 1.06);
      ctx.beginPath();
      ctx.arc(x, y, coreR, 0, Math.PI * 2, false);
      ctx.fillStyle = statusColor(raw.status);
      ctx.fill();

      if (isRecentlyPromoted(raw)) {
        // Animated expanding ring: phase grows the ring outward and fades
        // it, then resets. Period ~2.4s so the user notices it within one
        // glance at the orb.
        const t = ((Date.now() / 2400 + phase) % 1);
        const ringR = r + 2.5 + t * 9;
        const alpha = 1 - t;
        ctx.beginPath();
        ctx.arc(x, y, ringR, 0, Math.PI * 2, false);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = COLOR_PROMOTED.replace(")", ` / ${alpha.toFixed(2)})`);
        ctx.stroke();
        // Static inner ring as a baseline so the node still reads as
        // promoted between pulses.
        ctx.beginPath();
        ctx.arc(x, y, r + 2.5, 0, Math.PI * 2, false);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = COLOR_PROMOTED;
        ctx.stroke();
      }

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
              const w = link.weight ?? 0.5;
              const base = edgeHeatColor(w);
              // Subtle alpha breathing, phase-offset by edge endpoints so
              // adjacent edges don't pulse in lockstep. The base rgba()
              // already encodes alpha; multiply that channel by the ebb.
              const srcId = typeof src === "object" ? (src as ForceNode).id : String(src);
              const tgtId = typeof tgt === "object" ? (tgt as ForceNode).id : String(tgt);
              const phase = strHash(`${srcId}->${tgtId}`);
              const ebb = edgeBreathe(phase);
              const m = base.match(/^rgba\((\d+), (\d+), (\d+), ([0-9.]+)\)$/);
              if (!m) return base;
              const a = Math.max(0, Math.min(1, Number(m[4]) * ebb));
              return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a.toFixed(3)})`;
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
          /* Long-tail cooldown keeps the simulation barely warm forever so
           * the canvas keeps redrawing every frame. That's what surfaces
           * the breathe()/edgeBreathe() animations - force-graph only
           * paints when the engine is alive. We pair it with a very low
           * alpha decay + a periodic d3ReheatSimulation tick (see
           * autoReheatRef effect) to keep nodes drifting gently instead
           * of snapping into a frozen frame. */
          cooldownTicks={Infinity}
          cooldownTime={Infinity}
          warmupTicks={40}
          d3AlphaDecay={0.0008}
          d3VelocityDecay={0.45}
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
