"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authStatus, setPin, unlock } from "@/lib/daemon-client";
import { PinForm } from "@/components/PinForm";
import { Icon } from "@/components/Icon";

export default function SetPinPage() {
  const router = useRouter();
  const [pinSet, setPinSet] = useState<boolean | null>(null);

  useEffect(() => {
    authStatus().then((s) => setPinSet(s.pin_set));
  }, []);

  if (pinSet === null) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-nano text-txt3">connecting…</div>
      </div>
    );
  }

  const isFirstRun = !pinSet;

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

        <h1 className="font-display text-xl font-semibold mb-1">
          {isFirstRun ? "Set your PIN" : "Change PIN"}
        </h1>
        <p className="text-txt3 text-xs mb-6">
          {isFirstRun
            ? "First time on this dashboard. Pick a 4-8 digit PIN. You can reset it later via CLI on OTLCDEV."
            : "Enter your current PIN, then choose a new one."}
        </p>

        <PinForm
          mode="set"
          needsCurrentPin={!isFirstRun}
          onSubmit={async (pin, currentPin) => {
            const r = await setPin(pin, currentPin);
            if (!r.ok) return { ok: false, error: r.error ?? "Failed to set PIN" };
            // log in immediately so the redirect lands on the dashboard
            const u = await unlock(pin);
            if (u.ok) router.replace("/");
            return u.ok ? { ok: true } : { ok: false, error: "PIN set but unlock failed" };
          }}
        />
      </div>
    </div>
  );
}
