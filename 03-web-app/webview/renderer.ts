import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export const ORB_RADIUS = 60;

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
  scene.background = new THREE.Color(0x00000a); // near-pure black — deep space

  // Stars: random point cloud at large radius
  const starCount = 2000;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = 2 * Math.PI * Math.random();
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 800 + Math.random() * 600;
    starPositions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starPositions[i * 3 + 2] = r * Math.cos(phi);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xaaccff, size: 0.8, sizeAttenuation: true });
  scene.add(new THREE.Points(starGeo, starMat));

  // Subtle blue-tinted ambient + cool directional
  scene.add(new THREE.AmbientLight(0x0a1a3f, 1.2));
  const dirLight = new THREE.DirectionalLight(0x4488ff, 1.4);
  dirLight.position.set(50, 80, 50);
  scene.add(dirLight);
  const rimLight = new THREE.DirectionalLight(0x001133, 0.6);
  rimLight.position.set(-50, -30, -80);
  scene.add(rimLight);

  // Deep-space fog — very sparse so it only kicks in at long range
  scene.fog = new THREE.FogExp2(0x00000a, 0.0008);

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
