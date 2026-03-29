import { createScene } from './renderer';
import { updateGraph, getGraphInstance } from './orb';
import type { GraphSnapshot } from '../src/types';

const canvas = document.getElementById('devneural-canvas') as HTMLCanvasElement;
const { scene, startAnimationLoop } = createScene(canvas);
const graphOrb = getGraphInstance();

scene.add(graphOrb);
startAnimationLoop(() => {
  graphOrb.tickFrame();
});

window.addEventListener('message', (event: MessageEvent) => {
  const { type, payload } = event.data as { type: string; payload: unknown };
  switch (type) {
    case 'graph:snapshot':
      updateGraph(payload as GraphSnapshot);
      break;
    case 'setActiveProjects':
      // Camera module handles this — wired in section-09
      break;
  }
});
