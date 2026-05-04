"use client";

import { useMutation } from "@tanstack/react-query";
import { sendSessionKey, type NavKey } from "@/lib/daemon-client";
import { Icon } from "./Icon";

/* Stream Deck Nav mode for the dashboard.
 *
 * Mirrors the physical Elgato deck's 5x3 Nav layout exactly so muscle
 * memory works whether the user is on the hardware or the dashboard:
 *
 *   Row 0:  1(R)  2(O)  3(Y)  4(G)  5(B)        - menu / option picks
 *   Row 1:  _     _     ↑     ⌫    ✕            - up + backspace + close
 *   Row 2:  🎤    ←    ↓     →    ↵            - mic + arrows + enter
 *
 * Each press POSTs /sessions/:id/key with a NavKey; the daemon writes
 * to %LOCALAPPDATA%\stream-deck\virtual-input\<sessionId>.in and the
 * StreamDeck.App tray watches that path and SendInputs into the
 * matching VS Code window via the same code path as the physical
 * deck. The bridge no longer participates in focus or key inject (it
 * lacked the OS focus rights this tray app holds). Mic fires Win+H.
 * Numbers + arrows + enter + backspace map to their virtual-key codes.
 * ✕ exits Nav mode locally and never hits the daemon. */

export interface NavGridProps {
  sessionId: string;
  projectLabel: string;
  onClose: () => void;
}

type KeyIcon =
  | "Mic"
  | "X"
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "CornerDownLeft"
  | "Delete";

interface KeyDef {
  /** Daemon key name; null = local-only (back / spacer). */
  key: NavKey | null;
  label: string;
  /** Tailwind class for tile background tint. */
  tone: "red" | "orange" | "yellow" | "green" | "blue" | "slate" | "light" | "warn" | "empty";
  /** Optional aria-label override. */
  aria?: string;
  /** Lucide icon when the tile renders a glyph instead of text. Used
   * for arrows + enter + backspace because not every font in the
   * dashboard's stack carries those Unicode glyphs. */
  icon?: KeyIcon;
}

const TONE: Record<KeyDef["tone"], string> = {
  red:    "bg-[oklch(56%_0.18_25)] text-white",
  orange: "bg-[oklch(64%_0.16_55)] text-white",
  yellow: "bg-[oklch(75%_0.13_95)] text-black",
  green:  "bg-[oklch(58%_0.17_145)] text-white",
  blue:   "bg-[oklch(54%_0.18_265)] text-white",
  slate:  "bg-surface2 text-white",
  light:  "bg-[oklch(92%_0_0)] text-black",
  warn:   "bg-[oklch(50%_0.20_25)] text-white",
  empty:  "bg-[oklch(15%_0_0)] text-transparent",
};

const KEYS: KeyDef[] = [
  // Row 0: numeric picks
  { key: "1", label: "1", tone: "red"    },
  { key: "2", label: "2", tone: "orange" },
  { key: "3", label: "3", tone: "yellow" },
  { key: "4", label: "4", tone: "green"  },
  { key: "5", label: "5", tone: "blue"   },
  // Row 1: spacers, up, backspace, exit-nav
  { key: null,        label: "", tone: "empty" },
  { key: null,        label: "", tone: "empty" },
  { key: "up",        label: "", tone: "slate", aria: "Up",        icon: "ArrowUp" },
  { key: "backspace", label: "", tone: "light", aria: "Backspace", icon: "Delete" },
  { key: null,        label: "", tone: "warn",  aria: "Exit nav mode", icon: "X" },
  // Row 2: mic, arrows, enter
  { key: "mic",   label: "", tone: "light", aria: "Dictation (Win+H)", icon: "Mic" },
  { key: "left",  label: "", tone: "slate", aria: "Left",  icon: "ArrowLeft" },
  { key: "down",  label: "", tone: "slate", aria: "Down",  icon: "ArrowDown" },
  { key: "right", label: "", tone: "slate", aria: "Right", icon: "ArrowRight" },
  { key: "enter", label: "", tone: "light", aria: "Enter", icon: "CornerDownLeft" },
];

export function NavGrid({ sessionId, projectLabel, onClose }: NavGridProps) {
  const sendM = useMutation({
    mutationFn: (key: NavKey) => sendSessionKey(sessionId, key),
  });

  function handlePress(def: KeyDef): void {
    // Row-1 last cell is the exit affordance: null key, X icon. Local only.
    if (def.key === null) {
      onClose();
      return;
    }
    sendM.mutate(def.key);
  }

  return (
    <div className="rounded-card bg-surface1 hairline p-2 flex flex-col gap-2">
      <div className="flex items-center justify-between px-1 pt-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon name="Gamepad2" size={14} className="text-brandSoft shrink-0" />
          <span className="font-display text-xs font-emphasized truncate text-txt1">
            {projectLabel}
          </span>
        </div>
        <span className="text-nano text-txt3 font-mono">nav</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {KEYS.map((def, i) => {
          const isExit = def.key === null && def.icon === "X";
          const isEmpty = def.tone === "empty";
          return (
            <button
              key={i}
              type="button"
              onClick={() => handlePress(def)}
              disabled={isEmpty || sendM.isPending}
              aria-label={def.aria ?? def.label}
              className={`aspect-square rounded-card font-mono text-base font-emphasized grid place-items-center transition-transform active:scale-95 disabled:cursor-default ${TONE[def.tone]} ${
                isEmpty ? "opacity-40 pointer-events-none" : "hover:brightness-110"
              } ${isExit ? "ring-1 ring-err/40" : ""}`}
            >
              {def.icon ? (
                <Icon name={def.icon} size={18} />
              ) : (
                <span>{def.label}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="px-1 pb-0.5 text-nano text-txt3 font-mono">
        {sendM.isPending
          ? "sending…"
          : sendM.isError
            ? "send failed"
            : sendM.isSuccess
              ? "sent ✓"
              : "1-5 picks · arrows + ⌫ + ↵ · 🎤 = Win+H"}
      </div>
    </div>
  );
}
