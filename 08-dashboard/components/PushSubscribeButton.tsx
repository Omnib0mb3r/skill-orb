"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { vapidPublicKey, subscribePush } from "@/lib/daemon-client";
import { Icon } from "./Icon";

function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

type Mode =
  | "loading"
  | "unsupported"
  | "insecure"
  | "ios-needs-install"
  | "subscribed"
  | "subscribable";

function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ identifies as Mac; disambiguate by touch
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari standalone flag (non-standard but real)
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export function PushSubscribeButton() {
  const [mode, setMode] = useState<Mode>("loading");
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    if (typeof window === "undefined") return;

    /* Three failure modes the button needs to communicate, not hide:
     *   1. unsupported  - browser has no Service Worker / Push API at all
     *   2. insecure     - APIs exist but the page is not on a secure origin
     *                     (HTTP off-localhost). Surfacing this lets the user
     *                     hit the HTTPS URL instead of guessing why nothing
     *                     happens.
     *   3. subscribed   - already subscribed, show acknowledgment
     *   4. subscribable - APIs available, secure origin, ready to subscribe.
     *                     We do NOT wait for navigator.serviceWorker.ready
     *                     here; first visit wouldn't have an active SW yet
     *                     and the button would never appear. Wait happens
     *                     at click time inside the mutation. */
    const hasSW = "serviceWorker" in navigator;
    const hasPush = "PushManager" in window;
    const isIOS = detectIOS();
    const isStandalone = detectStandalone();

    /* iOS Safari only exposes PushManager inside an installed PWA (iOS 16.4+).
     * In a regular browser tab on iOS, PushManager is missing and Notification
     * may also be absent. Detect this BEFORE the generic unsupported branch so
     * we can tell the user the actually-actionable thing: Add to Home Screen. */
    if (isIOS && !isStandalone) {
      setMode("ios-needs-install");
      return;
    }

    if (!hasSW || !hasPush) {
      setMode("unsupported");
      return;
    }
    if (!window.isSecureContext) {
      setMode("insecure");
      return;
    }

    setPermission(Notification.permission);
    /* Best-effort check whether we're already subscribed. If the SW isn't
     * controlling the page yet, getRegistration() returns undefined and we
     * fall through to "subscribable" (a redundant click is harmless). */
    navigator.serviceWorker
      .getRegistration("/")
      .then(async (reg) => {
        if (!reg) {
          setMode("subscribable");
          return;
        }
        const sub = await reg.pushManager.getSubscription().catch(() => null);
        setMode(sub ? "subscribed" : "subscribable");
      })
      .catch(() => setMode("subscribable"));
  }, []);

  const subM = useMutation({
    mutationFn: async () => {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") throw new Error("notification permission denied");
      // Nudge the registration if it hasn't happened yet (RegisterServiceWorker
      // does this on mount but we want to be defensive).
      let reg: ServiceWorkerRegistration;
      try {
        reg = await navigator.serviceWorker.ready;
      } catch {
        reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      }
      const { public_key } = await vapidPublicKey();
      const browserSub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(public_key),
      });
      const json = browserSub.toJSON();
      const endpoint = json.endpoint;
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;
      if (!endpoint || !p256dh || !auth) {
        throw new Error("subscription missing fields");
      }
      const r = await subscribePush({
        endpoint,
        keys: { p256dh, auth },
        user_agent: navigator.userAgent,
      });
      if (!r.ok) throw new Error(r.error ?? "subscribe failed");
      setMode("subscribed");
    },
  });

  if (mode === "loading") {
    return (
      <span className="inline-flex items-center gap-2 text-xs font-mono text-txt3">
        <Icon name="Bell" size={14} /> checking push support
      </span>
    );
  }

  if (mode === "ios-needs-install") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-xs font-mono text-warn">
        <Icon name="Smartphone" size={14} />
        push needs PWA install
        <span className="text-txt3">
          (Safari Share <Icon name="Share" size={11} className="inline align-text-bottom" /> -&gt; Add to Home Screen, then open from there)
        </span>
      </span>
    );
  }

  if (mode === "unsupported") {
    return (
      <span className="inline-flex items-center gap-2 text-xs font-mono text-txt3">
        <Icon name="BellOff" size={14} /> push not supported in this browser
      </span>
    );
  }

  if (mode === "insecure") {
    return (
      <span className="inline-flex items-center gap-2 text-xs font-mono text-warn">
        <Icon name="ShieldAlert" size={14} /> push needs HTTPS
        <span className="text-txt3">(open this dashboard at the tailnet HTTPS URL)</span>
      </span>
    );
  }

  if (mode === "subscribed") {
    return (
      <span className="inline-flex items-center gap-2 text-xs font-mono text-ok">
        <Icon name="BellRing" size={14} /> push enabled on this device
      </span>
    );
  }

  return (
    <button
      onClick={() => subM.mutate()}
      disabled={subM.isPending}
      className="h-8 px-3 rounded-input bg-brand/10 hairline ring-1 ring-brand/30 text-brandSoft text-xs font-emphasized hover:bg-brand/15 flex items-center gap-2 disabled:opacity-40"
    >
      <Icon name="Bell" size={14} />
      {subM.isPending ? "subscribing…" : "enable push"}
      {subM.isError && (
        <span className="text-err" title={(subM.error as Error)?.message}>
          ·
        </span>
      )}
      {permission === "denied" && <span className="text-err">(blocked)</span>}
    </button>
  );
}
