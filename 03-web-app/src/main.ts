import * as THREE from 'three';
import { createScene } from '../webview/renderer';
import { createCameraController } from '../webview/camera';
import { initVoice } from '../webview/voice';
import { detectVoiceIntent, evaluateQuery } from '../webview/search';
import { createTooltip, deriveGitHubUrl } from '../webview/nodeActions';
import { build } from './graph/builder';
import type { BuildResult, GraphData } from './graph/builder';
import { connect } from './ws/client';
import type { SceneRef } from './ws/handlers';
import type { GraphSnapshot, GraphNode, GraphEdge } from './types';
import { initHud, setConnectionStatus, setCameraMode, updateVoiceStatus } from './ui/hud';

// ── State ─────────────────────────────────────────────────────────────────────

type AppState = BuildResult & {
  selectedNodeId: string | null;
  nodeDataMap: Map<string, GraphNode>;
  edgeData: GraphEdge[];
};

let currentBuild: AppState | null = null;
let currentSnapshot: GraphSnapshot | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function toGraphData(snapshot: GraphSnapshot): GraphData {
  return {
    nodes: snapshot.nodes.map(n => ({ id: n.id, label: n.label, type: n.type })),
    edges: snapshot.edges.map(e => ({
      sourceId: e.source,
      targetId: e.target,
      weight: e.weight,
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
    const mat = line.material;
    if (Array.isArray(mat)) mat.forEach(m => m.dispose());
    else mat.dispose();
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
  camera.position.set(0, 0, 28);
  controls.update();

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
  hud.onReturnToAuto(() => cameraController.returnToAuto());
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

  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    pointerDownPos = { x: e.clientX, y: e.clientY };
  });

  canvas.addEventListener('pointerup', (e: PointerEvent) => {
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) return; // was a drag, not a click

    const hit = hitNodeAtPointer(e);
    if (!hit) { tooltip.hide(); return; }

    const { nodeId, graphNode } = hit;
    const edges = currentBuild?.edgeData ?? [];
    const rect = canvas.getBoundingClientRect();
    const screenPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (graphNode.type === 'project') {
      const url = deriveGitHubUrl(nodeId);
      if (url) window.open(url, '_blank');
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
    if (!currentSnapshot || !query.trim()) return;
    const result = evaluateQuery(query, currentSnapshot.nodes, currentSnapshot.edges);
    const projectMatches = [...result.matchingNodeIds].filter(
      id => currentBuild?.nodeDataMap.get(id)?.type === 'project',
    );
    if (projectMatches.length > 0) cameraController.onActiveProjectsChanged(projectMatches);
    hud.setMatchCount(result.matchingNodeIds.size);
  }

  // ── SceneRef (WebSocket callbacks) ─────────────────────────────────────────

  const sceneRef: SceneRef = {
    clear() {
      if (currentBuild) { clearBuild(scene, currentBuild); currentBuild = null; }
      currentSnapshot = null;
      hud.setCounts(0, 0);
    },

    rebuild(snapshot: GraphSnapshot) {
      if (currentBuild) clearBuild(scene, currentBuild);
      currentSnapshot = snapshot;
      const result = build(toGraphData(snapshot), scene);
      currentBuild = {
        ...result,
        selectedNodeId: null,
        nodeDataMap: new Map(snapshot.nodes.map(n => [n.id, n])),
        edgeData: snapshot.edges,
      };
      hud.setCounts(snapshot.nodes.length, snapshot.edges.length);
      setConnectionStatus(hud, 'connected');
    },

    addEdge(edge) {
      if (!currentBuild) return;
      const srcMesh = currentBuild.meshes.get(edge.source);
      const tgtMesh = currentBuild.meshes.get(edge.target);
      if (!srcMesh || !tgtMesh) return;
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setFromPoints([srcMesh.position, tgtMesh.position]);
      const lineMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.3 });
      const line = new THREE.Line(lineGeo, lineMat);
      scene.add(line);
      currentBuild.edgeMeshes.push(line);
      currentBuild.edges.push({ sourceId: edge.source, targetId: edge.target, weight: 1.0 });
    },

    setFocusNode(nodeId: string) { cameraController.onActiveProjectsChanged([nodeId]); },
    setHighlightNodes(nodeIds: string[]) { cameraController.onActiveProjectsChanged(nodeIds); },
    clearHighlights() { cameraController.returnToAuto(); },
    resetCamera() { cameraController.returnToAuto(); },
  };

  // ── Animation loop ──────────────────────────────────────────────────────────

  startAnimationLoop((deltaS: number) => {
    if (currentBuild) {
      currentBuild.simulation.tick();
      // Keep edge line endpoints in sync with physics positions
      for (let i = 0; i < currentBuild.edgeMeshes.length; i++) {
        const line = currentBuild.edgeMeshes[i];
        const edge = currentBuild.edges[i];
        if (!edge) continue;
        const src = currentBuild.meshes.get(edge.sourceId);
        const tgt = currentBuild.meshes.get(edge.targetId);
        if (!src || !tgt) continue;
        const pos = line.geometry.attributes['position'] as THREE.BufferAttribute;
        if (pos) {
          pos.setXYZ(0, src.position.x, src.position.y, src.position.z);
          pos.setXYZ(1, tgt.position.x, tgt.position.y, tgt.position.z);
          pos.needsUpdate = true;
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
