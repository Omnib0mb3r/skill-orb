import type { CameraState } from '../../webview/camera';
import type { VoiceStatus } from '../../webview/voice';

// ── CSS injected once ─────────────────────────────────────────────────────────

const HUD_CSS = `
@keyframes dn-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
@keyframes dn-live-glow {
  0%,100% { box-shadow: 0 0 6px 1px #44ff88, 0 0 14px 2px #44ff8866; transform: scale(1); }
  50%      { box-shadow: 0 0 14px 4px #44ff88, 0 0 28px 6px #44ff8844; transform: scale(1.25); }
}
@keyframes dn-live-text {
  0%,100% { opacity: 1; text-shadow: 0 0 8px #44ff88; }
  50%      { opacity: 0.65; text-shadow: 0 0 2px #44ff88; }
}
.dn-status-dot-live { animation: dn-live-glow 1.4s ease-in-out infinite; }
.dn-bar-live        { animation: dn-live-text 1.4s ease-in-out infinite; color: #44ff88 !important; }
.dn-panel {
  background: linear-gradient(160deg,rgba(2,8,24,0.92) 0%,rgba(4,14,40,0.88) 100%);
  border: 1px solid rgba(60,140,255,0.4);
  border-radius: 8px;
  box-shadow:
    0 0 32px rgba(40,100,255,0.22),
    inset 0 0 40px rgba(20,60,180,0.1);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: #8ec8ff;
  font-family: 'Courier New', Courier, monospace;
  letter-spacing: 0.05em;
  position: fixed;
  pointer-events: none;
}
.dn-panel::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 8px;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent 5px,
    rgba(60,120,255,0.03) 5px,
    rgba(60,120,255,0.03) 6px
  );
  pointer-events: none;
}
.dn-label { color: rgba(100,160,255,0.6); font-size: 15px; text-transform: uppercase; letter-spacing: 0.1em; }
.dn-value { color: #b8daff; font-size: 34px; font-weight: bold; line-height: 1.2; }
.dn-divider {
  border: none;
  border-top: 1px solid rgba(60,140,255,0.2);
  margin: 14px 0;
}
.dn-status-dot {
  display: inline-block;
  width: 16px; height: 16px;
  border-radius: 50%;
  vertical-align: middle;
  margin-right: 10px;
  box-shadow: 0 0 10px currentColor;
}
.dn-btn {
  pointer-events: auto;
  background: rgba(30,70,160,0.45);
  border: 1px solid rgba(80,150,255,0.4);
  border-radius: 5px;
  color: #8ec8ff;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  letter-spacing: 0.06em;
  padding: 6px 14px;
  transition: background 0.15s;
}
.dn-btn:hover { background: rgba(40,100,200,0.6); }
.dn-search {
  pointer-events: auto;
  background: rgba(5,15,40,0.7);
  border: 1px solid rgba(60,140,255,0.3);
  border-radius: 5px;
  color: #b8daff;
  font-family: inherit;
  font-size: 16px;
  letter-spacing: 0.04em;
  padding: 7px 14px;
  outline: none;
  width: 260px;
}
.dn-search::placeholder { color: rgba(100,160,255,0.4); }
.dn-search:focus { border-color: rgba(80,180,255,0.7); box-shadow: 0 0 12px rgba(60,140,255,0.3); }
.dn-voice-btn {
  pointer-events: auto;
  background: rgba(30,70,160,0.45);
  border: 1px solid rgba(80,150,255,0.4);
  border-radius: 5px;
  color: #8ec8ff;
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  padding: 6px 12px;
  transition: background 0.15s;
}
.dn-voice-btn.listening { animation: dn-pulse 0.8s infinite; color: #ff5555; }
.dn-bottom-bar {
  display: flex;
  align-items: center;
  gap: 36px;
  padding: 12px 36px;
  font-size: 14px;
  overflow: hidden;
}
.dn-bottom-bar .dn-seg {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 80px;
}
.dn-bottom-bar .dn-label { font-size: 12px; }
.dn-bottom-bar .dn-value { font-size: 18px; }
.dn-bottom-bar .dn-sep {
  width: 1px;
  height: 38px;
  background: rgba(60,140,255,0.25);
  flex-shrink: 0;
}
`;

function injectCss(): void {
  if (document.getElementById('dn-hud-styles')) return;
  const s = document.createElement('style');
  s.id = 'dn-hud-styles';
  s.textContent = HUD_CSS;
  document.head.appendChild(s);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HudRef {
  setCounts(projects: number, nodes: number, edges: number): void;
  setMatchCount(n: number): void;
  setSearchValue(v: string): void;
  setTopSkill(label: string): void;
  onSearch(cb: (q: string) => void): void;
  onVoiceClick(cb: () => void): void;
  onReturnToAuto(cb: () => void): void;
  _statusDot: HTMLElement;
  _cameraEl: HTMLElement;
  _returnBtn: HTMLButtonElement;
  _voiceBtn: HTMLButtonElement;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function initHud(): HudRef {
  injectCss();

  // ── Main panel — bottom right ────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'dn-panel';
  Object.assign(panel.style, {
    bottom: '60px',
    right: '20px',
    width: '560px',
    padding: '28px 34px',
    zIndex: '20',
  });

  // Title row
  const titleRow = document.createElement('div');
  Object.assign(titleRow.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '10px',
  });
  const statusDot = document.createElement('span');
  statusDot.className = 'dn-status-dot';
  statusDot.style.color = '#888';
  statusDot.style.background = '#888';
  const titleEl = document.createElement('span');
  titleEl.style.fontSize = '26px';
  titleEl.style.fontWeight = 'bold';
  titleEl.style.color = '#c8e8ff';
  titleEl.style.letterSpacing = '0.16em';
  titleEl.textContent = 'DEVNEURAL';
  titleRow.appendChild(statusDot);
  titleRow.appendChild(titleEl);
  panel.appendChild(titleRow);

  // Counts grid — 3 cols for PROJECTS / NODES / EDGES, then MATCHES / CAMERA
  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '8px 12px',
    marginBottom: '10px',
  });

  function makeMetric(label: string, initVal: string): HTMLElement {
    const seg = document.createElement('div');
    const l = document.createElement('div');
    l.className = 'dn-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'dn-value';
    v.textContent = initVal;
    seg.appendChild(l);
    seg.appendChild(v);
    grid.appendChild(seg);
    return v;
  }

  const projectsEl = makeMetric('PROJECTS', '—');
  const nodesEl = makeMetric('NODES', '—');
  const edgesEl = makeMetric('EDGES', '—');

  // Second row: MATCHES + CAMERA span 2 cols each
  const grid2 = document.createElement('div');
  Object.assign(grid2.style, {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px 12px',
    marginBottom: '10px',
  });
  function makeMetric2(label: string, initVal: string): HTMLElement {
    const seg = document.createElement('div');
    const l = document.createElement('div');
    l.className = 'dn-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'dn-value';
    v.textContent = initVal;
    seg.appendChild(l);
    seg.appendChild(v);
    grid2.appendChild(seg);
    return v;
  }

  panel.appendChild(grid);
  const matchEl = makeMetric2('MATCHES', '—');
  const cameraEl = makeMetric2('CAMERA', 'full-sphere');
  panel.appendChild(grid2);

  // Divider
  const hr = document.createElement('hr');
  hr.className = 'dn-divider';
  panel.appendChild(hr);

  // Legend — shapes match the actual orb geometry
  const legend = document.createElement('div');
  legend.style.cssText = 'font-size:16px;line-height:2.1;margin-bottom:10px;opacity:0.92';
  legend.innerHTML = [
    '<span style="color:#4488ff;font-size:24px;vertical-align:middle">●</span>&nbsp;project &nbsp;&nbsp;',
    '<span style="color:#44cc55;font-size:22px;vertical-align:middle">◆</span>&nbsp;skill &nbsp;&nbsp;',
    '<span style="color:#ff8833;font-size:20px;vertical-align:middle">■</span>&nbsp;tool',
    '<div style="margin-top:8px">',
    '  <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">',
    '    <span style="color:#1a9fcc;font-weight:bold;letter-spacing:0.08em">COLD</span>',
    '    <span style="color:#ff6622;font-weight:bold;letter-spacing:0.08em">HOT</span>',
    '  </div>',
    '  <div style="height:5px;border-radius:3px;background:linear-gradient(to right,#0d1f5c,#1a5faa,#22bbcc,#eecc22,#ff4411);box-shadow:0 0 6px rgba(255,68,17,0.3)"></div>',
    '</div>',
  ].join('');
  panel.appendChild(legend);

  // Search row
  const searchRow = document.createElement('div');
  Object.assign(searchRow.style, { display: 'flex', gap: '6px', alignItems: 'center' });
  const searchInput = document.createElement('input');
  searchInput.className = 'dn-search';
  searchInput.type = 'text';
  searchInput.placeholder = 'search nodes…';
  const voiceBtn = document.createElement('button');
  voiceBtn.className = 'dn-voice-btn';
  voiceBtn.textContent = '🎤';
  voiceBtn.title = 'Voice search';
  searchRow.appendChild(searchInput);
  searchRow.appendChild(voiceBtn);
  panel.appendChild(searchRow);

  // Return-to-auto button (hidden unless manual)
  const returnBtn = document.createElement('button');
  returnBtn.className = 'dn-btn';
  Object.assign(returnBtn.style, {
    marginTop: '8px',
    display: 'none',
    width: '100%',
    textAlign: 'center',
  });
  returnBtn.style.fontSize = '14px';
  returnBtn.style.padding = '8px 0';
  returnBtn.textContent = '⟳  RETURN TO AUTO';
  panel.appendChild(returnBtn);

  document.body.appendChild(panel);

  // ── Bottom status bar ────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'dn-panel dn-bottom-bar';
  Object.assign(bar.style, {
    bottom: '0',
    left: '0',
    right: '0',
    borderRadius: '0',
    borderLeft: 'none',
    borderRight: 'none',
    borderBottom: 'none',
    borderTop: '1px solid rgba(60,140,255,0.25)',
    zIndex: '20',
  });

  function barSeg(label: string, initVal: string): HTMLElement {
    const seg = document.createElement('div');
    seg.className = 'dn-seg';
    const l = document.createElement('div');
    l.className = 'dn-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'dn-value';
    v.style.fontSize = '18px';
    v.textContent = initVal;
    seg.appendChild(l);
    seg.appendChild(v);
    bar.appendChild(seg);
    return v;
  }

  function sep(): void {
    const d = document.createElement('div');
    d.className = 'dn-sep';
    bar.appendChild(d);
  }

  const barStatusEl = barSeg('STATUS', 'CONNECTING');
  sep();
  const barCameraEl = barSeg('VIEW', 'full-sphere');
  sep();
  barSeg('WS', 'localhost:3747');
  sep();
  const barTopSkillEl = barSeg('TOP SKILL', '—');
  sep();
  const barMatchEl = barSeg('FILTER', 'all');

  document.body.appendChild(bar);

  // ── Callbacks ────────────────────────────────────────────────────────────────

  let searchCb: ((q: string) => void) | null = null;
  let debounceT: ReturnType<typeof setTimeout> | null = null;
  searchInput.addEventListener('input', () => {
    if (debounceT) clearTimeout(debounceT);
    debounceT = setTimeout(() => searchCb?.(searchInput.value), 150);
  });

  return {
    setCounts(projects, nodes, edges) {
      projectsEl.textContent = String(projects);
      nodesEl.textContent = String(nodes);
      edgesEl.textContent = String(edges);
    },
    setMatchCount(n) {
      matchEl.textContent = n === 0 ? '—' : String(n);
      barMatchEl.textContent = n === 0 ? 'all' : `${n} match`;
    },
    setSearchValue(v) {
      searchInput.value = v;
    },
    setTopSkill(label) {
      barTopSkillEl.textContent = label || '—';
    },
    onSearch(cb) {
      searchCb = cb;
    },
    onVoiceClick(cb) {
      voiceBtn.addEventListener('click', cb);
    },
    onReturnToAuto(cb) {
      returnBtn.addEventListener('click', cb);
    },
    _statusDot: statusDot,
    _cameraEl: cameraEl,
    _returnBtn: returnBtn,
    _voiceBtn: voiceBtn,
    // expose bar elements via closure — accessed by setters below
    _barStatusEl: barStatusEl,
    _barCameraEl: barCameraEl,
  } as HudRef & { _barStatusEl: HTMLElement; _barCameraEl: HTMLElement };
}

// ── Updaters ──────────────────────────────────────────────────────────────────

export function setConnectionStatus(
  hud: HudRef,
  status: 'connected' | 'disconnected' | 'unknown',
): void {
  const colors = { connected: '#44ff88', disconnected: '#ff4444', unknown: '#888888' };
  const labels = { connected: '⬤ LIVE', disconnected: 'OFFLINE', unknown: 'CONNECTING…' };
  hud._statusDot.style.background = colors[status];
  hud._statusDot.style.color = colors[status];
  // Pulse animation only when connected
  if (status === 'connected') {
    hud._statusDot.classList.add('dn-status-dot-live');
  } else {
    hud._statusDot.classList.remove('dn-status-dot-live');
  }
  const h = hud as HudRef & { _barStatusEl?: HTMLElement };
  if (h._barStatusEl) {
    h._barStatusEl.textContent = labels[status];
    if (status === 'connected') {
      h._barStatusEl.classList.add('dn-bar-live');
    } else {
      h._barStatusEl.classList.remove('dn-bar-live');
    }
  }
}

export function setCameraMode(hud: HudRef, state: CameraState): void {
  hud._cameraEl.textContent = state;
  hud._returnBtn.style.display = state === 'manual' ? 'block' : 'none';
  const h = hud as HudRef & { _barCameraEl?: HTMLElement };
  if (h._barCameraEl) h._barCameraEl.textContent = state;
}

export function updateVoiceStatus(hud: HudRef, status: VoiceStatus): void {
  const btn = hud._voiceBtn;
  if (status === 'unavailable') {
    btn.style.display = 'none';
  } else if (status === 'listening') {
    btn.classList.add('listening');
    btn.textContent = '🎤';
  } else if (status === 'error') {
    btn.classList.remove('listening');
    btn.textContent = '⚠️';
  } else {
    btn.classList.remove('listening');
    btn.textContent = '🎤';
  }
}
