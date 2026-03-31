import { describe, it, expect, vi } from 'vitest';
import { buildAnimationTick } from '../../src/animationTick';

describe('buildAnimationTick', () => {
  it('skips motion calls when camera state is manual', () => {
    const graphTickFrame = vi.fn();
    const updateRenderPositions = vi.fn();
    const tickBreathing = vi.fn();
    const cameraController = { state: 'manual' as const, tick: vi.fn() };

    const tick = buildAnimationTick({ graphTickFrame, updateRenderPositions, tickBreathing, cameraController });
    tick(0.016);

    expect(graphTickFrame).not.toHaveBeenCalled();
    expect(updateRenderPositions).not.toHaveBeenCalled();
    expect(tickBreathing).not.toHaveBeenCalled();
    expect(cameraController.tick).toHaveBeenCalledWith(16);
  });

  it('runs motion calls when camera state is not manual', () => {
    const graphTickFrame = vi.fn();
    const updateRenderPositions = vi.fn();
    const tickBreathing = vi.fn();
    const cameraController = { state: 'full-sphere' as const, tick: vi.fn() };

    const tick = buildAnimationTick({ graphTickFrame, updateRenderPositions, tickBreathing, cameraController });
    tick(0.016);

    expect(graphTickFrame).toHaveBeenCalled();
    expect(updateRenderPositions).toHaveBeenCalled();
    expect(tickBreathing).toHaveBeenCalledWith(16);
    expect(cameraController.tick).toHaveBeenCalledWith(16);
  });

  it('passes accumulated elapsed time to tickBreathing across frames, not raw delta', () => {
    const tickBreathing = vi.fn();
    const cameraController = { state: 'full-sphere' as const, tick: vi.fn() };
    const tick = buildAnimationTick({
      graphTickFrame: vi.fn(),
      updateRenderPositions: vi.fn(),
      tickBreathing,
      cameraController,
    });

    tick(0.016); // frame 1 → 16ms
    tick(0.016); // frame 2 → 32ms
    tick(0.016); // frame 3 → 48ms

    const calls = tickBreathing.mock.calls;
    expect(calls[0][0]).toBeCloseTo(16);
    expect(calls[1][0]).toBeCloseTo(32);
    expect(calls[2][0]).toBeCloseTo(48);
  });

  it('still calls cameraController.tick when manual (keeps camera transitions alive)', () => {
    const cameraController = { state: 'manual' as const, tick: vi.fn() };
    const tick = buildAnimationTick({
      graphTickFrame: vi.fn(),
      updateRenderPositions: vi.fn(),
      tickBreathing: vi.fn(),
      cameraController,
    });

    tick(0.033);

    expect(cameraController.tick).toHaveBeenCalledWith(33);
  });
});
