"use client";

import { useEffect, useRef, useState } from "react";
import { isKonami, lexPick, lexMotd } from "@/lib/lex";
import { Icon } from "./Icon";

/**
 * LexEasterEgg.
 *
 * Two unlock paths, both purely cosmetic:
 *
 *   1. Konami code on the page (any focus context that hits window key
 *      events). Up Up Down Down Left Right Left Right B A.
 *   2. Click the brand icon in the TopBar 7 times within 4 seconds.
 *      The TopBar fires a `lex-secret-tap` CustomEvent which this
 *      component listens for and counts.
 *
 * Either trigger pops a small panel with one of Lex's secret-panel
 * quips and the daily MOTD. Closes on Escape, click-outside, or X.
 *
 * No persistence. Each unlock is its own moment. The whole thing is
 * scoped here so the rest of the dashboard never has to know.
 */
export function LexEasterEgg() {
  const [open, setOpen] = useState(false);
  const [quip, setQuip] = useState("");
  const bufRef = useRef<string[]>([]);
  const tapTimesRef = useRef<number[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      bufRef.current.push(e.key);
      if (bufRef.current.length > 16) bufRef.current.shift();
      if (isKonami(bufRef.current)) {
        bufRef.current = [];
        setQuip(lexPick("secret_panel"));
        setOpen(true);
      }
    }
    function onTap() {
      const now = Date.now();
      tapTimesRef.current = [
        ...tapTimesRef.current.filter((t) => now - t < 4000),
        now,
      ];
      if (tapTimesRef.current.length >= 7) {
        tapTimesRef.current = [];
        setQuip(lexPick("secret_panel"));
        setOpen(true);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClickOutside(e: MouseEvent) {
      if (open && panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onEsc);
    window.addEventListener("mousedown", onClickOutside);
    window.addEventListener("lex-secret-tap" as never, onTap as never);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onEsc);
      window.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("lex-secret-tap" as never, onTap as never);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-base/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Lex says hello"
    >
      <div
        ref={panelRef}
        className="relative w-[min(92vw,440px)] rounded-panel bg-surface1 hairline shadow-2xl px-6 py-5"
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="absolute top-3 right-3 w-7 h-7 rounded-card hover:bg-surface2 grid place-items-center text-txt3 hover:text-txt1"
        >
          <Icon name="X" size={14} />
        </button>
        <div className="flex items-center gap-2 text-nano text-txt3 uppercase tracking-[0.18em]">
          <span className="w-1.5 h-1.5 rounded-pill bg-brand" />
          Lex
        </div>
        <div className="mt-3 font-display text-lg font-emphasized text-txt1 leading-snug">
          {quip}
        </div>
        <div className="mt-4 pt-4 border-t border-border2 text-[12px] font-mono text-txt2 leading-relaxed">
          {lexMotd()}
        </div>
        <div className="mt-4 text-nano text-txt3 font-mono">
          press esc to dismiss · konami / seven taps to summon
        </div>
      </div>
    </div>
  );
}
