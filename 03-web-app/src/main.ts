import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { createScene, addResizeListener } from '../webview/renderer';
import { createCameraController } from '../webview/camera';
import { initVoice } from '../webview/voice';
import { detectVoiceIntent, evaluateQuery } from '../webview/search';
import { createTooltip, deriveGitHubUrl } from '../webview/nodeActions';
import {
  build,
  recomputeEdgeHeat,
  updateEdgeDrift,
  createEdgeMesh,
  getEdgeBaseColors,
  N_SEGMENTS,
} from './graph/builder';
import type { BuildResult, GraphData } from './graph/builder';
import { getMaterialForNode, getMaterialForNodeType, getEdgeOpacity } from './orb/visuals';
import { connect } from './ws/client';
import type { SceneRef } from './ws/handlers';
import type { GraphSnapshot, GraphNode, GraphEdge } from './types';
import { initHud, setConnectionStatus, setCameraMode, updateVoiceStatus } from './ui/hud';

// ── State ─────────────────────────────────────────────────────────────────────

type AppState = BuildResult & {
  selectedNodeId: string | null;
  isSearchHighlightActive: boolean;
  nodeDataMap: Map<string, GraphNode>;
  edgeData: GraphEdge[];
};

let currentBuild: AppState | null = null;
let currentSnapshot: GraphSnapshot | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function toGraphData(snapshot: GraphSnapshot): GraphData {
  return {
    nodes: snapshot.nodes.map(n => ({ id: n.id, label: n.label, type: n.type, tags: n.tags })),
    edges: snapshot.edges.map(e => ({
      sourceId: e.source,
      targetId: e.target,
      weight: e.weight,
      rawCount: e.raw_count,
    })),
  };
}

function clearBuild(scene: THREE.Scene, b: AppState): void {
  for (const mesh of b.meshes.values()) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach(m => m.dispose());
    else mat.dispose();
  }
  for (const line of b.edgeMeshes) {
    scene.remove(line);
    line.geometry.dispose();
    (line.material as LineMaterial).dispose();
  }
}

// ── Camera fit ────────────────────────────────────────────────────────────────

function computeCameraFit(
  ids: Iterable<string>,
  meshes: Map<string, THREE.Mesh>,
): { position: THREE.Vector3; target: THREE.Vector3 } | null {
  const positions: THREE.Vector3[] = [];
  for (const id of ids) {
    const m = meshes.get(id);
    if (m) positions.push(m.position.clone());
  }
  if (positions.length === 0) return null;

  const c = positions.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(positions.length);
  let r = 0;
  for (const p of positions) r = Math.max(r, c.distanceTo(p));
  const dist = Math.max(r * 2.8, 14);

  return { position: new THREE.Vector3(c.x, c.y, c.z + dist), target: c };
}

function fitCameraToIds(
  ids: Iterable<string>,
  meshes: Map<string, THREE.Mesh>,
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update(): void },
): void {
  const fit = computeCameraFit(ids, meshes);
  if (!fit) return;
  controls.target.copy(fit.target);
  camera.position.copy(fit.position);
  controls.update();
}

// ── Search highlight ──────────────────────────────────────────────────────────

function applySearchHighlight(b: AppState, matchIds: Set<string>): void {
  const connectedEdgeIdx = new Set<number>();
  for (let i = 0; i < b.edges.length; i++) {
    const e = b.edges[i];
    if (matchIds.has(e.sourceId) || matchIds.has(e.targetId)) connectedEdgeIdx.add(i);
  }
  for (const [id, mesh] of b.meshes) {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (matchIds.has(id)) {
      const node = b.nodes.get(id);
      const cfg = node ? getMaterialForNode(node.type, b.nodeDataMap.get(id)?.tags) : null;
      mat.color.setHex(cfg?.color ?? 0xffffff);
      mat.emissive.setHex(cfg?.emissive ?? cfg?.color ?? 0xffffff);
      mat.emissiveIntensity = 0.65;
      mat.opacity = 1.0;
      mat.transparent = false;
    } else {
      mat.color.setHex(0x112233);
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0.0;
      mat.opacity = 0.25;
      mat.transparent = true;
    }
    mat.needsUpdate = true;
  }
  recomputeEdgeHeat(b.edges, b.edgeMeshes, b.infrastructureNodeIds);
  const dimColors = new Float32Array((N_SEGMENTS + 1) * 3);
  for (let v = 0; v <= N_SEGMENTS; v++) {
    dimColors[v * 3] = 0.04; dimColors[v * 3 + 1] = 0.06; dimColors[v * 3 + 2] = 0.10;
  }
  for (let i = 0; i < b.edgeMeshes.length; i++) {
    const mesh = b.edgeMeshes[i];
    const mat = mesh.material as LineMaterial;
    if (connectedEdgeIdx.has(i)) {
      mat.opacity = 0.85;
    } else {
      (mesh.geometry as LineGeometry).setColors(dimColors);
      mat.opacity = 0.04;
    }
    mat.needsUpdate = true;
  }
}

// ── Highlight helpers ─────────────────────────────────────────────────────────

function clearHighlights(b: AppState): void {
  for (const [id, mesh] of b.meshes) {
    const node = b.nodes.get(id);
    if (!node) continue;
    const cfg = getMaterialForNode(node.type, b.nodeDataMap.get(id)?.tags);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.color.setHex(cfg.color);
    mat.opacity = cfg.opacity;
    mat.transparent = cfg.transparent;
    mat.emissive.setHex(cfg.emissive ?? cfg.color);
    mat.emissiveIntensity = cfg.emissiveIntensity ?? 0.255;
    mat.needsUpdate = true;
  }
  b.isSearchHighlightActive = false;
  recomputeEdgeHeat(b.edges, b.edgeMeshes, b.infrastructureNodeIds);
  for (let i = 0; i < b.edgeMeshes.length; i++) {
    const edge = b.edges[i];
    if (!edge) continue;
    const mat = b.edgeMeshes[i].material as LineMaterial;
    mat.opacity = getEdgeOpacity(edge.weight);
    mat.needsUpdate = true;
  }
}

function applyHighlight(b: AppState, clickedId: string): void {
  const connectedIds = new Set<string>([clickedId]);
  const connectedEdgeIdx = new Set<number>();

  for (let i = 0; i < b.edges.length; i++) {
    const e = b.edges[i];
    if (e.sourceId === clickedId || e.targetId === clickedId) {
      connectedIds.add(e.sourceId);
      connectedIds.add(e.targetId);
      connectedEdgeIdx.add(i);
    }
  }

  for (const [id, mesh] of b.meshes) {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (id === clickedId) {
      mat.color.setHex(0xffffff);
      mat.emissive.setHex(0xffffff);
      mat.emissiveIntensity = 0.9;
      mat.opacity = 1.0;
      mat.transparent = false;
    } else if (connectedIds.has(id)) {
      const node = b.nodes.get(id);
      const cfg = node ? getMaterialForNode(node.type, b.nodeDataMap.get(id)?.tags) : null;
      mat.color.setHex(cfg?.color ?? 0xffffff);
      mat.emissive.setHex(cfg?.emissive ?? cfg?.color ?? 0xffffff);
      mat.emissiveIntensity = 0.6;
      mat.opacity = 1.0;
      mat.transparent = false;
    } else {
      mat.color.setHex(0x112233);
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0.0;
      mat.opacity = 0.252;
      mat.transparent = true;
    }
    mat.needsUpdate = true;
  }

  recomputeEdgeHeat(b.edges, b.edgeMeshes, b.infrastructureNodeIds);
  const whiteColors = new Float32Array((N_SEGMENTS + 1) * 3);
  for (let v = 0; v <= N_SEGMENTS; v++) {
    whiteColors[v * 3] = 1; whiteColors[v * 3 + 1] = 1; whiteColors[v * 3 + 2] = 1;
  }
  const dimColors = new Float32Array((N_SEGMENTS + 1) * 3);
  for (let v = 0; v <= N_SEGMENTS; v++) {
    dimColors[v * 3] = 0.04; dimColors[v * 3 + 1] = 0.06; dimColors[v * 3 + 2] = 0.10;
  }
  for (let i = 0; i < b.edgeMeshes.length; i++) {
    const mesh = b.edgeMeshes[i];
    const mat = mesh.material as LineMaterial;
    if (connectedEdgeIdx.has(i)) {
      (mesh.geometry as LineGeometry).setColors(whiteColors);
      mat.opacity = 1.0;
    } else {
      (mesh.geometry as LineGeometry).setColors(dimColors);
      mat.opacity = 0.04;
    }
    mat.needsUpdate = true;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const canvas =
    (document.getElementById('devneural-canvas') as HTMLCanvasElement | null) ??
    (() => {
      const c = document.createElement('canvas');
      Object.assign(c.style, { position: 'fixed', inset: '0', width: '100%', height: '100%' });
      document.body.appendChild(c);
      return c;
    })();

  // Deep-space renderer (stars, fog, lighting) — but old per-mesh physics runs at ~radius 15,
  // so bring the camera in close rather than the webview default of ~197 units.
  const { scene, camera, controls, startAnimationLoop } = createScene(canvas);
  controls.update();

  // Track canvas resolution for LineMaterial (needed for pixel-accurate linewidth)
  const edgeResolution = new THREE.Vector2(canvas.clientWidth || 1920, canvas.clientHeight || 1080);
  addResizeListener((w: number, h: number) => {
    edgeResolution.set(w, h);
    if (currentBuild) {
      for (const line of currentBuild.edgeMeshes) {
        (line.material as LineMaterial).resolution.set(w, h);
        (line.material as LineMaterial).needsUpdate = true;
      }
    }
  });

  const hud = initHud();

  // Camera controller — getNodePosition reads live mesh.position (shared with physics)
  const cameraController = createCameraController(camera, controls, nodeId => {
    const mesh = currentBuild?.meshes.get(nodeId);
    return mesh ? mesh.position.clone() : null;
  });

  // Tooltip
  const tooltip = createTooltip();
  document.body.appendChild(tooltip.getElement());

  // Voice
  const voice = initVoice({
    onTranscript(text: string) {
      const intent = detectVoiceIntent(text);
      if (intent.action === 'returnToAuto') {
        cameraController.returnToAuto();
      } else {
        const query = intent.query ?? intent.target ?? '';
        if (query) {
          applySearch(query);
          hud.setSearchValue(query);
        }
      }
    },
    onStatusChange(status) {
      updateVoiceStatus(hud, status);
    },
  });

  if (!voice) updateVoiceStatus(hud, 'unavailable');
  hud.onVoiceClick(() => {
    if (!voice) return;
    if (voice.status === 'listening') voice.stopListening();
    else voice.startListening();
  });
  hud.onReturnToAuto(() => {
    if (currentBuild) { clearHighlights(currentBuild); currentBuild.selectedNodeId = null; }
    const fit = currentBuild && currentBuild.meshes.size > 0
      ? computeCameraFit(currentBuild.meshes.keys(), currentBuild.meshes)
      : null;
    cameraController.returnToAuto(fit?.position, fit?.target);
  });
  hud.onSearch(applySearch);

  // ── Raycasting ──────────────────────────────────────────────────────────────

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function hitNodeAtPointer(e: PointerEvent): { nodeId: string; graphNode: GraphNode } | null {
    if (!currentBuild) return null;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([...currentBuild.meshes.values()]);
    if (hits.length === 0) return null;
    const hitMesh = hits[0].object as THREE.Mesh;
    for (const [id, mesh] of currentBuild.meshes) {
      if (mesh === hitMesh) {
        const graphNode = currentBuild.nodeDataMap.get(id);
        return graphNode ? { nodeId: id, graphNode } : null;
      }
    }
    return null;
  }

  // ── Pointer events ──────────────────────────────────────────────────────────

  let pointerDownPos = { x: 0, y: 0 };
  let lastClickTime = 0;
  let lastClickNodeId = '';

  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    pointerDownPos = { x: e.clientX, y: e.clientY };
  });

  canvas.addEventListener('pointerup', (e: PointerEvent) => {
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) return; // was a drag, not a click

    const hit = hitNodeAtPointer(e);
    if (!hit) {
      tooltip.hide();
      if (currentBuild) {
        clearHighlights(currentBuild);
        currentBuild.selectedNodeId = null;
      }
      return;
    }

    const { nodeId, graphNode } = hit;
    const edges = currentBuild?.edgeData ?? [];
    const rect = canvas.getBoundingClientRect();
    const screenPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    const now = performance.now();
    const isDoubleClick = nodeId === lastClickNodeId && (now - lastClickTime) < 300;
    lastClickTime = now;
    lastClickNodeId = nodeId;

    // Double-click on project: open GitHub
    if (isDoubleClick && graphNode.type === 'project') {
      const url = deriveGitHubUrl(nodeId);
      if (url) window.open(url, '_blank');
      return;
    }

    // Toggle: clicking the same node again clears the highlight
    if (currentBuild && currentBuild.selectedNodeId === nodeId) {
      clearHighlights(currentBuild);
      currentBuild.selectedNodeId = null;
      tooltip.hide();
      return;
    }

    if (currentBuild) {
      applyHighlight(currentBuild, nodeId);
      currentBuild.selectedNodeId = nodeId;
    }

    if (graphNode.type === 'project') {
      tooltip.show(graphNode, edges, screenPos.x, screenPos.y);
    } else {
      // tool or skill: focus camera on every project that uses this node
      const connectedProjectIds = edges
        .filter(e => e.source === nodeId || e.target === nodeId)
        .flatMap(e => {
          const otherId = e.source === nodeId ? e.target : e.source;
          const other = currentBuild?.nodeDataMap.get(otherId);
          return other?.type === 'project' ? [otherId] : [];
        });
      cameraController.onActiveProjectsChanged(connectedProjectIds);
      tooltip.show(graphNode, edges, screenPos.x, screenPos.y);
    }
  });

  let lastMoveTime = 0;
  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    const now = performance.now();
    if (now - lastMoveTime < 16) return; // ~60fps throttle
    lastMoveTime = now;
    const hit = hitNodeAtPointer(e);
    if (!hit) { tooltip.hide(); return; }
    const rect = canvas.getBoundingClientRect();
    tooltip.show(hit.graphNode, currentBuild?.edgeData ?? [],
      e.clientX - rect.left, e.clientY - rect.top);
  });

  canvas.addEventListener('pointerleave', () => tooltip.hide());

  // Only switch to manual camera mode when the user actually drags
  controls.addEventListener('start', () => cameraController.onUserInteraction());

  // ── Search ──────────────────────────────────────────────────────────────────

  function applySearch(query: string): void {
    if (!currentSnapshot) return;
    if (!query.trim()) {
      if (currentBuild) { clearHighlights(currentBuild); currentBuild.selectedNodeId = null; }
      hud.setMatchCount(0);
      return;
    }
    const result = evaluateQuery(query, currentSnapshot.nodes, currentSnapshot.edges);
    if (currentBuild && result.matchingNodeIds.size > 0) {
      applySearchHighlight(currentBuild, result.matchingNodeIds);
      currentBuild.selectedNodeId = null;
      currentBuild.isSearchHighlightActive = true;

      // Collect matched nodes + all their direct neighbours for the fit box
      const fitIds = new Set<string>(result.matchingNodeIds);
      for (const e of currentBuild.edges) {
        if (result.matchingNodeIds.has(e.sourceId)) fitIds.add(e.targetId);
        if (result.matchingNodeIds.has(e.targetId)) fitIds.add(e.sourceId);
      }
      fitCameraToIds(fitIds, currentBuild.meshes, camera, controls);
    } else if (currentBuild) {
      clearHighlights(currentBuild);
    }
    hud.setMatchCount(result.matchingNodeIds.size);
  }

  // ── SceneRef (WebSocket callbacks) ─────────────────────────────────────────

  const sceneRef: SceneRef = {
    clear() {
      if (currentBuild) { clearBuild(scene, currentBuild); currentBuild = null; }
      currentSnapshot = null;
      hud.setCounts(0, 0, 0);
    },

    rebuild(snapshot: GraphSnapshot) {
      _didFitCamera = true;
      if (currentBuild) clearBuild(scene, currentBuild);
      currentSnapshot = snapshot;
      const result = build(toGraphData(snapshot), scene, edgeResolution);
      currentBuild = {
        ...result,
        selectedNodeId: null,
        isSearchHighlightActive: false,
        nodeDataMap: new Map(snapshot.nodes.map(n => [n.id, n])),
        edgeData: snapshot.edges,
      };
      const projectCount = snapshot.nodes.filter(n => n.type === 'project').length;
      hud.setCounts(projectCount, snapshot.nodes.length, snapshot.edges.length);
      setConnectionStatus(hud, 'connected');

      // Find the skill node with the most edge connections
      const skillDegree = new Map<string, number>();
      for (const e of snapshot.edges) {
        for (const id of [e.source, e.target]) {
          if (id.startsWith('skill:')) skillDegree.set(id, (skillDegree.get(id) ?? 0) + 1);
        }
      }
      let topSkillLabel = '—';
      let topDegree = 0;
      for (const [id, deg] of skillDegree) {
        if (deg > topDegree) {
          topDegree = deg;
          const node = snapshot.nodes.find(n => n.id === id);
          topSkillLabel = node ? node.label : id.replace('skill:', '');
        }
      }
      hud.setTopSkill(topSkillLabel);
    },

    addEdge(edge) {
      if (!currentBuild) return;
      const srcMesh = currentBuild.meshes.get(edge.source);
      const tgtMesh = currentBuild.meshes.get(edge.target);
      if (!srcMesh || !tgtMesh) return;
      const line = createEdgeMesh(scene, edgeResolution, getEdgeOpacity(0.25));
      currentBuild.edgeMeshes.push(line);
      currentBuild.edges.push({ sourceId: edge.source, targetId: edge.target, weight: 0, usage: 0 });
      recomputeEdgeHeat(currentBuild.edges, currentBuild.edgeMeshes);
    },

    setFocusNode(nodeId: string) { cameraController.onActiveProjectsChanged([nodeId]); },
    setHighlightNodes(nodeIds: string[]) { cameraController.onActiveProjectsChanged(nodeIds); },
    clearHighlights() { cameraController.returnToAuto(); },
    resetCamera() { cameraController.returnToAuto(); },
  };

  // ── Animation loop ──────────────────────────────────────────────────────────

  let _didFitCamera = true;

  startAnimationLoop((deltaS: number) => {
    const t = performance.now() / 1000;

    if (currentBuild) {
      if (currentBuild.simulation.isCooled() && !_didFitCamera) {
        let maxR = 0;
        for (const mesh of currentBuild.meshes.values()) {
          const r = mesh.position.length();
          if (r > maxR) maxR = r;
        }
        camera.position.set(0, 0, maxR * 0.002);
        controls.update();
        _didFitCamera = true;
      }
      currentBuild.simulation.tick();
      // Update organic edge curves (positions + drift)
      const driftTime = t * 0.3; // 0.3 Hz drift
      updateEdgeDrift(driftTime, currentBuild.edges, currentBuild.edgeMeshes, currentBuild.meshes);

      // Firing synaptic pulses — traveling bright spots along edges
      if (!currentBuild.selectedNodeId && !currentBuild.isSearchHighlightActive) {
        const baseColors = getEdgeBaseColors();
        const nVerts = N_SEGMENTS + 1;

        for (let i = 0; i < currentBuild.edgeMeshes.length; i++) {
          const edge = currentBuild.edges[i];
          if (!edge) continue;
          const mat = currentBuild.edgeMeshes[i].material as LineMaterial;
          const geo = currentBuild.edgeMeshes[i].geometry as LineGeometry;
          const base = baseColors[i];
          if (!base) continue;

          // Fire rate AND travel speed are relativistic — driven by this edge's
          // heat (per-edge usage, normalized against the graph's max).
          // edge.weight is in [0.25, 1.0] from recomputeEdgeHeat().
          const normalizedHeat = (edge.weight - 0.25) / 0.75; // → [0, 1]

          // Fire rate: hotter edges fire more often.
          const MIN_FIRE_INTERVAL = 0.7;  // cap — hottest edge fires ~1.4 pulses/sec
          const MAX_FIRE_INTERVAL = 4.0;  // slowest — coldest edges fire ~once per 4 s
          const fireInterval =
            MAX_FIRE_INTERVAL - normalizedHeat * (MAX_FIRE_INTERVAL - MIN_FIRE_INTERVAL);

          // Travel speed: hotter edges push pulses through FASTER in world units
          // per second. We compute fireDuration from actual edge length so that
          // short hot edges don't cancel out the speed increase (physics pulls
          // hot edges shorter via REST_LENGTH / sqrt(weight+1)).
          const srcMesh = currentBuild.meshes.get(edge.sourceId);
          const tgtMesh = currentBuild.meshes.get(edge.targetId);
          const dx = (srcMesh?.position.x ?? 0) - (tgtMesh?.position.x ?? 0);
          const dy = (srcMesh?.position.y ?? 0) - (tgtMesh?.position.y ?? 0);
          const dz = (srcMesh?.position.z ?? 0) - (tgtMesh?.position.z ?? 0);
          const edgeLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

          const MIN_PULSE_SPEED = 5;   // cold — world units per second
          const MAX_PULSE_SPEED = 18;  // hot — world units per second
          const pulseSpeed =
            MIN_PULSE_SPEED + normalizedHeat * (MAX_PULSE_SPEED - MIN_PULSE_SPEED);
          // Clamp so a blur-fast hot pulse still stays visible for 0.18s and a
          // long cold pulse doesn't stretch beyond 1.5s.
          const fireDuration = Math.max(0.18, Math.min(1.5, edgeLength / pulseSpeed));

          const firePhase = i * 2.345;                 // stagger so edges don't sync
          const cycleTime = (t + firePhase) % fireInterval;

          const colors = new Float32Array(nVerts * 3);

          if (cycleTime < fireDuration) {
            // ── FIRING — bright pulse travels source → target ──
            const pulseT = cycleTime / fireDuration;   // 0→1 position along edge
            const pulseWidth = 0.10;                   // width of the bright spot
            const trailLen = 0.18;                     // fading trail behind the pulse

            for (let v = 0; v < nVerts; v++) {
              const vt = v / (nVerts - 1);
              const ahead = vt - pulseT;               // positive = ahead of pulse
              const behind = pulseT - vt;              // positive = behind pulse

              // Sharp bright head + fading trail behind
              let intensity = 0;
              if (Math.abs(ahead) < pulseWidth) {
                intensity = 1.0 - Math.abs(ahead) / pulseWidth;
              } else if (behind > 0 && behind < trailLen) {
                intensity = (1.0 - behind / trailLen) * 0.5; // dimmer trail
              }
              intensity *= intensity; // quadratic falloff for sharper look

              // Blend base heat color toward bright white/cyan pulse
              colors[v * 3]     = base[v * 3]     + (1.0 - base[v * 3])     * intensity;
              colors[v * 3 + 1] = base[v * 3 + 1] + (1.0 - base[v * 3 + 1]) * intensity;
              colors[v * 3 + 2] = base[v * 3 + 2] + (0.95 - base[v * 3 + 2]) * intensity * 0.7;
            }

            geo.setColors(colors);
            mat.opacity = getEdgeOpacity(edge.weight) * (0.8 + 0.2 * (1.0 - cycleTime / fireDuration));
          } else {
            // ── QUIET — subtle breathing, restore base heat colors ──
            const breathPhase = i * 1.618;
            const breathSpeed = 0.4 + (i % 7) * 0.08;
            const breath = 0.5 + 0.5 * Math.sin(t * breathSpeed + breathPhase);

            for (let v = 0; v < nVerts * 3; v++) {
              colors[v] = base[v];
            }
            geo.setColors(colors);
            mat.opacity = getEdgeOpacity(edge.weight) * (0.55 + breath * 0.45);
          }
          mat.needsUpdate = true;
        }
      }
    }

    cameraController.tick(deltaS * 1000);
    setCameraMode(hud, cameraController.state);
  });

  // ── WebSocket ───────────────────────────────────────────────────────────────

  const ws = connect('ws://localhost:3747/ws', sceneRef, () => true);
  ws.applyPendingSnapshot(sceneRef);
  setConnectionStatus(hud, 'unknown');
}

main();
