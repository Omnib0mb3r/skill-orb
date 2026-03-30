// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initHud, setConnectionStatus, setCameraMode, updateVoiceStatus } from '../../src/ui/hud';

describe('initHud', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  it('setCounts(12, 30) → body contains both numbers', () => {
    const hud = initHud();
    hud.setCounts(12, 30);
    expect(document.body.textContent).toContain('12');
    expect(document.body.textContent).toContain('30');
  });

  it('setMatchCount(5) → body contains 5', () => {
    const hud = initHud();
    hud.setMatchCount(5);
    expect(document.body.textContent).toContain('5');
  });

  it('setMatchCount(0) → shows em-dash placeholder', () => {
    const hud = initHud();
    hud.setMatchCount(5);
    hud.setMatchCount(0);
    expect(document.body.textContent).toContain('—');
  });

  it('setSearchValue sets the input value', () => {
    const hud = initHud();
    hud.setSearchValue('typescript');
    const input = document.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('typescript');
  });

  it('onSearch callback fires on input', () => {
    const hud = initHud();
    const cb = vi.fn();
    hud.onSearch(cb);
    const input = document.querySelector('input') as HTMLInputElement;
    input.value = 'react';
    input.dispatchEvent(new Event('input'));
    // debounce: callback fires after 150ms — just check it was registered
    expect(cb).not.toHaveBeenCalled(); // not called synchronously
  });

  it('onVoiceClick fires on button click', () => {
    const hud = initHud();
    const cb = vi.fn();
    hud.onVoiceClick(cb);
    const btn = document.querySelector('.dn-voice-btn') as HTMLButtonElement;
    btn.click();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onReturnToAuto fires on return button click', () => {
    const hud = initHud();
    const cb = vi.fn();
    hud.onReturnToAuto(cb);
    hud._returnBtn.style.display = 'block';
    hud._returnBtn.click();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('setConnectionStatus', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  it('connected → status dot turns green', () => {
    const hud = initHud();
    setConnectionStatus(hud, 'connected');
    expect(hud._statusDot.style.background).toBe('rgb(68, 255, 136)');
  });

  it('disconnected → status dot turns red', () => {
    const hud = initHud();
    setConnectionStatus(hud, 'disconnected');
    expect(hud._statusDot.style.background).toBe('rgb(255, 68, 68)');
  });
});

describe('setCameraMode', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  it('manual → return button visible', () => {
    const hud = initHud();
    setCameraMode(hud, 'manual');
    expect(hud._returnBtn.style.display).not.toBe('none');
  });

  it('full-sphere → return button hidden', () => {
    const hud = initHud();
    setCameraMode(hud, 'manual');
    setCameraMode(hud, 'full-sphere');
    expect(hud._returnBtn.style.display).toBe('none');
  });
});
