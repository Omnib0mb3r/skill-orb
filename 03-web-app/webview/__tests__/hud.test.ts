import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHud, setConnectionStatus, setCameraMode } from '../hud';
import type { HudCallbacks } from '../hud';

function makeCallbacks(): HudCallbacks {
  return {
    onReturnToAuto: vi.fn(),
    onSearchQuery: vi.fn(),
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HUD container layout', () => {
  it('container div is absolutely positioned with pointer-events: none', () => {
    createHud(makeCallbacks());
    const container = document.body.firstElementChild as HTMLElement;
    expect(container.style.position).toBe('absolute');
    expect(container.style.pointerEvents).toBe('none');
  });

  it('searchInput has pointer-events: auto', () => {
    const elements = createHud(makeCallbacks());
    expect(elements.searchInput.style.pointerEvents).toBe('auto');
  });

  it('returnToAutoButton has pointer-events: auto', () => {
    const elements = createHud(makeCallbacks());
    expect(elements.returnToAutoButton.style.pointerEvents).toBe('auto');
  });

  it('voiceButton has pointer-events: auto', () => {
    const elements = createHud(makeCallbacks());
    expect(elements.voiceButton.style.pointerEvents).toBe('auto');
  });
});

describe('setConnectionStatus', () => {
  it('setConnectionStatus(elements, "connected") sets status indicator to connected state', () => {
    const elements = createHud(makeCallbacks());
    setConnectionStatus(elements, 'connected');
    expect(elements.statusIndicator.className).toContain('connected');
    expect(elements.statusIndicator.dataset.status).toBe('connected');
  });

  it('setConnectionStatus(elements, "disconnected") sets status indicator to disconnected state', () => {
    const elements = createHud(makeCallbacks());
    setConnectionStatus(elements, 'disconnected');
    expect(elements.statusIndicator.className).toContain('disconnected');
    expect(elements.statusIndicator.dataset.status).toBe('disconnected');
  });
});

describe('search debounce', () => {
  it('rapid keystrokes within 150ms fire only one evaluation call', () => {
    vi.useFakeTimers();
    const callbacks = makeCallbacks();
    const elements = createHud(callbacks);

    elements.searchInput.value = 'a';
    elements.searchInput.dispatchEvent(new Event('input'));
    elements.searchInput.value = 'ab';
    elements.searchInput.dispatchEvent(new Event('input'));
    elements.searchInput.value = 'abc';
    elements.searchInput.dispatchEvent(new Event('input'));

    expect(callbacks.onSearchQuery).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);

    expect(callbacks.onSearchQuery).toHaveBeenCalledTimes(1);
    expect(callbacks.onSearchQuery).toHaveBeenCalledWith('abc');
  });
});
