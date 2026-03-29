import * as THREE from 'three';
import { createScene } from '../webview/renderer';
import { updateGraph, getGraphInstance, initOrb, updateRenderPositions, getNodePosition } from '../webview/orb';
import { initAnimation, onConnectionNew, onSnapshot, tickBreathing } from '../webview/animation';
import { nodeIndexMap, setNodeColor, resetNodeColors } from '../webview/nodes';
import { createCameraController } from '../webview/camera';
import { createHud, setConnectionStatus, setCameraMode } from '../webview/hud';
import { evaluateQuery } from '../webview/search';
import {
  createTooltip,
  buildInstanceMaps,
  buildNodeDataMap,
  registerNodeInteractions,
} from '../webview/nodeActions';
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

// HUD — created before wiring controls events so listeners can reference hudElements
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
      // Dark blue-gray: visible but de-emphasized against near-black background
      setNodeColor(id, new THREE.Color(0x3a3a4a), meshes, nodeIndexMap);
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
      const radius = Math.max(
        ...positions.map(p => p.distanceTo(centroid)),
        10,
      );
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
  applyVisuals: (connectedIds) => {
    const result: SearchResult = {
      matchingNodeIds: new Set(connectedIds),
      matchingEdgeIds: new Set(
        lastEdges
          .filter(e => connectedIds.includes(e.source) || connectedIds.includes(e.target))
          .map(e => e.id),
      ),
    };
    applySearchVisuals(result);
  },
});

// Wire controls after HUD exists so the listener can reference hudElements
controls.addEventListener('start', () => {
  cameraController.onUserInteraction();
  setCameraMode(hudElements, cameraController.state);
});

startAnimationLoop((delta: number) => {
  graphOrb.tickFrame();
  updateRenderPositions();
  tickBreathing(delta * 1000);
  cameraController.tick(delta * 1000);
});

// Browser WebSocket — connects to the DevNeural Python server
const WS_URL = 'ws://localhost:27182';

function connect(): void {
  const ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setConnectionStatus(hudElements, 'connected');
  };

  ws.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as WsMessage;
      if (msg.type === 'graph:snapshot') {
        lastNodes = msg.payload.nodes;
        lastEdges = msg.payload.edges;
        updateGraph(msg.payload);
        // Build maps AFTER updateGraph so nodeIndexMap is populated by setNodePositions
        lastNodeData = buildNodeDataMap(lastNodes);
        lastInstanceMaps = buildInstanceMaps(nodeIndexMap, meshes);
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
