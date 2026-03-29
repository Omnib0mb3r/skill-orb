import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';

export interface EdgeRenderData {
  id: string;
  source: string;
  target: string;
  weight: number;
}

/**
 * Normalizes the weight distribution across all edges onto a cool-to-warm gradient.
 * If all weights are equal (zero range), every edge gets the warm end (normalized = 1.0).
 * Pure function — no side effects, same input always produces the same output.
 */
export function computeRelativeColor(
  edges: Array<{ id: string; weight: number }>
): Map<string, THREE.Color> {
  const result = new Map<string, THREE.Color>();
  if (edges.length === 0) return result;

  const weights = edges.map(e => e.weight);
  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  const range = maxWeight - minWeight;

  for (const edge of edges) {
    // Zero range (all weights equal): use normalized = 1.0 → warm orange end of gradient.
    // The spec docstring says "mid-range" but the algorithm step says "1.0"; 1.0 is the
    // authoritative intent — warm color signals uniform-weight graphs clearly.
    const normalized = range === 0 ? 1.0 : (edge.weight - minWeight) / range;

    // Cool-to-warm hue interpolation: 240° (blue) → 15° (orange/red)
    const hue = 240 / 360 + normalized * (15 / 360 - 240 / 360);
    const saturation = 0.8 + normalized * (0.9 - 0.8);
    const lightness = 0.6 + normalized * (0.55 - 0.6);

    result.set(edge.id, new THREE.Color().setHSL(hue, saturation, lightness));
  }

  return result;
}

/** Creates one Line2 per edge using the provided color map. */
export function createEdgeLines(
  edges: EdgeRenderData[],
  colorMap: Map<string, THREE.Color>
): Map<string, Line2> {
  const lines = new Map<string, Line2>();

  for (const edge of edges) {
    const color = colorMap.get(edge.id) ?? new THREE.Color(0x888888);

    const geometry = new LineGeometry();
    geometry.setPositions([0, 0, 0, 0, 0, 0]);

    const material = new LineMaterial({
      color: color.getHex(),
      linewidth: 1.5,
      resolution: new THREE.Vector2(
        typeof window !== 'undefined' ? window.innerWidth : 1280,
        typeof window !== 'undefined' ? window.innerHeight : 720
      ),
    });

    const line = new Line2(geometry, material);
    line.computeLineDistances();
    lines.set(edge.id, line);
  }

  return lines;
}

/** Updates Line2 geometry positions from the current force layout node positions. */
export function updateEdgePositions(
  edgeLines: Map<string, Line2>,
  edges: EdgeRenderData[],
  nodePositions: Map<string, THREE.Vector3>
): void {
  for (const edge of edges) {
    const line = edgeLines.get(edge.id);
    if (!line) continue;

    const src = nodePositions.get(edge.source);
    const dst = nodePositions.get(edge.target);
    if (!src || !dst) continue;

    (line.geometry as LineGeometry).setPositions([
      src.x, src.y, src.z,
      dst.x, dst.y, dst.z,
    ]);
  }
}

/** Applies new colors to existing Line2 materials. */
export function applyEdgeColors(
  edgeLines: Map<string, Line2>,
  colorMap: Map<string, THREE.Color>
): void {
  for (const [id, line] of edgeLines) {
    const color = colorMap.get(id);
    if (!color) continue;
    (line.material as LineMaterial).color.set(color);
  }
}
