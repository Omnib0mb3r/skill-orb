import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: vi.fn(() => ({
    enableDamping: false,
    dampingFactor: 0,
    minDistance: 0,
    maxDistance: 0,
    update: vi.fn(),
    reset: vi.fn(),
  })),
}));

vi.mock('three', () => ({
  WebGLRenderer: vi.fn(() => ({
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
  })),
  Scene: vi.fn(() => ({
    add: vi.fn(),
    background: null,
  })),
  PerspectiveCamera: vi.fn(() => ({
    position: { z: 0 },
    aspect: 1,
    updateProjectionMatrix: vi.fn(),
  })),
  AmbientLight: vi.fn(() => ({})),
  DirectionalLight: vi.fn(() => ({
    position: { set: vi.fn() },
  })),
  Color: vi.fn(),
}));

import * as THREE from 'three';
import { initRenderer } from '../../src/orb/renderer';

describe('initRenderer(canvas)', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    vi.clearAllMocks();
    canvas = {} as HTMLCanvasElement;
    vi.stubGlobal('window', {
      devicePixelRatio: 1,
      innerWidth: 1024,
      innerHeight: 768,
      addEventListener: vi.fn(),
    });
  });

  it('returns an object with scene, camera, renderer properties', () => {
    const state = initRenderer(canvas);
    expect(state).toHaveProperty('scene');
    expect(state).toHaveProperty('camera');
    expect(state).toHaveProperty('renderer');
  });

  it('scene is a THREE.Scene instance (constructor called once)', () => {
    initRenderer(canvas);
    expect(THREE.Scene).toHaveBeenCalledTimes(1);
  });

  it('camera is a THREE.PerspectiveCamera instance', () => {
    initRenderer(canvas);
    expect(THREE.PerspectiveCamera).toHaveBeenCalledTimes(1);
  });

  it('renderer is a THREE.WebGLRenderer instance constructed with the provided canvas', () => {
    initRenderer(canvas);
    expect(THREE.WebGLRenderer).toHaveBeenCalledTimes(1);
    expect(THREE.WebGLRenderer).toHaveBeenCalledWith(expect.objectContaining({ canvas }));
  });

  it('lights: at least one AmbientLight and one DirectionalLight added to scene', () => {
    initRenderer(canvas);
    expect(THREE.AmbientLight).toHaveBeenCalledTimes(1);
    expect(THREE.DirectionalLight).toHaveBeenCalledTimes(1);
    const sceneMock = vi.mocked(THREE.Scene).mock.results[0].value as { add: ReturnType<typeof vi.fn> };
    expect(sceneMock.add).toHaveBeenCalledTimes(2);
  });
});
