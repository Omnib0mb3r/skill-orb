/**
 * Per-session terminal-output ring buffer + fan-out.
 *
 * The 09-bridge VS Code extension subscribes to onDidWriteTerminalData
 * (proposed API) and POSTs every byte the Claude terminal renders here
 * via /sessions/:id/terminal-stream. We hold a bounded ring per session
 * so a dashboard tab joining mid-stream can replay the last screenful,
 * and we fan the chunks out to every WebSocket client subscribed via
 * /sessions/:id/terminal.
 *
 * Read-only mirror. The bridge is the only writer; dashboard clients
 * only read. No back-channel here — input still flows through the
 * existing prompt + nav-key endpoints.
 */

const RING_BYTES = 256 * 1024; // ~256 KB per session, plenty for one screenful + scrollback

interface SessionRing {
  buf: string[];
  bytes: number;
  subscribers: Set<(data: string) => void>;
}

const rings = new Map<string, SessionRing>();

function ensure(sessionId: string): SessionRing {
  let r = rings.get(sessionId);
  if (!r) {
    r = { buf: [], bytes: 0, subscribers: new Set() };
    rings.set(sessionId, r);
  }
  return r;
}

export function pushTerminalData(sessionId: string, data: string): void {
  if (!sessionId || !data) return;
  const r = ensure(sessionId);
  r.buf.push(data);
  r.bytes += data.length;
  while (r.bytes > RING_BYTES && r.buf.length > 1) {
    const head = r.buf.shift()!;
    r.bytes -= head.length;
  }
  for (const cb of r.subscribers) {
    try {
      cb(data);
    } catch {
      /* one bad subscriber doesn't block the others */
    }
  }
}

/** Snapshot of the current ring for late-joining clients. */
export function getTerminalReplay(sessionId: string): string {
  const r = rings.get(sessionId);
  if (!r) return '';
  return r.buf.join('');
}

/** Subscribe to live chunks. Returns an unsubscribe function. The
 * caller is expected to write the replay snapshot first, then process
 * subsequent chunks delivered via the callback. */
export function subscribeTerminal(
  sessionId: string,
  cb: (data: string) => void,
): () => void {
  const r = ensure(sessionId);
  r.subscribers.add(cb);
  return () => {
    r.subscribers.delete(cb);
    if (r.subscribers.size === 0 && r.buf.length === 0) {
      rings.delete(sessionId);
    }
  };
}

/** Drop a session's ring. Useful when the dashboard knows the session
 * is gone (e.g. supersede on /clear). */
export function dropTerminalRing(sessionId: string): void {
  const r = rings.get(sessionId);
  if (!r) return;
  for (const cb of r.subscribers) {
    try {
      cb('\r\n[mirror] session retired\r\n');
    } catch {
      /* ignore */
    }
  }
  rings.delete(sessionId);
}
