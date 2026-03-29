// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mocks must be defined before importing the module under test.
// vi.hoisted lets us declare shared state that can be referenced in vi.mock factories.
const mocks = vi.hoisted(() => {
  const rendererInst = {
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    domElement: null as unknown as HTMLElement,
    _opts: {} as Record<string, unknown>,
  };
  const cameraInst = {
    position: { set: vi.fn() },
    aspect: 0,
    updateProjectionMatrix: vi.fn(),
  };
  const controlsInst = { enableDamping: false, update: vi.fn() };
  const sceneInst = { add: vi.fn(), fog: null as unknown };
  return { rendererInst, cameraInst, controlsInst, sceneInst };
});

vi.mock('three', () => ({
  WebGLRenderer: vi.fn().mockImplementation((opts: unknown) => {
    mocks.rendererInst._opts = (opts as Record<string, unknown>) ?? {};
    mocks.rendererInst.domElement = document.createElement('canvas');
    return mocks.rendererInst;
  }),
  PerspectiveCamera: vi.fn().mockImplementation(() => mocks.cameraInst),
  Scene: vi.fn().mockImplementation(() => mocks.sceneInst),
  AmbientLight: vi.fn().mockImplementation(() => ({})),
  DirectionalLight: vi.fn().mockImplementation(() => ({ position: { set: vi.fn() } })),
  FogExp2: vi.fn(),
  Clock: vi.fn().mockImplementation(() => ({ getDelta: vi.fn().mockReturnValue(0.016) })),
}));

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: vi.fn().mockImplementation(() => mocks.controlsInst),
}));

// Import AFTER mocks are set up
import { ORB_RADIUS, createScene } from '../renderer';

describe('renderer.ts', () => {
  let canvas: HTMLCanvasElement;
  let resizeCallback: (() => void) | null = null;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 600, configurable: true });

    vi.clearAllMocks();
    resizeCallback = null;

    // Mock ResizeObserver (not implemented in jsdom)
    global.ResizeObserver = vi.fn().mockImplementation((cb: () => void) => {
      resizeCallback = cb;
      return { observe: vi.fn(), disconnect: vi.fn() };
    });
  });

  it('creates WebGLRenderer with antialias: true', () => {
    createScene(canvas);
    expect(mocks.rendererInst._opts).toMatchObject({ antialias: true });
  });

  it('positions camera at distance that frames ORB_RADIUS sphere (75° FOV)', () => {
    createScene(canvas);
    const expectedDistance = ORB_RADIUS / Math.sin((75 / 2) * (Math.PI / 180));
    const [x, y, z] = (mocks.cameraInst.position.set as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(x).toBe(0);
    expect(y).toBe(0);
    expect(z).toBeCloseTo(expectedDistance, 1);
  });

  it('creates OrbitControls with enableDamping: true', () => {
    createScene(canvas);
    expect(mocks.controlsInst.enableDamping).toBe(true);
  });

  it('ResizeObserver callback updates renderer size and camera aspect ratio', () => {
    createScene(canvas);
    expect(resizeCallback).not.toBeNull();

    // Update canvas dimensions and trigger resize
    Object.defineProperty(canvas, 'clientWidth', { value: 1280, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 720, configurable: true });
    resizeCallback!();

    expect(mocks.rendererInst.setSize).toHaveBeenCalledWith(1280, 720);
    expect(mocks.cameraInst.updateProjectionMatrix).toHaveBeenCalled();
    expect(mocks.cameraInst.aspect).toBeCloseTo(1280 / 720, 3);
  });
});
