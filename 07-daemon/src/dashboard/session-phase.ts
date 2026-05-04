/**
 * Live session phase tracker.
 *
 * Hooks call setPhase() at every Pre/Post/Prompt/Stop transition so the
 * dashboard's Stream Deck rail can paint the right state per tile —
 * matching the physical Elgato deck behavior:
 *
 *   thinking   = Claude is generating a response or computing tool args
 *   tool       = a tool is executing (between Pre and Post)
 *   permission = waiting on user approval (set explicitly via API; the
 *                Notification hook isn't currently routed through the
 *                hook-runner so this state is wired but underused)
 *   idle       = tool finished, waiting for next user prompt
 *
 * In-memory map; not persisted across daemon restarts. Phase decays back
 * to 'idle' after PHASE_DECAY_MS without an update so a crashed/aborted
 * hook doesn't leave a tile stuck on "thinking" forever.
 */
export type SessionPhase = 'thinking' | 'tool' | 'permission' | 'idle' | 'unknown';

interface PhaseRecord {
  phase: SessionPhase;
  updated_at: number;
}

const PHASE_DECAY_MS = 60_000;

const phases = new Map<string, PhaseRecord>();

export function setPhase(sessionId: string, phase: SessionPhase): void {
  if (!sessionId) return;
  phases.set(sessionId, { phase, updated_at: Date.now() });
}

export function getPhase(sessionId: string): SessionPhase {
  const rec = phases.get(sessionId);
  if (!rec) return 'unknown';
  if (Date.now() - rec.updated_at > PHASE_DECAY_MS) return 'idle';
  return rec.phase;
}

/** Snapshot of all known phases. Stale entries (>5min decay) removed. */
export function listPhases(): Record<string, SessionPhase> {
  const out: Record<string, SessionPhase> = {};
  const now = Date.now();
  for (const [id, rec] of phases.entries()) {
    if (now - rec.updated_at > 5 * PHASE_DECAY_MS) {
      phases.delete(id);
      continue;
    }
    out[id] = now - rec.updated_at > PHASE_DECAY_MS ? 'idle' : rec.phase;
  }
  return out;
}
