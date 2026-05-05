/**
 * Pending permission/elicitation prompt tracker.
 *
 * Claude Code's Notification hook fires when CC asks the user to answer
 * a permission prompt or numbered choice (e.g. "1) yes 2) no"). The hook
 * payload's `message` carries the prompt text. Hook-runner forwards it
 * here so the dashboard can render the question + answer buttons; the
 * user answers from the dashboard and the bridge pastes the choice into
 * Claude's terminal.
 *
 * In-memory only. Cleared on:
 *   - explicit DELETE from the dashboard after the user answers
 *   - the next user_prompt phase ping (the user answered in CC directly)
 *   - the next session_stop ping
 *   - PENDING_TTL_MS staleness sweep
 */

const PENDING_TTL_MS = 10 * 60 * 1000;

export interface PendingPrompt {
  message: string;
  kind: string;
  received_at: number;
}

const pending = new Map<string, PendingPrompt>();

export function setPending(
  sessionId: string,
  message: string,
  kind: string,
): void {
  if (!sessionId || !message) return;
  pending.set(sessionId, {
    message,
    kind: kind || 'notification',
    received_at: Date.now(),
  });
}

export function clearPending(sessionId: string): void {
  if (!sessionId) return;
  pending.delete(sessionId);
}

export function getPending(sessionId: string): PendingPrompt | null {
  if (!sessionId) return null;
  const rec = pending.get(sessionId);
  if (!rec) return null;
  if (Date.now() - rec.received_at > PENDING_TTL_MS) {
    pending.delete(sessionId);
    return null;
  }
  return rec;
}
