import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type CameraState = 'full-sphere' | 'single-focus' | 'multi-focus' | 'manual';

export interface CameraController {
  readonly state: CameraState;
  onActiveProjectsChanged(nodeIds: string[]): void;
  onUserInteraction(): void;
  returnToAuto(overridePos?: THREE.Vector3, overrideTarget?: THREE.Vector3): void;
  focusOnCluster(centroid: THREE.Vector3, radius: number): void;
  tick(deltaMs: number): void;
}

export function createCameraController(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  getNodePosition: (nodeId: string) => THREE.Vector3 | null,
): CameraController {
  let _state: CameraState = 'full-sphere';

  // Lerp state
  const startPos = new THREE.Vector3();
  const startTarget = new THREE.Vector3();
  let targetPos: THREE.Vector3 | null = null;
  let targetLookAt: THREE.Vector3 | null = null;
  let elapsed = 0;
  const DURATION = 800;

  // Capture initial camera position as the "full-sphere" home
  const FULL_POS = camera.position.clone();
  const FULL_TARGET = controls.target.clone();

  function easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  function beginTransition(pos: THREE.Vector3, look: THREE.Vector3): void {
    startPos.copy(camera.position);
    startTarget.copy(controls.target);
    targetPos = pos.clone();
    targetLookAt = look.clone();
    elapsed = 0;
  }

  return {
    get state(): CameraState {
      return _state;
    },

    onActiveProjectsChanged(nodeIds: string[]): void {
      if (_state === 'manual') return;

      if (nodeIds.length === 0) {
        _state = 'full-sphere';
        beginTransition(FULL_POS, FULL_TARGET);
      } else if (nodeIds.length === 1) {
        _state = 'single-focus';
        const pos = getNodePosition(nodeIds[0]);
        if (pos) {
          const dist = FULL_POS.length() * 0.5;
          const dir = pos.clone().normalize();
          beginTransition(dir.multiplyScalar(dist), pos.clone());
        } else {
          beginTransition(FULL_POS, FULL_TARGET);
        }
      } else {
        _state = 'multi-focus';
        const positions = nodeIds
          .map(id => getNodePosition(id))
          .filter((p): p is THREE.Vector3 => p !== null);
        if (positions.length > 0) {
          const centroid = positions
            .reduce((sum, p) => sum.add(p), new THREE.Vector3())
            .divideScalar(positions.length);
          beginTransition(FULL_POS.clone().multiplyScalar(0.8), centroid);
        } else {
          beginTransition(FULL_POS, FULL_TARGET);
        }
      }
    },

    onUserInteraction(): void {
      _state = 'manual';
      targetPos = null;
      targetLookAt = null;
    },

    returnToAuto(overridePos?: THREE.Vector3, overrideTarget?: THREE.Vector3): void {
      _state = 'full-sphere';
      beginTransition(overridePos ?? FULL_POS, overrideTarget ?? FULL_TARGET);
    },

    focusOnCluster(centroid: THREE.Vector3, radius: number): void {
      if (_state === 'manual') return;
      const dist = radius * 3 + 50;
      const dir = centroid.clone().normalize();
      if (dir.length() < 0.001) dir.set(0, 0, 1);
      beginTransition(centroid.clone().add(dir.multiplyScalar(dist)), centroid.clone());
    },

    tick(deltaMs: number): void {
      if (!targetPos || !targetLookAt) return;
      elapsed += deltaMs;
      const t = Math.min(elapsed / DURATION, 1);
      const e = easeInOut(t);
      camera.position.lerpVectors(startPos, targetPos, e);
      controls.target.lerpVectors(startTarget, targetLookAt, e);
      controls.update();
      if (t >= 1) {
        targetPos = null;
        targetLookAt = null;
      }
    },
  };
}
