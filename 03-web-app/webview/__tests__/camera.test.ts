import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createCameraController } from '../camera';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

function makeMocks() {
  const camera = {
    position: new THREE.Vector3(0, 0, 300),
    updateProjectionMatrix: vi.fn(),
  } as unknown as THREE.PerspectiveCamera;

  const controls = {
    target: new THREE.Vector3(0, 0, 0),
    update: vi.fn(),
  } as unknown as OrbitControls;

  const getNodePosition = vi.fn((_id: string): THREE.Vector3 | null => null);

  return { camera, controls, getNodePosition };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CameraController state machine', () => {
  it('starts in full-sphere state on init', () => {
    const { camera, controls, getNodePosition } = makeMocks();
    const ctrl = createCameraController(camera, controls, getNodePosition);
    expect(ctrl.state).toBe('full-sphere');
  });

  it('setActiveProjects([nodeId]) transitions camera to single-focus state', () => {
    const { camera, controls, getNodePosition } = makeMocks();
    getNodePosition.mockReturnValue(new THREE.Vector3(50, 0, 0));
    const ctrl = createCameraController(camera, controls, getNodePosition);
    ctrl.onActiveProjectsChanged(['node-1']);
    expect(ctrl.state).toBe('single-focus');
  });

  it('setActiveProjects([id1, id2]) transitions camera to multi-focus state', () => {
    const { camera, controls, getNodePosition } = makeMocks();
    getNodePosition.mockReturnValue(new THREE.Vector3(50, 0, 0));
    const ctrl = createCameraController(camera, controls, getNodePosition);
    ctrl.onActiveProjectsChanged(['node-1', 'node-2']);
    expect(ctrl.state).toBe('multi-focus');
  });

  it('setActiveProjects([]) transitions camera to full-sphere state', () => {
    const { camera, controls, getNodePosition } = makeMocks();
    getNodePosition.mockReturnValue(new THREE.Vector3(50, 0, 0));
    const ctrl = createCameraController(camera, controls, getNodePosition);
    ctrl.onActiveProjectsChanged(['node-1']);
    ctrl.onActiveProjectsChanged([]);
    expect(ctrl.state).toBe('full-sphere');
  });

  it('onUserInteraction() transitions camera to manual state', () => {
    const { camera, controls, getNodePosition } = makeMocks();
    const ctrl = createCameraController(camera, controls, getNodePosition);
    ctrl.onUserInteraction();
    expect(ctrl.state).toBe('manual');
  });

  it('returnToAuto() transitions camera to full-sphere from manual', () => {
    const { camera, controls, getNodePosition } = makeMocks();
    const ctrl = createCameraController(camera, controls, getNodePosition);
    ctrl.onUserInteraction();
    expect(ctrl.state).toBe('manual');
    ctrl.returnToAuto();
    expect(ctrl.state).toBe('full-sphere');
  });

  it('camera does NOT transition from manual when setActiveProjects fires while in manual', () => {
    const { camera, controls, getNodePosition } = makeMocks();
    getNodePosition.mockReturnValue(new THREE.Vector3(50, 0, 0));
    const ctrl = createCameraController(camera, controls, getNodePosition);
    ctrl.onUserInteraction();
    ctrl.onActiveProjectsChanged(['node-1']);
    expect(ctrl.state).toBe('manual');
  });
});
