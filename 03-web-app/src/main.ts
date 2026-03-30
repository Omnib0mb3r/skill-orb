import * as THREE from 'three';
import { initRenderer } from './orb/renderer';
import { initHud } from './ui/hud';
import { connect } from './ws/client';
import { build } from './graph/builder';
import type { BuildResult, GraphData } from './graph/builder';
import type { SceneRef } from './ws/handlers';
import type { GraphSnapshot } from './types';
import { onHover, onClick } from './orb/interaction';
import type { InteractionState } from './orb/interaction';
import type { OrbNode } from './graph/types';
import { getMaterialForNodeType, highlightMaterialConfig } from './orb/visuals';

type AppState = BuildResult & { selectedNodeId: string | null };

let currentBuild: AppState | null = null;

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

function applyHighlightMaterials(build: AppState): void {
  for (const [id, mesh] of build.meshes) {
    const node = build.nodes.get(id);
    if (!node) continue;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (build.highlightedNodeIds.has(id)) {
      mat.color.setHex(highlightMaterialConfig.color);
      mat.opacity = highlightMaterialConfig.opacity;
      mat.emissiveIntensity = highlightMaterialConfig.emissiveIntensity ?? 0.6;
    } else {
      const cfg = getMaterialForNodeType(node.type);
      mat.color.setHex(cfg.color);
      mat.opacity = cfg.opacity;
      mat.emissiveIntensity = cfg.emissiveIntensity ?? 0.1;
    }
  }
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

function main(): void {
  const existingCanvas = document.getElementById('devneural-canvas') as HTMLCanvasElement | null;
  const canvas: HTMLCanvasElement = existingCanvas ?? (() => {
    const c = document.createElement('canvas');
    document.body.appendChild(c);
    return c;
  })();

  const { renderer, scene, camera } = initRenderer(canvas);

  const sceneRef: SceneRef = {
    clear() {
      if (!currentBuild) return;
      clearBuild(scene, currentBuild);
      currentBuild = null;
    },

    rebuild(snapshot: GraphSnapshot) {
      sceneRef.clear();
      const result = build(toGraphData(snapshot), scene);
      currentBuild = { ...result, selectedNodeId: null };
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

    setFocusNode(nodeId: string) {
      if (!currentBuild) return;
      currentBuild.focusedNodeId = nodeId;
      const mesh = currentBuild.meshes.get(nodeId);
      if (mesh) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.color.setHex(highlightMaterialConfig.color);
        mat.opacity = highlightMaterialConfig.opacity;
        mat.emissiveIntensity = highlightMaterialConfig.emissiveIntensity ?? 0.6;
      }
    },

    setHighlightNodes(nodeIds: string[]) {
      if (!currentBuild) return;
      currentBuild.highlightedNodeIds = new Set(nodeIds);
      applyHighlightMaterials(currentBuild);
    },

    clearHighlights() {
      if (!currentBuild) return;
      currentBuild.highlightedNodeIds.clear();
      currentBuild.focusedNodeId = null;
      applyHighlightMaterials(currentBuild);
    },

    resetCamera() {
      camera.position.set(0, 0, 20);
      camera.lookAt(0, 0, 0);
    },
  };

  // Raycaster for pointer events
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function getMeshNode(clientX: number, clientY: number): OrbNode | null {
    if (!currentBuild) return null;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const meshList = [...currentBuild.meshes.values()];
    const hits = raycaster.intersectObjects(meshList);
    if (hits.length === 0) return null;
    const hitMesh = hits[0].object as THREE.Mesh;
    for (const [id, mesh] of currentBuild.meshes) {
      if (mesh === hitMesh) return currentBuild.nodes.get(id) ?? null;
    }
    return null;
  }

  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    const istate = currentBuild as InteractionState | null;
    if (istate) onHover(getMeshNode(e.clientX, e.clientY), istate);
  });

  canvas.addEventListener('click', (e: MouseEvent) => {
    const istate = currentBuild as InteractionState | null;
    if (istate) onClick(getMeshNode(e.clientX, e.clientY), istate, camera);
  });

  initHud();

  let sceneReady = false;

  function animate(): void {
    requestAnimationFrame(animate);
    if (currentBuild) {
      currentBuild.simulation.tick();
      for (let i = 0; i < currentBuild.edgeMeshes.length; i++) {
        const line = currentBuild.edgeMeshes[i];
        const edge = currentBuild.edges[i];
        if (!edge) continue;
        const srcMesh = currentBuild.meshes.get(edge.sourceId);
        const tgtMesh = currentBuild.meshes.get(edge.targetId);
        if (!srcMesh || !tgtMesh) continue;
        const posAttr = line.geometry.attributes.position as THREE.BufferAttribute;
        if (posAttr) {
          posAttr.setXYZ(0, srcMesh.position.x, srcMesh.position.y, srcMesh.position.z);
          posAttr.setXYZ(1, tgtMesh.position.x, tgtMesh.position.y, tgtMesh.position.z);
          posAttr.needsUpdate = true;
        }
      }
    }
    renderer.render(scene, camera);
  }

  animate();
  sceneReady = true;

  const ws = connect('ws://localhost:3747/ws', sceneRef, () => sceneReady);
  ws.applyPendingSnapshot(sceneRef);
}

main();
