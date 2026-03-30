import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { nodeIndexMap } from './nodes';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MaterialWithGlow {
  emissiveIntensity: number;
}

interface MaterialOpacity {
  opacity: number;
  transparent: boolean;
}

interface EphemeralEdgeEntry {
  line: Line2;
  data: {
    id: string;
    source: string;
    target: string;
    weight: number;
    first_seen: number;
    last_seen: number;
    raw_count: number;
  };
}

// ── Module-level state ────────────────────────────────────────────────────────

let _scene: THREE.Scene | null = null;
let _edgeLines: Map<string, Line2> = new Map();
let _edgeLookup: Map<string, string> = new Map(); // "source:target" → edgeId
let _activeEdgeIds: Set<string> = new Set();
let _ephemeralEdges: Map<string, EphemeralEdgeEntry> = new Map(); // "source:target" → entry
let _recencyFadingEnabled = true;

// ── Public API ────────────────────────────────────────────────────────────────

export function initAnimation(scene: THREE.Scene): void {
  _scene = scene;
}

/**
 * Called by orb.ts after each graph update so animation can track active edges.
 */
export function registerEdges(
  edgeLines: Map<string, Line2>,
  edgeData: Array<{ id: string; source: string; target: string }>
): void {
  _edgeLines = edgeLines;
  _edgeLookup = new Map();
  for (const e of edgeData) {
    _edgeLookup.set(`${e.source}:${e.target}`, e.id);
  }
}

export function onConnectionNew(payload: {
  source: string;
  target: string;
  connectionType: string;
}): void {
  const key = `${payload.source}:${payload.target}`;

  // Boost glow on an existing edge
  const edgeId = _edgeLookup.get(key);
  if (edgeId !== undefined) {
    const line = _edgeLines.get(edgeId);
    if (line) {
      (line.material as unknown as MaterialWithGlow).emissiveIntensity = 1.0;
      _activeEdgeIds.add(edgeId);
      return;
    }
  }

  // Edge not yet in graph — create an ephemeral Line2
  if (!_ephemeralEdges.has(key) && _scene) {
    const now = Date.now();
    const geometry = new LineGeometry();
    geometry.setPositions([0, 0, 0, 0, 0, 0]);
    const material = new LineMaterial({
      color: 0xffffff,
      linewidth: 2.0,
      resolution: new THREE.Vector2(
        typeof window !== 'undefined' ? window.innerWidth : 1280,
        typeof window !== 'undefined' ? window.innerHeight : 720
      ),
    });
    (material as unknown as MaterialWithGlow).emissiveIntensity = 1.0;
    const line = new Line2(geometry, material);
    _scene.add(line);
    _ephemeralEdges.set(key, {
      line,
      data: {
        id: key,
        source: payload.source,
        target: payload.target,
        weight: 1.0,
        first_seen: now,
        last_seen: now,
        raw_count: 1,
      },
    });
  }
}

export function onSnapshot(edges: Array<{ id: string; last_seen: number }>): void {
  // Clear active glow flags
  for (const edgeId of _activeEdgeIds) {
    const line = _edgeLines.get(edgeId);
    if (line) {
      (line.material as unknown as MaterialWithGlow).emissiveIntensity = 0.0;
    }
  }
  _activeEdgeIds.clear();

  // Remove and dispose ephemeral edges
  if (_scene) {
    for (const entry of _ephemeralEdges.values()) {
      _scene.remove(entry.line);
      (entry.line.geometry as { dispose?: () => void }).dispose?.();
      (entry.line.material as { dispose?: () => void }).dispose?.();
    }
  }
  _ephemeralEdges.clear();

  // Apply recency fading
  const recencyScores = computeRelativeRecency(edges);
  const edgeMaterials = new Map<string, MaterialOpacity>();
  for (const [id, line] of _edgeLines) {
    edgeMaterials.set(id, line.material as unknown as MaterialOpacity);
  }
  applyRecencyOpacity(edgeMaterials, recencyScores, _recencyFadingEnabled);
}

export function setRecencyFadingEnabled(enabled: boolean): void {
  _recencyFadingEnabled = enabled;
}

export function tickBreathing(elapsedMs: number): void {
  // Edge emissiveIntensity breathing
  let edgeIndex = 0;
  for (const [edgeId, line] of _edgeLines) {
    if (!_activeEdgeIds.has(edgeId)) {
      const { emissiveIntensity } = breathe(elapsedMs, edgeIndex);
      (line.material as unknown as MaterialWithGlow).emissiveIntensity = emissiveIntensity;
    }
    edgeIndex++;
  }

  // Node scale breathing via Matrix4
  const tmpPosition = new THREE.Vector3();
  const tmpQuaternion = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const tmpMatrix = new THREE.Matrix4();
  const dirtyMeshes = new Set<THREE.InstancedMesh>();

  let nodeIndex = 0;
  for (const { mesh, index: slot } of nodeIndexMap.values()) {
    const { scaleFactor } = breathe(elapsedMs, nodeIndex);
    mesh.getMatrixAt(slot, tmpMatrix);
    tmpMatrix.decompose(tmpPosition, tmpQuaternion, tmpScale);
    tmpScale.setScalar(scaleFactor);
    tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
    mesh.setMatrixAt(slot, tmpMatrix);
    dirtyMeshes.add(mesh);
    nodeIndex++;
  }

  for (const mesh of dirtyMeshes) {
    mesh.instanceMatrix.needsUpdate = true;
  }
}

// ── Pure functions ────────────────────────────────────────────────────────────

/**
 * Computes relative recency scores [0.0, 1.0] across a set of edges.
 * Most recently active edge → 1.0; least recently active → 0.0.
 * All-equal or single edge → all 1.0.
 */
export function computeRelativeRecency(
  edges: Array<{ id: string; last_seen: number }>
): Map<string, number> {
  const scores = new Map<string, number>();
  if (edges.length === 0) return scores;

  if (edges.length === 1) {
    scores.set(edges[0].id, 1.0);
    return scores;
  }

  const times = edges.map(e => e.last_seen);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const range = maxTime - minTime;

  if (range === 0) {
    for (const e of edges) scores.set(e.id, 1.0);
  } else {
    for (const e of edges) {
      scores.set(e.id, (e.last_seen - minTime) / range);
    }
  }

  return scores;
}

/**
 * Applies recency opacity to edge materials.
 * opacity = 0.2 + score * 0.8. Does not touch emissiveIntensity.
 */
export function applyRecencyOpacity(
  edgeMaterials: Map<string, { opacity: number; transparent: boolean }>,
  recencyScores: Map<string, number>,
  fadingEnabled: boolean
): void {
  for (const [id, material] of edgeMaterials) {
    if (!fadingEnabled) {
      material.opacity = 1.0;
      material.transparent = false;
    } else {
      const score = recencyScores.get(id) ?? 1.0;
      material.opacity = 0.2 + score * 0.8;
      material.transparent = material.opacity < 1.0;
    }
  }
}

/**
 * Returns emissiveIntensity and scaleFactor for a given elapsed time and node index.
 * emissiveIntensity: 3000ms period, range [0.0, 0.4]
 *   formula: 0.2 * (1 - cos(2π * t / 3000))
 * scaleFactor: 5000ms period with per-node offset (nodeIndex * 100ms)
 *   formula: 1.0 + 0.03 * sin(2π * (t + nodeIndex * 100) / 5000)
 */
export function breathe(
  elapsedMs: number,
  nodeIndex: number
): { emissiveIntensity: number; scaleFactor: number } {
  const emissivePeriod = 3000;
  const scalePeriod = 5000;

  const emissiveIntensity =
    0.2 * (1 - Math.cos((2 * Math.PI * elapsedMs) / emissivePeriod));

  const scaleOffset = nodeIndex * 100;
  const scaleFactor =
    1.0 + 0.03 * Math.sin((2 * Math.PI * (elapsedMs + scaleOffset)) / scalePeriod);

  return { emissiveIntensity, scaleFactor };
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Resets all module state. Used in tests only. */
export function _resetState(): void {
  _scene = null;
  _edgeLines = new Map();
  _edgeLookup = new Map();
  _activeEdgeIds = new Set();
  _ephemeralEdges = new Map();
  _recencyFadingEnabled = true;
}

/** Exposes ephemeral edge map for test assertions. */
export function _getEphemeralEdges(): Map<string, EphemeralEdgeEntry> {
  return _ephemeralEdges;
}

/** Exposes active edge IDs set for test assertions. */
export function _getActiveEdgeIds(): Set<string> {
  return _activeEdgeIds;
}
