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
  // Tuned to balance against edge widths so clusters read as graphs,
  // not blobs. Smaller base so adjacent nodes don't merge halos.
  return 2.5 + Math.max(0, Math.min(1, weight)) * 5;
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
  const [showLabels, setShowLabels] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    /* Read clientWidth/Height (integer, rounded) directly. Earlier I
     * gated updates on w/h being non-zero, which left state at {0,0}
     * forever if the very first RAF read happened before the parent
     * grid resolved. Now we accept any change including transient
     * zero values; the OrbCanvas mount is gated on size>0 so a brief
     * 0 just keeps the skeleton visible. */
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    let stop = false;
    const start = performance.now();
    const loop = () => {
      if (stop) return;
      measure();
      if (performance.now() - start < 5000) {
        requestAnimationFrame(loop);
      }
    };
    requestAnimationFrame(loop);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      stop = true;
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
    /* Heat is RANK-relative, not absolute. With absolute weights, all
     * edges hover near the mean and the orb looks uniformly warm. With
     * rank: edge at the top of the sorted list maps to 1.0, bottom
     * maps to 0.0, ties share the same fractional rank. So if one
     * cluster heats up (more cross-refs incoming), edges around it get
     * rank-displaced and the rest visibly cool. */
    const sortedByWeight = [...rawEdges]
      .map((e, i) => ({ i, w: typeof e.weight === "number" ? e.weight : 0 }))
      .sort((a, b) => a.w - b.w);
    const rankOf = new Map<number, number>();
    for (let i = 0; i < sortedByWeight.length; i++) {
      const entry = sortedByWeight[i];
      if (!entry) continue;
      // Tie-handling: same weight gets average rank position.
      let lo = i;
      let hi = i;
      while (lo > 0 && sortedByWeight[lo - 1]?.w === entry.w) lo -= 1;
      while (hi < sortedByWeight.length - 1 && sortedByWeight[hi + 1]?.w === entry.w) hi += 1;
      const avgRank = (lo + hi) / 2;
      const denom = Math.max(1, sortedByWeight.length - 1);
      rankOf.set(entry.i, avgRank / denom);
    }
    const nodes: ForceNode[] = (q.data?.nodes ?? []).map((n) => ({ ...n }));
    const links: ForceLink[] = rawEdges.map((e, idx) => ({
      source: e.source,
      target: e.target,
      weight: rankOf.get(idx) ?? 0.5,
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

  /* Refs the canvas-callback closures read at every frame. Reading
   * useState directly inside drawNode would close over the value at
   * the time the callback was minted (drawNode is wrapped in
   * useCallback with empty deps so canvas keeps a stable reference).
   * Refs always reflect the latest value without forcing the canvas
   * to re-mount. */
  const hoveredIdRef = useRef<string | null>(null);
  const showLabelsRef = useRef<boolean>(false);
  useEffect(() => { hoveredIdRef.current = hovered?.id ?? null; }, [hovered]);
  useEffect(() => { showLabelsRef.current = showLabels; }, [showLabels]);

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
        charge.strength(-30);
      }
      const center = fg.d3Force("center") as { strength?: (s: number) => unknown } | undefined;
      if (center && typeof center.strength === "function") {
        // Strong global pull so the cluster stays anchored at origin
        // instead of drifting off-frame as the simulation cools.
        center.strength(0.35);
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

      // Custom force: extra pull on edgeless nodes toward origin so
      // they don't drift to the canvas perimeter. Strength bumped to
      // 0.18 (from 0.06) because lonely nodes were still escaping the
      // gathered cluster. Nodes carry mutable x/y/vx/vy on the d3-force
      // simulation; we read connected-id set from the latest graphData
      // on each call so a refetch doesn't require a re-tune.
      type ForceNodeWithVel = ForceNode & { vx?: number; vy?: number };
      const isolationPull = (alpha: number): void => {
        const nodes = (graphDataRef.current.nodes as ForceNodeWithVel[]) ?? [];
        const connected = connectedIdsRef.current;
        if (nodes.length === 0) return;
        for (const n of nodes) {
          if (connected.has(n.id)) continue;
          if (typeof n.x !== "number" || typeof n.y !== "number") continue;
          n.vx = (n.vx ?? 0) + -n.x * 0.18 * alpha;
          n.vy = (n.vy ?? 0) + -n.y * 0.18 * alpha;
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

      // Soft outer glow that breathes. Tight halo so adjacent nodes
      // don't merge into a blob; canonical pages glow strongest,
      // pending half as much, archived stays flat.
      const glowMul =
        raw.status === "canonical" ? 1.0 : raw.status === "pending" ? 0.55 : 0;
      if (glowMul > 0) {
        const glowR = r * 1.7 * breathe(phase, 0.92, 1.08);
        const grad = ctx.createRadialGradient(x, y, r * 0.85, x, y, glowR);
        const rgb =
          raw.status === "canonical"
            ? "168, 116, 240"   // accent (violet)
            : "150, 150, 230";  // ai (indigo)
        grad.addColorStop(0, `rgba(${rgb}, ${(0.22 * glowMul).toFixed(3)})`);
        grad.addColorStop(0.6, `rgba(${rgb}, ${(0.08 * glowMul).toFixed(3)})`);
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

      // Labels draw on hover or via the explicit toggle. No auto-show
      // at deep zoom because the dashboard orb has dozens of nodes and
      // even at 5x they overlap into a wall of text. User can flip the
      // labels button on if they want everything visible.
      const isHovered = hoveredIdRef.current === raw.id;
      const labelOn = showLabelsRef.current || isHovered;
      if (labelOn) {
        const fontSize = Math.max(8, (isHovered ? 12 : 10) / globalScale * 1.3);
        ctx.font = `${isHovered ? "600 " : ""}${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        // Hovered label gets a backing pill so it always reads.
        const label = raw.title.length > 60 ? raw.title.slice(0, 57) + "..." : raw.title;
        if (isHovered) {
          const w = ctx.measureText(label).width;
          ctx.fillStyle = "rgba(15, 17, 22, 0.85)";
          ctx.fillRect(x - w / 2 - 4, y + r + 1, w + 8, fontSize + 4);
        }
        ctx.fillStyle = COLOR_LABEL;
        ctx.fillText(label, x, y + r + 3);
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

  /* Render shell unconditionally. Earlier we returned <OrbSkeleton />
   * early on isLoading, which meant containerRef wasn't attached
   * during the initial mount and the size-measure useEffect ran with
   * el=null. The effect's [] deps meant it never re-ran when the real
   * tree later took over. Now containerRef attaches on first paint
   * regardless of state and the loading / error / empty UI overlays
   * inside the same shell. */
  const isEmpty = !q.isLoading && !q.isError && (q.data?.nodes.length ?? 0) === 0;
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
      {q.isLoading && <OrbSkeleton />}
      {q.isError && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="rounded-panel bg-surface1 hairline px-6 py-5 text-sm text-txt3 pointer-events-auto">
            Failed to load graph. The daemon may be offline.
          </div>
        </div>
      )}
      {isEmpty && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="rounded-panel bg-surface1 hairline px-8 py-7 max-w-md text-center pointer-events-auto">
            <div className="font-display text-xl font-emphasized mb-2">No wiki pages yet</div>
            <p className="text-txt3 text-sm">
              The orb visualizes your wiki as a graph. Pages appear here as the daemon
              ingests transcripts and writes transferable insights.
            </p>
          </div>
        </div>
      )}
      {size.w > 0 && size.h > 0 && q.data && (q.data.nodes.length ?? 0) > 0 && (
        /* Mount only after we have a real measured size. force-graph2d
         * sizes its internal canvas from props at mount and doesn't
         * always reflow on prop change; remount via key when size
         * changes meaningfully so the canvas matches the container.
         * 24px bucket so window-drag resizes don't thrash 60 remounts
         * per second. */
        <OrbCanvas
          key={`${Math.round(size.w / 24)}x${Math.round(size.h / 24)}`}
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
          /* Custom edge renderer (mode: replace) so we control line
           * width relative to zoom. The lib's default linkWidth is in
           * graph units, which means zooming in 3x makes a 2px line a
           * 6px line on screen — the "highlighter swipe" look the user
           * called out. We divide by globalScale so the on-screen width
           * stays constant at every zoom level. */
          linkCanvasObjectMode={(() => "replace") as never}
          linkCanvasObject={
            ((raw: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
              const link = raw as ForceLink & {
                source: ForceNode;
                target: ForceNode;
              };
              if (
                typeof link.source !== "object" ||
                typeof link.target !== "object"
              ) return;
              const sx = link.source.x ?? 0;
              const sy = link.source.y ?? 0;
              const tx = link.target.x ?? 0;
              const ty = link.target.y ?? 0;

              const w = link.weight ?? 0.5;
              const srcId = link.source.id;
              const tgtId = link.target.id;
              const isHovered =
                hovered != null &&
                (srcId === hovered.id || tgtId === hovered.id);

              // Curve via quadratic with a control point offset
              // perpendicular to the chord. Same per-edge phase the
              // linkCurvature accessor would use; replicating here so
              // we own the geometry instead of guessing __controlPoints.
              const phase = strHash(`${srcId}~${tgtId}`);
              const sign = phase > 0.5 ? 1 : -1;
              const curvature = sign * (0.05 + (1 - w) * 0.18);
              const dx = tx - sx;
              const dy = ty - sy;
              const cx = (sx + tx) / 2 + -dy * curvature;
              const cy = (sy + ty) / 2 + dx * curvature;

              // Color: heat gradient with subtle alpha breathing.
              const base = edgeHeatColor(w);
              const m = base.match(/^rgba\((\d+), (\d+), (\d+), ([0-9.]+)\)$/);
              const ebb = edgeBreathe(strHash(`${srcId}->${tgtId}`));
              const r = m ? m[1] : "150";
              const g = m ? m[2] : "150";
              const b = m ? m[3] : "200";
              const baseAlpha = m ? Number(m[4]) : 0.5;
              const stroke = isHovered
                ? "rgba(240, 245, 255, 0.85)"
                : `rgba(${r}, ${g}, ${b}, ${(baseAlpha * ebb).toFixed(3)})`;

              // Width in screen pixels, divided back into graph units
              // so the canvas transform doesn't blow it up. Cold edges
              // 0.8 screen-px, hot edges 2.4 screen-px.
              const screenPx = isHovered
                ? 2.0
                : 0.8 + Math.max(0, Math.min(1, w)) * 1.6;
              ctx.lineWidth = screenPx / Math.max(0.0001, globalScale);
              ctx.strokeStyle = stroke;
              ctx.lineCap = "round";
              ctx.beginPath();
              ctx.moveTo(sx, sy);
              ctx.quadraticCurveTo(cx, cy, tx, ty);
              ctx.stroke();
            }) as never
          }
          /* linkCurvature is also passed so the lib computes
           * intersection points correctly for particle flow + arrow
           * placement, even though our linkCanvasObject draws the
           * actual stroke. */
          linkCurvature={
            ((l: object) => {
              const link = l as ForceLink;
              const w = link.weight ?? 0.5;
              const srcId = typeof link.source === "object" ? (link.source as ForceNode).id : String(link.source);
              const tgtId = typeof link.target === "object" ? (link.target as ForceNode).id : String(link.target);
              const phase = strHash(`${srcId}~${tgtId}`);
              const sign = phase > 0.5 ? 1 : -1;
              const mag = 0.05 + (1 - w) * 0.18;
              return sign * mag;
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
          /* Finite cooldown so the cluster actually settles. Earlier I
           * tried Infinity to keep breathe animations running, but the
           * simulation never reached equilibrium and the cluster drifted
           * away from center forever. Layout stops at ~3s; particles +
           * edge-color animations keep redrawing without forcing live
           * physics, because force-graph re-renders when ANY of its
           * accessor outputs would change. */
          cooldownTicks={250}
          cooldownTime={5000}
          warmupTicks={60}
          d3AlphaDecay={0.025}
          d3VelocityDecay={0.4}
          onNodeClick={((n: object) => onNodeClick(n as ForceNode)) as never}
          onNodeHover={((n: object | null) => onNodeHover(n as ForceNode | null)) as never}
          enableNodeDrag={!compact}
          enablePointerInteraction={true}
          minZoom={0.3}
          maxZoom={6}
        />
      )}

      {/* Compact controls inline with the legend at bottom so they
       * don't visually subdivide the orb canvas. Tiny pill buttons
       * with the same hairline styling as the legend itself. */}
      {!compact && (
        <div className="absolute right-4 bottom-4 rounded-panel bg-surface1/80 hairline px-2 py-1.5 text-nano text-txt3 backdrop-blur-sm flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowLabels((v) => !v)}
            aria-pressed={showLabels}
            title={showLabels ? "Hide all labels" : "Show all labels"}
            className={`font-mono px-2 py-0.5 rounded-pill transition ${
              showLabels
                ? "bg-brand/20 text-brandSoft ring-1 ring-brand/40"
                : "text-txt3 hover:text-txt1"
            }`}
          >
            labels
          </button>
          <button
            type="button"
            onClick={() => {
              userInteractedRef.current = false;
              frame();
            }}
            title="Re-center"
            className="font-mono px-2 py-0.5 rounded-pill text-txt3 hover:text-txt1"
          >
            recenter
          </button>
        </div>
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
