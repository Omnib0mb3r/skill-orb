import { createScene } from '../webview/renderer';
import {
  initOrb,
  updateRenderPositions,
  updateGraph,
  getGraphInstance,
  getNodePosition,
} from '../webview/orb';
import { createCameraController } from '../webview/camera';
import { initVoice } from '../webview/voice';
import {
  initAnimation,
  tickBreathing,
  onConnectionNew,
  onSnapshot,
} from '../webview/animation';
import {
  createTooltip,
  registerNodeInteractions,
  buildNodeDataMap,
  buildInstanceMaps,
} from '../webview/nodeActions';
import { evaluateQuery, detectVoiceIntent } from '../webview/search';
import { nodeIndexMap } from '../webview/nodes';
import { connect } from './ws/client';
import type { SceneRef } from './ws/handlers';
import type { GraphSnapshot, GraphEdge, GraphNode } from './types';
import { initHud, setConnectionStatus, setCameraMode, updateVoiceStatus } from './ui/hud';

function main(): void {
  const canvas =
    (document.getElementById('devneural-canvas') as HTMLCanvasElement | null) ??
    (() => {
      const c = document.createElement('canvas');
      Object.assign(c.style, {
        position: 'fixed',
        inset: '0',
        width: '100%',
        height: '100%',
      });
      document.body.appendChild(c);
      return c;
    })();

  const { scene, camera, renderer: _renderer, controls, startAnimationLoop } = createScene(canvas);
  const meshes = initOrb(scene);
  const graph = getGraphInstance();

  const hud = initHud();

  const cameraController = createCameraController(camera, controls, getNodePosition);

  const tooltip = createTooltip();
  document.body.appendChild(tooltip.getElement());

  const voice = initVoice({
    onTranscript(text: string) {
      const intent = detectVoiceIntent(text);
      if (intent.action === 'returnToAuto') {
        cameraController.returnToAuto();
      } else if (intent.action === 'focus' && intent.target) {
        applySearch(intent.target);
      } else if (intent.action === 'search' && intent.query) {
        applySearch(intent.query);
        hud.setSearchValue(intent.query);
      }
    },
    onStatusChange(status) {
      updateVoiceStatus(hud, status);
    },
  });

  if (!voice) {
    updateVoiceStatus(hud, 'unavailable');
  }

  hud.onVoiceClick(() => {
    if (!voice) return;
    if (voice.status === 'listening') voice.stopListening();
    else voice.startListening();
  });

  hud.onReturnToAuto(() => {
    cameraController.returnToAuto();
  });

  hud.onSearch((query: string) => {
    applySearch(query);
  });

  initAnimation(scene);

  let currentSnapshot: GraphSnapshot | null = null;
  let nodeDataMap: Map<string, GraphNode> = new Map();
  let edgeData: GraphEdge[] = [];

  function applySearch(query: string): void {
    if (!currentSnapshot) return;
    if (query.trim() === '') return;
    const result = evaluateQuery(query, currentSnapshot.nodes, currentSnapshot.edges);
    const projectMatches = [...result.matchingNodeIds].filter(
      id => nodeDataMap.get(id)?.type === 'project',
    );
    if (projectMatches.length > 0) {
      cameraController.onActiveProjectsChanged(projectMatches);
    }
    hud.setMatchCount(result.matchingNodeIds.size);
  }

  const sceneRef: SceneRef = {
    clear() {
      currentSnapshot = null;
      nodeDataMap = new Map();
      edgeData = [];
      hud.setCounts(0, 0);
    },

    rebuild(snapshot: GraphSnapshot) {
      currentSnapshot = snapshot;
      nodeDataMap = buildNodeDataMap(snapshot.nodes);
      edgeData = snapshot.edges;
      updateGraph(snapshot);
      onSnapshot(
        snapshot.edges.map(e => ({
          id: e.id,
          last_seen:
            typeof e.last_seen === 'number' ? e.last_seen : Date.parse(e.last_seen as string),
        })),
      );
      hud.setCounts(snapshot.nodes.length, snapshot.edges.length);
      setConnectionStatus(hud, 'connected');
    },

    addEdge(edge) {
      onConnectionNew({
        source: edge.source,
        target: edge.target,
        connectionType: edge.connection_type,
      });
    },

    setFocusNode(nodeId: string) {
      cameraController.onActiveProjectsChanged([nodeId]);
    },

    setHighlightNodes(nodeIds: string[]) {
      cameraController.onActiveProjectsChanged(nodeIds);
    },

    clearHighlights() {
      cameraController.returnToAuto();
    },

    resetCamera() {
      cameraController.returnToAuto();
    },
  };

  registerNodeInteractions({
    canvas,
    camera,
    meshes,
    cameraController,
    tooltip,
    getNodeData: () => nodeDataMap,
    getEdgeData: () => edgeData,
    getInstanceMaps: () => buildInstanceMaps(nodeIndexMap, meshes),
    applyVisuals(nodeIds: string[]) {
      cameraController.onActiveProjectsChanged(nodeIds);
    },
  });

  // Only switch to manual camera when the user actually drags (not on every click)
  controls.addEventListener('start', () => {
    cameraController.onUserInteraction();
  });

  let elapsedMs = 0;
  startAnimationLoop((deltaS: number) => {
    elapsedMs += deltaS * 1000;
    graph.tickFrame();
    updateRenderPositions();
    tickBreathing(elapsedMs);
    cameraController.tick(deltaS * 1000);
    setCameraMode(hud, cameraController.state);
  });

  const ws = connect('ws://localhost:3747/ws', sceneRef, () => true);
  ws.applyPendingSnapshot(sceneRef);

  setConnectionStatus(hud, 'unknown');
}

main();
