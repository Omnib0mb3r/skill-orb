import type { CameraState } from '../webview/camera';

interface AnimationTickDeps {
  graphTickFrame: () => void;
  updateRenderPositions: () => void;
  tickBreathing: (ms: number) => void;
  cameraController: { state: CameraState; tick(ms: number): void };
}

/**
 * Returns the per-frame animation callback for startAnimationLoop.
 * Motion (physics + breathing) is skipped when the camera is in manual mode
 * so the scene freezes while the user is orbiting.
 * cameraController.tick() always runs to keep camera transitions smooth.
 */
export function buildAnimationTick(deps: AnimationTickDeps): (delta: number) => void {
  let elapsedMs = 0;
  return (delta: number) => {
    elapsedMs += delta * 1000;
    if (deps.cameraController.state !== 'manual') {
      deps.graphTickFrame();
      deps.updateRenderPositions();
      deps.tickBreathing(elapsedMs);
    }
    deps.cameraController.tick(delta * 1000);
  };
}
