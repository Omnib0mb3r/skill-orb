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

export function PushSubscribeButton() {
  const [ready, setReady] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return;
    }
    setPermission(Notification.permission);
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(Boolean(sub));
      setReady(true);
    });
  }, []);

  const subM = useMutation({
    mutationFn: async () => {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") throw new Error("notification permission denied");
      const reg = await navigator.serviceWorker.ready;
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
      setSubscribed(true);
    },
  });

  if (!ready) return null;

  if (subscribed) {
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
      {subM.isError && <span className="text-err">·</span>}
      {permission === "denied" && <span className="text-err">(blocked)</span>}
    </button>
  );
}
