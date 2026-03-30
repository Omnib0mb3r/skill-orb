import type { CameraState } from '../../webview/camera';
import type { VoiceStatus } from '../../webview/voice';

// ── CSS injected once ─────────────────────────────────────────────────────────

const HUD_CSS = `
@keyframes dn-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
@keyframes dn-scanline {
  0% { background-position: 0 0; }
  100% { background-position: 0 4px; }
}
.dn-panel {
  background: linear-gradient(160deg,rgba(2,8,24,0.88) 0%,rgba(4,14,40,0.82) 100%);
  border: 1px solid rgba(60,140,255,0.35);
  border-radius: 6px;
  box-shadow:
    0 0 18px rgba(40,100,255,0.18),
    inset 0 0 30px rgba(20,60,180,0.08);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
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
  border-radius: 6px;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent 3px,
    rgba(60,120,255,0.03) 3px,
    rgba(60,120,255,0.03) 4px
  );
  pointer-events: none;
}
.dn-label { color: rgba(100,160,255,0.55); font-size: 10px; text-transform: uppercase; }
.dn-value { color: #b8daff; font-size: 13px; font-weight: bold; }
.dn-divider {
  border: none;
  border-top: 1px solid rgba(60,140,255,0.2);
  margin: 8px 0;
}
.dn-status-dot {
  display: inline-block;
  width: 7px; height: 7px;
  border-radius: 50%;
  vertical-align: middle;
  margin-right: 5px;
  box-shadow: 0 0 6px currentColor;
}
.dn-btn {
  pointer-events: auto;
  background: rgba(30,70,160,0.45);
  border: 1px solid rgba(80,150,255,0.4);
  border-radius: 4px;
  color: #8ec8ff;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  letter-spacing: 0.05em;
  padding: 3px 8px;
  transition: background 0.15s;
}
.dn-btn:hover { background: rgba(40,100,200,0.6); }
.dn-search {
  pointer-events: auto;
  background: rgba(5,15,40,0.7);
  border: 1px solid rgba(60,140,255,0.3);
  border-radius: 4px;
  color: #b8daff;
  font-family: inherit;
  font-size: 12px;
  letter-spacing: 0.04em;
  padding: 4px 10px;
  outline: none;
  width: 200px;
}
.dn-search::placeholder { color: rgba(100,160,255,0.4); }
.dn-search:focus { border-color: rgba(80,180,255,0.7); box-shadow: 0 0 8px rgba(60,140,255,0.3); }
.dn-voice-btn {
  pointer-events: auto;
  background: rgba(30,70,160,0.45);
  border: 1px solid rgba(80,150,255,0.4);
  border-radius: 4px;
  color: #8ec8ff;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 4px 8px;
  transition: background 0.15s;
}
.dn-voice-btn.listening { animation: dn-pulse 0.8s infinite; color: #ff5555; }
.dn-bottom-bar {
  display: flex;
  align-items: center;
  gap: 28px;
  padding: 6px 20px;
  font-size: 11px;
  overflow: hidden;
}
.dn-bottom-bar .dn-seg {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 60px;
}
.dn-bottom-bar .dn-sep {
  width: 1px;
  height: 28px;
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
  setCounts(nodes: number, edges: number): void;
  setMatchCount(n: number): void;
  setSearchValue(v: string): void;
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
    bottom: '72px',
    right: '16px',
    width: '260px',
    padding: '14px 18px',
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
  titleEl.style.fontSize = '13px';
  titleEl.style.fontWeight = 'bold';
  titleEl.style.color = '#c8e8ff';
  titleEl.style.letterSpacing = '0.12em';
  titleEl.textContent = 'DEVNEURAL';
  titleRow.appendChild(statusDot);
  titleRow.appendChild(titleEl);
  panel.appendChild(titleRow);

  // Counts grid
  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px 16px',
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

  const nodesEl = makeMetric('NODES', '—');
  const edgesEl = makeMetric('EDGES', '—');
  const matchEl = makeMetric('MATCHES', '—');
  const cameraEl = makeMetric('CAMERA', 'full-sphere');
  panel.appendChild(grid);

  // Divider
  const hr = document.createElement('hr');
  hr.className = 'dn-divider';
  panel.appendChild(hr);

  // Legend
  const legend = document.createElement('div');
  legend.style.cssText = 'font-size:11px;line-height:1.9;margin-bottom:10px;opacity:0.75';
  legend.innerHTML = [
    '<span style="color:#3388ff">■</span> project &nbsp;',
    '<span style="color:#33cc77">⬡</span> skill &nbsp;',
    '<span style="color:#ff7733">◆</span> tool',
    '<br>edge: <span style="color:#3344aa">cold</span> → <span style="color:#ff7733">hot</span> weight',
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
    v.style.fontSize = '12px';
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
  barSeg('WS', 'ws://localhost:3747');
  sep();
  barSeg('ENGINE', 'd3-force / instanced');
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
    setCounts(nodes, edges) {
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
  const labels = { connected: 'LIVE', disconnected: 'OFFLINE', unknown: 'CONNECTING' };
  hud._statusDot.style.background = colors[status];
  hud._statusDot.style.color = colors[status];
  const h = hud as HudRef & { _barStatusEl?: HTMLElement };
  if (h._barStatusEl) h._barStatusEl.textContent = labels[status];
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
