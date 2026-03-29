import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export const ORB_RADIUS = 120;

type ResizeCallback = (width: number, height: number) => void;
const resizeListeners: ResizeCallback[] = [];

/** Register a callback that fires whenever the canvas is resized. Used by LineMaterial. */
export function addResizeListener(cb: ResizeCallback): void {
  resizeListeners.push(cb);
}

export function createScene(canvas: HTMLCanvasElement): {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  startAnimationLoop(onTick: (delta: number) => void): void;
} {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);

  const distance = ORB_RADIUS / Math.sin((75 / 2) * (Math.PI / 180));
  const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 10000);
  camera.position.set(0, 0, distance);

  const scene = new THREE.Scene();

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(50, 50, 50);
  scene.add(dirLight);

  scene.fog = new THREE.FogExp2(0x0a0a0f, 0.003);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  new ResizeObserver(() => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    resizeListeners.forEach(cb => cb(w, h));
  }).observe(canvas);

  function startAnimationLoop(onTick: (delta: number) => void): void {
    const clock = new THREE.Clock();
    function frame() {
      requestAnimationFrame(frame);
      const delta = clock.getDelta();
      controls.update();
      onTick(delta);
      renderer.render(scene, camera);
    }
    frame();
  }

  return { scene, camera, renderer, controls, startAnimationLoop };
}
