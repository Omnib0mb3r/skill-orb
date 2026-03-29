import type { CameraState } from './camera';

export interface HudElements {
  statusIndicator: HTMLElement;
  cameraToggle: HTMLElement;
  returnToAutoButton: HTMLButtonElement;
  searchInput: HTMLInputElement;
  voiceButton: HTMLButtonElement;
  legendContainer: HTMLElement;
}

export interface HudCallbacks {
  onReturnToAuto(): void;
  onSearchQuery(query: string): void;
}

export function createHud(callbacks: HudCallbacks): HudElements {
  // Outer container — covers full viewport, passes through pointer events
  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    pointerEvents: 'none',
  });

  // ── Top-left: title + connection status ──────────────────────────────────────
  const topLeft = document.createElement('div');
  Object.assign(topLeft.style, {
    position: 'absolute',
    top: '12px',
    left: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#ffffff',
    fontFamily: 'monospace',
    fontSize: '13px',
  });

  const title = document.createElement('span');
  title.textContent = 'DevNeural';
  title.style.fontWeight = 'bold';

  const statusIndicator = document.createElement('span');
  statusIndicator.className = 'dn-status unknown';
  statusIndicator.dataset.status = 'unknown';
  statusIndicator.title = 'Connection status';
  Object.assign(statusIndicator.style, {
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#888',
  });

  topLeft.appendChild(title);
  topLeft.appendChild(statusIndicator);

  // ── Top-right: camera mode + return-to-auto button ───────────────────────────
  const topRight = document.createElement('div');
  Object.assign(topRight.style, {
    position: 'absolute',
    top: '12px',
    right: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#cccccc',
    fontFamily: 'monospace',
    fontSize: '12px',
  });

  const cameraToggle = document.createElement('span');
  cameraToggle.className = 'dn-camera-mode';
  cameraToggle.textContent = 'full-sphere';

  const returnToAutoButton = document.createElement('button');
  returnToAutoButton.textContent = 'Return to Auto';
  returnToAutoButton.style.pointerEvents = 'auto';
  returnToAutoButton.style.display = 'none';
  returnToAutoButton.style.cursor = 'pointer';
  returnToAutoButton.addEventListener('click', () => callbacks.onReturnToAuto());

  topRight.appendChild(cameraToggle);
  topRight.appendChild(returnToAutoButton);

  // ── Bottom-left: legend ──────────────────────────────────────────────────────
  const legendContainer = document.createElement('div');
  Object.assign(legendContainer.style, {
    position: 'absolute',
    bottom: '12px',
    left: '12px',
    color: '#aaaaaa',
    fontFamily: 'monospace',
    fontSize: '11px',
    lineHeight: '1.7',
  });
  legendContainer.innerHTML = [
    '<b>Shapes</b>: slab = project · cube = tool · octa = skill',
    '<b>Edge</b>: cool blue (low) → warm orange (high weight)',
    '<b>Badges</b>: <span style="color:#f5a623">&#9679; alpha</span>',
    ' · <span style="color:#50e3c2">&#9679; beta</span>',
    ' · <span style="color:#7ed321">&#9679; deployed</span>',
    ' · <span style="color:#888888">&#9679; archived</span>',
  ].join('');

  // ── Bottom-center: search input + voice button ───────────────────────────────
  const bottomCenter = document.createElement('div');
  Object.assign(bottomCenter.style, {
    position: 'absolute',
    bottom: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
  });

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search nodes…';
  searchInput.style.pointerEvents = 'auto';
  searchInput.style.background = 'rgba(0,0,0,0.6)';
  searchInput.style.color = '#ffffff';
  searchInput.style.border = '1px solid #444';
  searchInput.style.borderRadius = '4px';
  searchInput.style.padding = '4px 8px';
  searchInput.style.fontFamily = 'monospace';
  searchInput.style.fontSize = '13px';
  searchInput.style.width = '220px';

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  searchInput.addEventListener('input', () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      callbacks.onSearchQuery(searchInput.value);
    }, 150);
  });

  const voiceButton = document.createElement('button');
  voiceButton.className = 'dn-voice-btn';
  voiceButton.textContent = '🎤';
  voiceButton.style.pointerEvents = 'auto';
  voiceButton.style.cursor = 'pointer';
  voiceButton.style.background = 'rgba(0,0,0,0.6)';
  voiceButton.style.border = '1px solid #444';
  voiceButton.style.borderRadius = '4px';
  voiceButton.style.padding = '4px 8px';
  voiceButton.setAttribute('aria-label', 'Voice search');

  bottomCenter.appendChild(searchInput);
  bottomCenter.appendChild(voiceButton);

  container.appendChild(topLeft);
  container.appendChild(topRight);
  container.appendChild(legendContainer);
  container.appendChild(bottomCenter);

  document.body.appendChild(container);

  return {
    statusIndicator,
    cameraToggle,
    returnToAutoButton,
    searchInput,
    voiceButton,
    legendContainer,
  };
}

export function setConnectionStatus(
  elements: HudElements,
  status: 'connected' | 'disconnected' | 'unknown'
): void {
  elements.statusIndicator.className = `dn-status ${status}`;
  elements.statusIndicator.dataset.status = status;

  const colors: Record<string, string> = {
    connected: '#44ff88',
    disconnected: '#ff4444',
    unknown: '#888888',
  };
  elements.statusIndicator.style.background = colors[status];
}

export function setCameraMode(elements: HudElements, state: CameraState): void {
  elements.cameraToggle.textContent = state;
  elements.returnToAutoButton.style.display = state === 'manual' ? 'inline-block' : 'none';
}
