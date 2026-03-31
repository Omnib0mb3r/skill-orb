import * as THREE from 'three';
import { createScene } from '../webview/renderer';
import { updateGraph, getGraphInstance, initOrb, updateRenderPositions, getNodePosition } from '../webview/orb';
import { initAnimation, onConnectionNew, onSnapshot, tickBreathing } from '../webview/animation';
import { nodeIndexMap, setNodeColor, resetNodeColors } from '../webview/nodes';
import { createCameraController } from '../webview/camera';
import { createHud, setConnectionStatus, setCameraMode, updateVoiceButton } from '../webview/hud';
import { evaluateQuery, detectVoiceIntent } from '../webview/search';
import { initVoice } from '../webview/voice';
import {
  createTooltip,
  buildInstanceMaps,
  buildNodeDataMap,
  registerNodeInteractions,
} from '../webview/nodeActions';
import { buildAnimationTick } from './animationTick';
import type { WsMessage, GraphNode, GraphEdge } from './types';
import type { SearchResult } from '../webview/search';
import type { InstanceMaps } from '../webview/nodeActions';

const canvas = document.getElementById('devneural-canvas') as HTMLCanvasElement;
const { scene, camera, controls, startAnimationLoop } = createScene(canvas);

const graphOrb = getGraphInstance();
scene.add(graphOrb);

const meshes = initOrb(scene);
initAnimation(scene);

// Camera controller
const cameraController = createCameraController(camera, controls, getNodePosition);

// State
let lastNodes: GraphNode[] = [];
let lastEdges: GraphEdge[] = [];
let lastNodeData: Map<string, GraphNode> = new Map();
let lastInstanceMaps: InstanceMaps = { project: new Map(), tool: new Map(), skill: new Map() };

const tooltip = createTooltip();
document.body.appendChild(tooltip.getElement());

function applySearchVisuals(result: SearchResult): void {
  if (result.matchingNodeIds.size === 0) {
    resetNodeColors(meshes, nodeIndexMap);
    return;
  }
  for (const [id] of nodeIndexMap) {
    if (result.matchingNodeIds.has(id)) {
      setNodeColor(id, new THREE.Color(0xffffff), meshes, nodeIndexMap);
    } else {
      setNodeColor(id, new THREE.Color(0x222222), meshes, nodeIndexMap);
    }
  }
  if (cameraController.state !== 'manual') {
    const positions = [...result.matchingNodeIds]
      .map(id => getNodePosition(id))
      .filter((p): p is THREE.Vector3 => p !== null);
    if (positions.length > 0) {
      const centroid = positions
        .reduce((sum, p) => sum.add(p), new THREE.Vector3())
        .divideScalar(positions.length);
      const radius = Math.max(...positions.map(p => p.distanceTo(centroid)), 10);
      cameraController.focusOnCluster(centroid, radius);
    }
  }
}

const hudElements = createHud({
  onReturnToAuto: () => {
    cameraController.returnToAuto();
    setCameraMode(hudElements, cameraController.state);
  },
  onSearchQuery: (q) => {
    if (q.trim() === '') {
      resetNodeColors(meshes, nodeIndexMap);
    } else {
      applySearchVisuals(evaluateQuery(q, lastNodes, lastEdges));
    }
  },
});

// Voice
const voiceController = initVoice({
  onTranscript: (text) => {
    const intent = detectVoiceIntent(text);
    if (intent.action === 'search' && intent.query) {
      hudElements.searchInput.value = intent.query;
      applySearchVisuals(evaluateQuery(intent.query, lastNodes, lastEdges));
    } else if (intent.action === 'returnToAuto') {
      cameraController.returnToAuto();
      setCameraMode(hudElements, cameraController.state);
    } else if (intent.action === 'focus' && intent.target) {
      applySearchVisuals(evaluateQuery(intent.target, lastNodes, lastEdges));
    }
  },
  onStatusChange: (status) => updateVoiceButton(hudElements.voiceButton, status),
});

if (voiceController === null) {
  updateVoiceButton(hudElements.voiceButton, 'unavailable');
}

hudElements.voiceButton.addEventListener('click', () => {
  if (voiceController?.status === 'listening') voiceController.stopListening();
  else voiceController?.startListening();
});

// Node interactions
registerNodeInteractions({
  canvas,
  camera,
  meshes,
  cameraController,
  tooltip,
  getNodeData: () => lastNodeData,
  getEdgeData: () => lastEdges,
  getInstanceMaps: () => lastInstanceMaps,
});

// User drag → manual camera mode
controls.addEventListener('start', () => {
  cameraController.onUserInteraction();
  setCameraMode(hudElements, cameraController.state);
});

// Animation loop — motion freezes when camera is manual
startAnimationLoop(buildAnimationTick({
  graphTickFrame: () => graphOrb.tickFrame(),
  updateRenderPositions,
  tickBreathing,
  cameraController,
}));

// WebSocket
function connect(): void {
  const ws = new WebSocket('ws://localhost:3747/ws');

  ws.onopen = () => {
    setConnectionStatus(hudElements, 'connected');
    setCameraMode(hudElements, cameraController.state);
  };

  ws.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as WsMessage;
      if (msg.type === 'graph:snapshot') {
        lastNodes = msg.payload.nodes;
        lastEdges = msg.payload.edges;
        lastNodeData = buildNodeDataMap(lastNodes);
        lastInstanceMaps = buildInstanceMaps(nodeIndexMap, meshes);
        updateGraph(msg.payload);
        onSnapshot(msg.payload.edges.map(e => ({
          id: e.id,
          last_seen: new Date(e.last_seen).getTime(),
        })));
        setCameraMode(hudElements, cameraController.state);
      }
      if (msg.type === 'connection:new') {
        onConnectionNew({
          source: msg.payload.source,
          target: msg.payload.target,
          connectionType: msg.payload.connection_type,
        });
      }
    } catch {
      // ignore malformed messages
    }
  };

  ws.onclose = () => {
    setConnectionStatus(hudElements, 'disconnected');
    setTimeout(connect, 2000);
  };
}

connect();
