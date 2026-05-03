"use client";

import { useState, useRef, useEffect } from "react";
import { Icon } from "./Icon";

interface Props {
  mode: "unlock" | "set";
  onSubmit: (pin: string, currentPin?: string) => Promise<{ ok: boolean; error?: string }>;
  needsCurrentPin?: boolean;
  redirectTo?: string;
}

export function PinForm({ mode, onSubmit, needsCurrentPin, redirectTo }: Props) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "set") {
      if (pin.length < 4 || pin.length > 8) {
        setError("PIN must be 4-8 digits");
        return;
      }
      if (pin !== confirmPin) {
        setError("PIN does not match confirmation");
        return;
      }
    }
    setSubmitting(true);
    try {
      const r = await onSubmit(pin, needsCurrentPin ? currentPin : undefined);
      if (!r.ok) {
        setError(r.error ?? "Failed");
        setPin("");
        setConfirmPin("");
        inputRef.current?.focus();
      } else if (redirectTo) {
        window.location.href = redirectTo;
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {needsCurrentPin && (
        <div>
          <label htmlFor="current-pin" className="text-nano text-txt3 block mb-1.5">
            Current PIN
          </label>
          <input
            id="current-pin"
            name="current-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            className="w-full h-10 px-3 rounded-input bg-surface1 hairline text-txt1 outline-none focus:ring-1 focus:ring-brand/60 font-mono tracking-[0.4em] text-lg text-center"
          />
        </div>
      )}

      <div>
        <label htmlFor="pin" className="text-nano text-txt3 block mb-1.5">
          {mode === "set" ? "Choose PIN" : "Enter PIN"}
        </label>
        <input
          id="pin"
          name="pin"
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          className="w-full h-10 px-3 rounded-input bg-surface1 hairline text-txt1 outline-none focus:ring-1 focus:ring-brand/60 font-mono tracking-[0.4em] text-lg text-center"
        />
      </div>

      {mode === "set" && (
        <div>
          <label htmlFor="confirm-pin" className="text-nano text-txt3 block mb-1.5">
            Confirm PIN
          </label>
          <input
            id="confirm-pin"
            name="confirm-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            className="w-full h-10 px-3 rounded-input bg-surface1 hairline text-txt1 outline-none focus:ring-1 focus:ring-brand/60 font-mono tracking-[0.4em] text-lg text-center"
          />
        </div>
      )}

      {error && (
        <div className="text-xs font-mono text-err flex items-center gap-1.5">
          <Icon name="AlertTriangle" size={14} />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || pin.length < 4}
        className="w-full h-10 rounded-input bg-brand hover:bg-brand/90 text-base text-sm font-emphasized disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? "..." : mode === "set" ? "Set PIN" : "Unlock"}
      </button>
    </form>
  );
}
