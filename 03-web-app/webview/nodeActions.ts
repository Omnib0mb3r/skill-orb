import * as THREE from 'three';
import type { GraphNode, GraphEdge } from '../src/types';
import type { CameraController } from './camera';

export interface TooltipController {
  show(node: GraphNode, edges: GraphEdge[], x: number, y: number): void;
  hide(): void;
  getElement(): HTMLElement;
}

// ── Pure helper functions ─────────────────────────────────────────────────────

/**
 * Returns the nodeId associated with a given instanceIndex in an InstancedMesh,
 * or undefined if out of range.
 * @param _mesh - reserved for future per-mesh disambiguation (currently unused)
 */
export function mapInstanceToNodeId(
  _mesh: THREE.InstancedMesh,
  instanceIndex: number,
  instanceMap: Map<number, string>,
): string | undefined {
  return instanceMap.get(instanceIndex);
}

/**
 * Derives a navigable GitHub URL from a node ID, or null if not applicable.
 * Only returns http: or https: URLs — rejects all other schemes.
 */
export function deriveGitHubUrl(nodeId: string): string | null {
  const stripped = nodeId.replace(/^(project|tool|skill):/, '');
  if (stripped.startsWith('https://') || stripped.startsWith('http://')) return stripped;
  if (stripped.startsWith('github.com')) return `https://${stripped}`;
  return null;
}

/**
 * Projects a 3D world position to canvas pixel coordinates.
 */
export function projectToScreen(
  worldPos: THREE.Vector3,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const ndc = worldPos.clone().project(camera);
  return {
    x: (ndc.x + 1) / 2 * canvas.clientWidth,
    y: (-ndc.y + 1) / 2 * canvas.clientHeight,
  };
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

export function createTooltip(): TooltipController {
  const el = document.createElement('div');
  el.className = 'dn-tooltip';
  Object.assign(el.style, {
    position: 'absolute',
    display: 'none',
    pointerEvents: 'none',
    background: 'rgba(10,10,20,0.92)',
    border: '1px solid #333',
    borderRadius: '6px',
    color: '#e0e0e0',
    fontFamily: 'monospace',
    fontSize: '16px',
    padding: '14px 20px',
    lineHeight: '1.6',
    maxWidth: '520px',
    zIndex: '100',
  });

  return {
    show(node: GraphNode, edges: GraphEdge[], x: number, y: number): void {
      const connectionCount = edges.filter(
        e => e.source === node.id || e.target === node.id
      ).length;
      const url = deriveGitHubUrl(node.id);

      // Build with DOM nodes (not innerHTML) to prevent XSS from WebSocket data
      el.textContent = '';

      const labelEl = document.createElement('strong');
      labelEl.textContent = node.label;
      el.appendChild(labelEl);

      function appendLine(label: string, value: string): void {
        el.appendChild(document.createElement('br'));
        const labelSpan = document.createElement('span');
        labelSpan.style.color = '#888';
        labelSpan.textContent = `${label}: `;
        el.appendChild(labelSpan);
        const valueSpan = document.createElement('span');
        valueSpan.textContent = value;
        el.appendChild(valueSpan);
      }

      appendLine('type', node.type);
      appendLine('connections', String(connectionCount));
      if (node.stage) appendLine('stage', node.stage);

      if (url) {
        el.appendChild(document.createElement('br'));
        const a = document.createElement('a');
        a.href = url; // safe: deriveGitHubUrl only emits https:// or http:// URLs
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = 'open ↗';
        a.style.color = '#5af';
        a.style.pointerEvents = 'auto';
        el.appendChild(a);
      }

      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(y)}px`;
      el.style.display = 'block';
    },

    hide(): void {
      el.style.display = 'none';
    },

    getElement(): HTMLElement {
      return el;
    },
  };
}

// ── Click handler ─────────────────────────────────────────────────────────────

/**
 * Handles a resolved node click — dispatches based on node type.
 * Injectable openUrl and applyVisuals allow testing without real browser APIs.
 */
export function handleNodeClick(
  nodeId: string,
  node: GraphNode,
  connectedProjectIds: string[],
  screenPos: { x: number; y: number },
  edges: GraphEdge[],
  cameraController: Pick<CameraController, 'onActiveProjectsChanged'>,
  tooltip: TooltipController,
  openUrl: (url: string, target: string) => void,
  applyVisuals?: (nodeIds: string[]) => void,
): void {
  if (node.type === 'project') {
    const url = deriveGitHubUrl(nodeId);
    if (url) {
      openUrl(url, '_blank');
    } else {
      tooltip.show(node, edges, screenPos.x, screenPos.y);
    }
  } else {
    // tool or skill: focus camera and highlight connected project nodes
    cameraController.onActiveProjectsChanged(connectedProjectIds);
    applyVisuals?.(connectedProjectIds);
  }
}

// ── Instance maps (per-mesh index → nodeId) ───────────────────────────────────

export interface InstanceMaps {
  project: Map<number, string>;
  tool: Map<number, string>;
  skill: Map<number, string>;
}

/**
 * Inverts nodeIndexMap (nodeId → {mesh, index}) into per-mesh maps (index → nodeId).
 * Must be called AFTER updateGraph() so that nodeIndexMap is populated.
 */
export function buildInstanceMaps(
  nodeIndexMap: Map<string, { mesh: THREE.InstancedMesh; index: number }>,
  meshes: { projectMesh: THREE.InstancedMesh; toolMesh: THREE.InstancedMesh; skillMesh: THREE.InstancedMesh },
): InstanceMaps {
  const maps: InstanceMaps = { project: new Map(), tool: new Map(), skill: new Map() };
  for (const [nodeId, { mesh, index }] of nodeIndexMap) {
    if (mesh === meshes.projectMesh) maps.project.set(index, nodeId);
    else if (mesh === meshes.toolMesh) maps.tool.set(index, nodeId);
    else maps.skill.set(index, nodeId); // skill or future types
  }
  return maps;
}

// ── Event registration ────────────────────────────────────────────────────────

interface RegisterDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  meshes: { projectMesh: THREE.InstancedMesh; toolMesh: THREE.InstancedMesh; skillMesh: THREE.InstancedMesh };
  cameraController: CameraController;
  tooltip: TooltipController;
  getNodeData: () => Map<string, GraphNode>;
  getEdgeData: () => GraphEdge[];
  getInstanceMaps: () => InstanceMaps;
  applyVisuals?: (nodeIds: string[]) => void;
}

/**
 * Wires canvas pointer events for click and hover node interactions.
 * Not tested directly — tested through the pure helpers above.
 */
export function registerNodeInteractions(deps: RegisterDeps): void {
  const { canvas, camera, meshes, cameraController, tooltip } = deps;
  const tooltipEl = tooltip.getElement(); // reference for clamp calculations
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let pointerDownPos = { x: 0, y: 0 };

  function getMeshList(): THREE.InstancedMesh[] {
    return [meshes.projectMesh, meshes.toolMesh, meshes.skillMesh];
  }

  function pointerToNDC(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function resolveHit(e: PointerEvent): {
    nodeId: string;
    node: GraphNode;
    instanceId: number;
    hitMesh: THREE.InstancedMesh;
  } | null {
    pointerToNDC(e);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(getMeshList(), false);
    if (hits.length === 0 || hits[0].instanceId === undefined) return null;

    const hit = hits[0];
    const hitMesh = hit.object as THREE.InstancedMesh;
    const maps = deps.getInstanceMaps();
    const mapForMesh =
      hitMesh === meshes.projectMesh ? maps.project :
      hitMesh === meshes.toolMesh    ? maps.tool    :
      maps.skill;

    const nodeId = mapInstanceToNodeId(hitMesh, hit.instanceId as number, mapForMesh);
    if (!nodeId) return null;
    const node = deps.getNodeData().get(nodeId);
    if (!node) return null;
    return { nodeId, node, instanceId: hit.instanceId as number, hitMesh };
  }

  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    pointerDownPos = { x: e.clientX, y: e.clientY };
  });

  canvas.addEventListener('pointerup', (e: PointerEvent) => {
    // Skip if pointer dragged > 5px (orbit gesture, not click)
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) return;

    const hit = resolveHit(e);
    if (!hit) return;

    const edges = deps.getEdgeData();
    const nodeData = deps.getNodeData();
    const connectedProjectIds = edges
      .filter(edge => edge.source === hit.nodeId || edge.target === hit.nodeId)
      .flatMap(edge => {
        const other = edge.source === hit.nodeId ? edge.target : edge.source;
        const otherNode = nodeData.get(other);
        return otherNode?.type === 'project' ? [other] : [];
      });

    const rect = canvas.getBoundingClientRect();
    const screenPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    handleNodeClick(
      hit.nodeId,
      hit.node,
      connectedProjectIds,
      screenPos,
      edges,
      cameraController,
      tooltip,
      (url, target) => window.open(url, target),
      deps.applyVisuals,
    );
  });

  let lastMoveTime = 0;
  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    const now = performance.now();
    if (now - lastMoveTime < 16) return; // ~60fps throttle
    lastMoveTime = now;

    const hit = resolveHit(e);
    if (!hit) {
      tooltip.hide();
      return;
    }

    // Read instance matrix directly using instanceId (O(1), not O(n) scan)
    const nodePos = new THREE.Vector3();
    const mat = new THREE.Matrix4();
    hit.hitMesh.getMatrixAt(hit.instanceId, mat);
    nodePos.setFromMatrixPosition(mat);

    const rect = canvas.getBoundingClientRect();
    const screen = projectToScreen(
      nodePos,
      camera,
      { clientWidth: rect.width, clientHeight: rect.height } as HTMLCanvasElement,
    );

    // Clamp to canvas bounds using actual rendered element dimensions
    const tooltipW = tooltipEl.offsetWidth || 270;
    const tooltipH = tooltipEl.offsetHeight || 80;
    const clampedX = Math.max(0, Math.min(rect.width - tooltipW, screen.x));
    const clampedY = Math.max(0, Math.min(rect.height - tooltipH, screen.y));

    tooltip.show(hit.node, deps.getEdgeData(), clampedX, clampedY);
  });

  canvas.addEventListener('pointerleave', () => {
    tooltip.hide();
  });

}

// ── Utility: build GraphNode lookup map for snapshot ─────────────────────────

export function buildNodeDataMap(nodes: GraphNode[]): Map<string, GraphNode> {
  return new Map(nodes.map(n => [n.id, n]));
}
