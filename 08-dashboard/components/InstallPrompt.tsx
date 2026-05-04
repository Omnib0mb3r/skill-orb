"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

// Chromium-only event; iOS Safari does not fire it. Typed inline to avoid
// pulling a global declaration that might shadow other PWA work.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Mode = "hidden" | "ready" | "ios-hint" | "installed";

function isIosSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua);
  const isSafari = /safari/.test(ua) && !/crios|fxios|edgios|opios/.test(ua);
  return isIos && isSafari;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // navigator.standalone is iOS-Safari only and not in standard typings.
  const navAny = window.navigator as Navigator & { standalone?: boolean };
  return Boolean(navAny.standalone);
}

export function InstallPrompt() {
  const [mode, setMode] = useState<Mode>("hidden");
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone()) {
      setMode("installed");
      return;
    }

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
      setMode("ready");
    }
    function onInstalled() {
      setMode("installed");
      setEvt(null);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // iOS Safari never fires beforeinstallprompt. Surface a gentle hint so the
    // user knows the dashboard is installable via the share sheet.
    if (isIosSafari()) {
      setMode("ios-hint");
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (mode === "hidden" || mode === "installed") return null;

  if (mode === "ios-hint") {
    return (
      <div className="inline-flex items-center gap-2 text-xs font-mono text-txt3">
        <Icon name="Share" size={14} />
        Install: tap Share, then Add to Home Screen.
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={async () => {
        if (!evt) return;
        await evt.prompt();
        try {
          await evt.userChoice;
        } finally {
          setEvt(null);
          setMode("hidden");
        }
      }}
      className="h-8 px-3 rounded-input bg-brand/10 hairline ring-1 ring-brand/30 text-brandSoft text-xs font-emphasized hover:bg-brand/15 flex items-center gap-2"
      aria-label="Install dashboard as app"
    >
      <Icon name="Download" size={14} /> install dashboard
    </button>
  );
}
