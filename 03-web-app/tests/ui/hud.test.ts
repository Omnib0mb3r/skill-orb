// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { initHud } from '../../src/ui/hud';

describe('initHud', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('updateCounts({ nodes: 12, edges: 30 }) → element text reflects new values', () => {
    const hud = initHud();
    hud.updateCounts({ nodes: 12, edges: 30 });

    expect(document.body.textContent).toContain('12');
    expect(document.body.textContent).toContain('30');
  });

  it("updateProjectLabel('DevNeural') → element text contains 'DevNeural'", () => {
    const hud = initHud();
    hud.updateProjectLabel('DevNeural');

    expect(document.body.textContent).toContain('DevNeural');
  });

  it("updateLastVoiceQuery → element text updated", () => {
    const hud = initHud();
    hud.updateLastVoiceQuery('what skills am I using?');

    expect(document.body.textContent).toContain('what skills am I using?');
  });

  it('updateLastVoiceQuery(null) → last query element cleared', () => {
    const hud = initHud();
    hud.updateLastVoiceQuery('some query');
    hud.updateLastVoiceQuery(null);

    const queryEl = document.getElementById('hud-query') as HTMLElement;
    expect(queryEl.textContent).toBe('');
  });

  it('initHud() returns an object with all three update methods', () => {
    const hud = initHud();

    expect(typeof hud.updateCounts).toBe('function');
    expect(typeof hud.updateProjectLabel).toBe('function');
    expect(typeof hud.updateLastVoiceQuery).toBe('function');
  });

  it('initHud() called twice → does not create duplicate DOM elements', () => {
    initHud();
    initHud();

    const containers = document.querySelectorAll('#devneural-hud');
    expect(containers).toHaveLength(1);
  });

  it('initHud() called twice → second call returns a working controller', () => {
    initHud();
    const hud2 = initHud();
    hud2.updateProjectLabel('RepeatedInit');

    expect(document.body.textContent).toContain('RepeatedInit');
  });
});
