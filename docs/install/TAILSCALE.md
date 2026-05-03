# Tailscale: remote access to the dashboard

> One-time setup so you can hit the DevNeural Hub from your phone, laptop, or any other device that's on the same Tailscale tailnet as `OTLCDEV`.

## What's already done on the daemon side

- Daemon binds `0.0.0.0:3747`. Anything on the tailnet that can reach `OTLCDEV` can reach the daemon.
- Auth is PIN + signed cookie. Tailscale is the network perimeter; the PIN is the per-person guard.
- Production builds of the dashboard are served by the daemon at the same port. There's no separate Next.js dev server in prod.

You don't need to change any daemon config to enable remote access. The pieces below are about your tailnet.

## Step 1 — Install Tailscale on every device that should reach the dashboard

Each of these gets you signed into your tailnet:

| Device | Install |
|---|---|
| `OTLCDEV` (the Windows host running the daemon) | `winget install Tailscale.Tailscale`, then sign in. Confirms with `tailscale status` showing `OTLCDEV` and a `100.x.y.z` address. |
| iPhone / iPad | App Store → "Tailscale" → sign in with the same account |
| Android | Play Store → "Tailscale" → sign in |
| Other Mac / Windows / Linux | https://tailscale.com/download — sign in |

All devices must be signed into **the same account / tailnet**. Otherwise they can't see each other.

## Step 2 — Verify the tailnet sees OTLCDEV

On `OTLCDEV`, in PowerShell:

```powershell
tailscale status
```

Look for the `OTLCDEV` line. It will show its tailnet IP (`100.x.y.z`) and its MagicDNS name (something like `otlcdev.tail-NNNNN.ts.net`).

On the remote device (phone, other laptop), open a browser and try:

- `http://100.x.y.z:3747/health` (substitute OTLCDEV's actual tailnet IP)

You should see a JSON response with `"ok": true`. If you don't, the daemon isn't reachable. Run `tailscale ping otlcdev` from the remote device — it should report a direct or DERP path.

## Step 3 — Enable MagicDNS so you don't have to remember IPs

In your Tailscale admin console (https://login.tailscale.com/admin/dns), enable **MagicDNS**. After it propagates (up to a minute), you can reach the dashboard at:

```
http://otlcdev:3747
```

instead of the numeric IP. This is the friendliest form.

## Step 4 — Build the dashboard once so the daemon serves it

In dev, the dashboard runs on a separate Next.js port (3000). For remote access via the daemon's port, run a production build first:

```powershell
cd C:\dev\Projects\DevNeural\08-dashboard
npm run build
```

This produces `08-dashboard/out/` — a static export. The daemon auto-detects this directory at startup and serves it from `/` while keeping the API routes (`/auth/*`, `/sessions/*`, etc.) live on the same port. If you start the daemon before building, the daemon logs `dashboard static export not found ... ; API only` and you'll only get the API.

After building, restart the daemon:

```powershell
cd C:\dev\Projects\DevNeural\07-daemon
npm run start
```

Now `http://otlcdev:3747/` serves the dashboard, and every API call from the dashboard hits `http://otlcdev:3747/auth/...` etc on the same origin. No CORS, no rewrites, cookies stick.

## Step 5 — On the remote device

Open the URL in the browser:

```
http://otlcdev:3747
```

First load redirects to `/set-pin` (if you haven't set one yet on this install) or `/unlock`. After unlock, the dashboard loads, the cookie is set on the `otlcdev:3747` origin, and subsequent loads on that device skip the unlock until the cookie expires (12 hours of inactivity).

## Step 6 — Install as a PWA on the phone

After it works in the browser:

- **iOS Safari:** tap Share → "Add to Home Screen". The icon lands on your home screen and runs as a standalone app. Web push only works after Add to Home Screen on iOS — there's no way around that constraint.
- **Android Chrome:** the address bar shows an "Install" affordance, or use ⋮ → "Install app".

After install, push notifications opt-in is available on the Reminders tab via the "enable push" button.

## Troubleshooting

| Symptom | Diagnosis |
|---|---|
| `http://otlcdev:3747` times out from phone | Tailscale not connected on the phone, or both devices not on the same tailnet. Run `tailscale status` on each. |
| 200 from `/health` but 404 on `/` | You haven't run `npm run build` in `08-dashboard/`, or `08-dashboard/out/` doesn't exist. Daemon log will say so. |
| Dashboard loads but API calls fail with CORS errors | You're hitting the dev port (3000) remotely, not the daemon (3747). Use the daemon URL only for tailnet access. The Next dev server is for local development only. |
| Login form keeps bouncing back to /unlock | Cookie isn't being set on the right origin. Make sure you're hitting the daemon port (3747), not the Next dev port (3000), from remote devices. |
| MagicDNS name doesn't resolve | DNS hasn't propagated. Try the numeric `100.x.y.z` form. Or restart the Tailscale client on both ends. |
| Push notifications don't fire on iOS | iOS only delivers web push to PWAs installed via "Add to Home Screen". Re-install via Safari Share → Add to Home Screen. |
| `tailscale status` on OTLCDEV shows it as inactive | Run `tailscale up` from PowerShell. May prompt you to re-auth in a browser. |

## What about the public internet?

Don't expose the daemon to the public internet. Tailscale is the perimeter — that's the entire point of the architecture. The PIN is intentionally not strong enough to be your only line of defense (it's bcrypt-hashed but only 4-8 digits). Tailnet-only access keeps the threat model to "someone on your tailnet" which is just you and any devices you've signed in.

If you ever need a publicly reachable URL (you almost certainly don't), use Tailscale Funnel (`tailscale funnel 3747 on`) which gives you a public HTTPS endpoint backed by Tailscale. That's the only sanctioned path; anything else (port forwarding, dynamic DNS) loses you the encryption-by-default property.
