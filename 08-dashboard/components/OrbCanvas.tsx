"use client";

/**
 * Thin forwardRef wrapper around react-force-graph-2d.
 *
 * Why this file exists: Next.js `dynamic(..., { ssr: false })` injects its
 * own forwardRef shim that exposes only `{ retry }` to the parent ref. That
 * means a parent calling `fgRef.current.zoomToFit(...)` against a directly
 * dynamic-imported ForceGraph2D will hit `undefined` instead of the
 * force-graph imperative API. By wrapping the lib in our own forwardRef
 * component and dynamic-importing this wrapper, the ref reaches the real
 * instance and zoomToFit / d3Force / centerAt actually fire.
 *
 * react-force-graph-2d touches `window` at module load (force-graph dep
 * uses canvas + d3-force), so this module must only ever run on the client.
 * The Orb component dynamic-imports it with ssr:false.
 */

import { forwardRef, type Ref } from "react";
import ForceGraph2D from "react-force-graph-2d";

export interface OrbCanvasMethods {
  zoomToFit: (durationMs?: number, padding?: number) => unknown;
  centerAt: (x?: number, y?: number, durationMs?: number) => unknown;
  zoom: (scale?: number, durationMs?: number) => unknown;
  d3Force: (name: string, force?: unknown) => unknown;
  d3ReheatSimulation: () => unknown;
  getGraphBbox: () => { x: [number, number]; y: [number, number] };
}

// The lib's prop surface is huge and uses generic NodeType/LinkType. We pass
// props through verbatim; the parent already casts its accessors.
type Props = Record<string, unknown>;

const OrbCanvas = forwardRef<OrbCanvasMethods, Props>(function OrbCanvas(
  props,
  ref: Ref<OrbCanvasMethods>,
) {
  return <ForceGraph2D ref={ref as never} {...(props as object)} />;
});

export default OrbCanvas;
