"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authStatus, unlock } from "@/lib/daemon-client";
import { PinForm } from "@/components/PinForm";
import { Icon } from "@/components/Icon";

export function UnlockForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [pinSet, setPinSet] = useState<boolean | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    authStatus()
      .then((s) => {
        setPinSet(s.pin_set);
        setLocked(s.locked);
        if (!s.pin_set) router.replace("/set-pin");
      })
      .catch(() => setPinSet(true)); // assume PIN set if daemon unreachable; user retries
  }, [router]);

  if (pinSet === null) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-nano text-txt3">connecting…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-sm rounded-panel bg-surface1 hairline p-8 relative brand-glow overflow-hidden">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-card bg-brand/10 ring-1 ring-brand/30 grid place-items-center">
            <Icon name="Brain" className="text-brandSoft" size={20} />
          </div>
          <div>
            <div className="font-display text-base font-emphasized">DevNeural</div>
            <div className="text-nano text-txt3 -mt-0.5">Hub</div>
          </div>
        </div>

        <h1 className="font-display text-xl font-semibold mb-1">Unlock</h1>
        <p className="text-txt3 text-xs mb-6">Enter your PIN to access the dashboard.</p>

        {locked && (
          <div className="mb-4 px-3 py-2 rounded-card hairline-soft bg-err/10 ring-1 ring-err/30 text-xs text-err">
            Too many wrong attempts. Try again in a few minutes.
          </div>
        )}

        <PinForm
          mode="unlock"
          onSubmit={async (pin) => {
            const r = await unlock(pin);
            if (r.ok) return { ok: true };
            const reason = r.reason ?? "wrong_pin";
            const map: Record<string, string> = {
              wrong_pin: "Wrong PIN.",
              locked: "Locked. Wait a few minutes.",
              invalid_format: "PIN must be 4-8 digits.",
              no_pin_set: "No PIN set yet — redirecting.",
            };
            return { ok: false, error: map[reason] ?? reason };
          }}
          redirectTo={params.get("from") ?? "/"}
        />

        <p className="mt-6 text-nano text-txt3">
          Can&apos;t remember? <code className="text-txt2">npm run dashboard:reset-pin</code> on OTLCDEV.
        </p>
      </div>
    </div>
  );
}
