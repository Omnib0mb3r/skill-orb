/**
 * Lex personality kit.
 *
 * Centralizes Lex's voice for empty states, loading nudges, error
 * messages, idle prods, and the secret panel easter egg. The dashboard
 * pulls from here instead of inlining strings so the tone stays
 * consistent across surfaces and rotation feels alive.
 *
 * Design rules:
 *   - Witty but useful. Every line still tells the user what's going on.
 *   - Smartass without insulting. Lex is the senior dev sitting next to
 *     you, not a stand-up comedian.
 *   - Stable seed via lexPickStable(category, key) where the same key
 *     should always pick the same line (e.g. per-session greetings).
 *     Random pick via lexPick(category) elsewhere.
 *   - No emoji. The brand voice is dry not cute.
 */

export type LexCategory =
  | "empty_sessions"
  | "empty_notifications"
  | "empty_logs"
  | "empty_recent_turns"
  | "empty_services"
  | "empty_wiki"
  | "empty_reference"
  | "empty_reinforcement"
  | "empty_sessions_table"
  | "loading_log"
  | "loading_generic"
  | "error_generic"
  | "bridge_offline"
  | "all_clear"
  | "secret_panel"
  | "motd";

const LIBRARY: Record<LexCategory, readonly string[]> = {
  empty_sessions: [
    "No active sessions. Pop open a Claude window in VS Code; tile shows up within 5s.",
    "Quiet here. Start a Claude session in any VS Code window and I'll grab it.",
    "Nothing to babysit yet. Spin up a Claude session and a tile lands here.",
    "All decks empty. Open a Claude window and I'll wire it in within 5s.",
    "Stage's clear. Boot a Claude session in VS Code and a tile materializes.",
  ],
  empty_notifications: [
    "Nothing new. I'd tell you if it mattered.",
    "Inbox zero. Don't get used to it.",
    "All clear. No fires, no flags, no whining processes.",
    "Quiet on the wire. I'll bell you when it isn't.",
  ],
  empty_logs: [
    "No log lines. Either the daemon is napping or you're already winning.",
    "Log's empty. The silence is either healthy or terrifying.",
    "Nothing's logged. Sometimes that's good news.",
  ],
  empty_recent_turns: [
    "No turns captured yet. The transcript starts the moment you do.",
    "Empty transcript. Say something and I'll start collecting.",
    "Nothing to replay yet. Fire off a prompt and the rolling tape starts.",
  ],
  empty_services: [
    "No service manifest found. Either the daemon is sulking or you haven't booted it.",
    "Service list is blank. Daemon may not have introduced itself yet.",
    "No services registered. Tell the daemon to RSVP.",
  ],
  empty_wiki: [
    "No wiki pages yet. I read along; once a concept earns its spot, it lands here.",
    "Wiki's empty. Say more. I'll figure out what matters.",
    "No pages indexed. Give me some prompts to chew on.",
  ],
  empty_reference: [
    "No references uploaded. Drop a PDF, image, or audio file and I'll add it to the brain.",
    "Reference shelf is bare. Feed me docs and I'll learn the room.",
  ],
  empty_reinforcement: [
    "No reinforcement events recently. Either I'm on point or you haven't told me otherwise.",
    "Reinforcement log's quiet. Correct me sometime, I won't take it personally.",
  ],
  empty_sessions_table: [
    "No sessions on disk. The cupboard is bare.",
    "Nothing's been recorded yet. First prompt seeds the table.",
  ],
  loading_log: [
    "loading log…",
    "tailing the log…",
    "reading the bones…",
    "fetching tape…",
  ],
  loading_generic: [
    "Working on it…",
    "One sec…",
    "Lex is thinking…",
    "Compiling thoughts…",
    "Hold tight…",
  ],
  error_generic: [
    "Something tripped. Check the log.",
    "That didn't go as planned.",
    "Failed loud. Better than failing quiet.",
    "Error. I'm not gonna pretend otherwise.",
  ],
  bridge_offline: [
    "Bridge is offline. VS Code window probably closed; reopen it and I'll be back.",
    "No bridge heartbeat. The extension's not phoning home.",
    "Bridge offline. Can't queue a prompt without a courier.",
  ],
  all_clear: [
    "All clear.",
    "Nothing's on fire. Yet.",
    "Quiet skies.",
    "Green across the board.",
  ],
  secret_panel: [
    "You found the back door. I'll allow it.",
    "Cute. Now go ship something.",
    "Seven clicks, huh? Subtle.",
    "I see you. Get back to work.",
    "Good. You read the source. That's the whole job.",
    "Easter egg unlocked. Reward: this acknowledgement.",
  ],
  motd: [
    "Lex says: ship the boring version first.",
    "Lex says: read the error before asking what it means.",
    "Lex says: a comment that explains 'what' is a bug; 'why' is a feature.",
    "Lex says: the migration that scares you is the one that needs the rehearsal.",
    "Lex says: name it once, name it well, never rename it.",
    "Lex says: every cron job is a bug waiting for a clock change.",
    "Lex says: fast feedback beats clever architecture.",
    "Lex says: if it's not in version control, it doesn't exist.",
    "Lex says: the test you skipped is the bug your user finds.",
    "Lex says: complexity is debt. Pay it down on Fridays.",
  ],
};

function hashKey(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Pick a stable line for the given category + key.
 * Useful when the same place should consistently show the same quip
 * (e.g. per session, per page) instead of flickering on re-render. */
export function lexPickStable(category: LexCategory, key: string): string {
  const pool = LIBRARY[category];
  if (!pool || pool.length === 0) return "";
  const idx = hashKey(key) % pool.length;
  return pool[idx]!;
}

/** Pick a random line. Use sparingly; React hydration mismatches hate
 * non-deterministic strings. Prefer lexPickStable when rendering on a
 * surface that's also rendered on the server. */
export function lexPick(category: LexCategory): string {
  const pool = LIBRARY[category];
  if (!pool || pool.length === 0) return "";
  return pool[Math.floor(Math.random() * pool.length)]!;
}

/** Daily quip — stable per UTC date. The footer / right-rail can show
 * this and it won't change on every render but will refresh tomorrow. */
export function lexMotd(): string {
  const today = new Date().toISOString().slice(0, 10);
  return lexPickStable("motd", today);
}

/** Konami code matcher. Pass a rolling buffer of the last N keys; returns
 * true once the sequence completes. Caller resets the buffer. */
export const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
] as const;

export function isKonami(buffer: readonly string[]): boolean {
  if (buffer.length < KONAMI.length) return false;
  const tail = buffer.slice(-KONAMI.length);
  for (let i = 0; i < KONAMI.length; i++) {
    const expected = KONAMI[i]!;
    const got = tail[i]!;
    if (expected.length === 1) {
      if (got.toLowerCase() !== expected.toLowerCase()) return false;
    } else if (got !== expected) {
      return false;
    }
  }
  return true;
}
