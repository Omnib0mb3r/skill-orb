export interface HudController {
  updateCounts(counts: { nodes: number; edges: number }): void;
  updateProjectLabel(label: string | null): void;
  updateLastVoiceQuery(query: string | null): void;
}

/** Strip node-type prefix and take the last path segment for a readable label. */
function cleanLabel(raw: string): string {
  const stripped = raw.replace(/^(project:|skill:|tool:)/, '');
  return stripped.split(/[/\\]/).filter(Boolean).pop() ?? stripped;
}

/** Colour dot for each node type */
const TYPE_COLORS: Record<string, string> = {
  project: '#4488ff',
  skill:   '#44cc55',
  tool:    '#ff8833',
};

function typeFromId(id: string): string {
  if (id.startsWith('project:')) return 'project';
  if (id.startsWith('skill:'))   return 'skill';
  return 'tool';
}

export function initHud(): HudController {
  let container = document.getElementById('devneural-hud');

  if (!container) {
    container = document.createElement('div');
    container.id = 'devneural-hud';
    container.style.cssText = [
      'position:fixed', 'top:16px', 'left:16px',
      'background:rgba(8,8,20,0.82)',
      'border:1px solid rgba(100,140,255,0.25)',
      'color:#c8d8f0',
      'font-family:"Courier New",monospace', 'font-size:16px', 'line-height:1.7',
      'padding:12px 18px', 'border-radius:8px',
      'pointer-events:none', 'z-index:10',
      'min-width:200px',
      'backdrop-filter:blur(4px)',
    ].join(';');

    // ── counts row ───────────────────────────────────────────────────────────
    const counts = document.createElement('div');
    counts.id = 'hud-counts';
    counts.style.cssText = 'color:#7fa8d0;font-size:14px;letter-spacing:0.04em';
    counts.textContent = '0 nodes  /  0 edges';
    container.appendChild(counts);

    // ── legend row ────────────────────────────────────────────────────────────
    const legend = document.createElement('div');
    legend.style.cssText = 'font-size:13px;margin-top:4px;display:flex;gap:12px;opacity:0.7';
    [
      { type: 'project', label: '● project' },
      { type: 'skill',   label: '◆ skill'   },
      { type: 'tool',    label: '■ tool'    },
    ].forEach(({ type, label }) => {
      const s = document.createElement('span');
      s.style.color = TYPE_COLORS[type]!;
      s.textContent = label;
      legend.appendChild(s);
    });
    container.appendChild(legend);

    // ── divider ───────────────────────────────────────────────────────────────
    const hr = document.createElement('div');
    hr.style.cssText = 'border-top:1px solid rgba(100,140,255,0.15);margin:8px 0 4px';
    container.appendChild(hr);

    // ── selected node label ───────────────────────────────────────────────────
    const label = document.createElement('div');
    label.id = 'hud-label';
    label.style.cssText = 'font-size:15px;color:#e0eeff;min-height:1.4em';
    container.appendChild(label);

    // ── voice query ───────────────────────────────────────────────────────────
    const query = document.createElement('div');
    query.id = 'hud-query';
    query.style.cssText = 'font-size:13px;color:#88bbcc;margin-top:4px;display:none';
    container.appendChild(query);

    document.body.appendChild(container);
  }

  const countsEl  = container.querySelector<HTMLElement>('#hud-counts')!;
  const labelEl   = container.querySelector<HTMLElement>('#hud-label')!;
  const queryEl   = container.querySelector<HTMLElement>('#hud-query')!;

  return {
    updateCounts({ nodes, edges }) {
      countsEl.textContent = `${nodes} nodes  /  ${edges} edges`;
    },
    updateProjectLabel(raw) {
      if (!raw) {
        labelEl.textContent = '';
        return;
      }
      const type  = typeFromId(raw);
      const color = TYPE_COLORS[type] ?? '#c8d8f0';
      const name  = cleanLabel(raw);
      labelEl.innerHTML = `<span style="color:${color}">${type === 'project' ? '●' : type === 'skill' ? '◆' : '■'}</span> ${name}`;
    },
    updateLastVoiceQuery(query) {
      queryEl.textContent = query ? `🎙 ${query}` : '';
      queryEl.style.display = query ? 'block' : 'none';
    },
  };
}
