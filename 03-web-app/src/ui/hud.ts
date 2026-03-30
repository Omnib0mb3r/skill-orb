export interface HudController {
  updateCounts(counts: { nodes: number; edges: number }): void;
  updateProjectLabel(label: string | null): void;
  updateLastVoiceQuery(query: string | null): void;
}

export function initHud(): HudController {
  let container = document.getElementById('devneural-hud');

  if (!container) {
    container = document.createElement('div');
    container.id = 'devneural-hud';
    container.style.cssText = [
      'position:fixed', 'top:12px', 'left:12px',
      'background:rgba(0,0,0,0.6)', 'color:#fff',
      'font-family:monospace', 'font-size:13px',
      'padding:8px 12px', 'border-radius:4px',
      'pointer-events:none', 'z-index:10',
    ].join(';');

    const counts = document.createElement('span');
    counts.id = 'hud-counts';
    counts.textContent = '0 nodes / 0 edges';
    container.appendChild(counts);

    container.appendChild(document.createElement('br'));

    const label = document.createElement('span');
    label.id = 'hud-label';
    container.appendChild(label);

    container.appendChild(document.createElement('br'));

    const query = document.createElement('span');
    query.id = 'hud-query';
    query.style.display = 'none';
    container.appendChild(query);

    document.body.appendChild(container);
  }

  const countsEl = container.querySelector<HTMLSpanElement>('#hud-counts')!;
  const labelEl = container.querySelector<HTMLSpanElement>('#hud-label')!;
  const queryEl = container.querySelector<HTMLSpanElement>('#hud-query')!;

  return {
    updateCounts({ nodes, edges }) {
      countsEl.textContent = `${nodes} nodes / ${edges} edges`;
    },
    updateProjectLabel(label) {
      labelEl.textContent = label ?? '';
    },
    updateLastVoiceQuery(query) {
      queryEl.textContent = query ?? '';
      queryEl.style.display = query ? '' : 'none';
    },
  };
}
