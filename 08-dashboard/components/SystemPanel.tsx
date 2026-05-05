"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SparkAreaChart } from "@tremor/react";
import { systemMetrics, services as servicesClient } from "@/lib/daemon-client";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";
import { LogTail } from "./LogTail";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { BackfillPanel } from "./BackfillPanel";
import { lexPickStable } from "@/lib/lex";

function fmtBytes(bytes: number): string {
  if (!bytes) return "0";
  const u = ["B", "K", "M", "G", "T"];
  const i = Math.min(u.length - 1, Math.floor(Math.log10(bytes) / 3));
  return `${(bytes / 10 ** (i * 3)).toFixed(1)}${u[i]}`;
}

interface SamplePoint {
  t: number;
  cpu: number;
  mem: number;
}

const HISTORY_CAP = 60;

interface SparkProps {
  label: string;
  data: SamplePoint[];
  category: "cpu" | "mem";
  /* Tremor's `colors` prop only accepts entries from its built-in palette
   * (violet, emerald, etc) — passing CSS vars or oklch literals silently
   * disables the line. Map our token intent to the closest palette match:
   *   --c-accent (electric violet)  -> "violet"
   *   --c-ok (green)                 -> "emerald" */
  color: "violet" | "emerald";
}
function Spark({ label, data, category, color }: SparkProps) {
  const last = data[data.length - 1]?.[category] ?? 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-nano text-txt3">{label}</span>
        <span className="text-xs font-mono text-txt2">{last.toFixed(0)}%</span>
      </div>
      <SparkAreaChart
        data={data}
        index="t"
        categories={[category]}
        colors={[color]}
        className="h-10 w-full"
        minValue={0}
        maxValue={100}
        curveType="monotone"
      />
    </div>
  );
}

interface BarProps {
  pct: number;
  label: string;
  caption: string;
  tone?: "ok" | "warn" | "err";
}
function Bar({ pct, label, caption, tone = "ok" }: BarProps) {
  const color = tone === "err" ? "var(--c-err)" : tone === "warn" ? "var(--c-warn)" : "var(--c-ok)";
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-nano text-txt3">{label}</span>
        <span className="text-xs font-mono text-txt2">{caption}</span>
      </div>
      <div className="h-1.5 rounded-pill bg-surface2 overflow-hidden">
        <div
          className="h-full rounded-pill transition-all duration-base"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }}
        />
      </div>
    </div>
  );
}

export function SystemPanel() {
  const m = useQuery({
    queryKey: ["system-metrics"],
    queryFn: systemMetrics,
    refetchInterval: 4_000,
  });
  const s = useQuery({
    queryKey: ["services"],
    queryFn: servicesClient,
    refetchInterval: 8_000,
  });

  const cpu = m.data?.cpu.usage_percent ?? 0;
  const mem = m.data?.memory ?? { used_percent: 0, used_bytes: 0, total_bytes: 0 };
  const disks = m.data?.disks ?? [];
  const ollama = m.data?.ollama;
  const dataRoot = m.data?.data_root_bytes ?? 0;
  const services = s.data?.services ?? [];

  const cpuTone = cpu > 90 ? "err" : cpu > 70 ? "warn" : "ok";
  const memTone = mem.used_percent > 90 ? "err" : mem.used_percent > 80 ? "warn" : "ok";

  // Rolling sample buffer kept in component state. Last 60 samples at the 4s
  // poll cadence covers the most recent ~4 minutes of host vitals. Reset on
  // unmount; not persisted across navigations.
  const [history, setHistory] = useState<SamplePoint[]>([]);
  const dataUpdatedAt = m.dataUpdatedAt;
  useEffect(() => {
    if (!m.data) return;
    setHistory((prev) => {
      const next = prev.concat({
        t: dataUpdatedAt || Date.now(),
        cpu: m.data!.cpu.usage_percent ?? 0,
        mem: m.data!.memory?.used_percent ?? 0,
      });
      return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
    });
  }, [dataUpdatedAt, m.data]);

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="col-span-2 space-y-4">
        {/* Vitals card */}
        <section className="rounded-panel bg-surface1 hairline">
          <div className="px-5 py-3 border-b border-border1 flex items-center gap-2">
            <Icon name="Cpu" className="text-brandSoft" size={16} />
            <h2 className="font-display text-sm font-emphasized">OTLCDEV vitals</h2>
          </div>
          <div className="p-5 grid grid-cols-2 gap-5">
            <Bar
              pct={cpu}
              label="CPU"
              caption={`${cpu.toFixed(0)}% across ${m.data?.cpu.cores ?? "—"} cores`}
              tone={cpuTone}
            />
            <Bar
              pct={mem.used_percent}
              label="Memory"
              caption={`${fmtBytes(mem.used_bytes)} / ${fmtBytes(mem.total_bytes)}`}
              tone={memTone}
            />
            {disks.map((d, i) => (
              <Bar
                key={`${d.mount ?? "disk"}-${i}`}
                pct={d.used_percent}
                label={`Disk ${d.mount ?? i}`}
                caption={`${fmtBytes(d.used_bytes)} / ${fmtBytes(d.total_bytes)}`}
                tone={d.used_percent > 90 ? "err" : d.used_percent > 80 ? "warn" : "ok"}
              />
            ))}
          </div>
          {history.length > 1 && (
            <div className="px-5 pb-4 grid grid-cols-2 gap-5">
              <Spark label="CPU trend" data={history} category="cpu" color="violet" />
              <Spark label="Memory trend" data={history} category="mem" color="emerald" />
            </div>
          )}
          <div className="px-5 py-3 border-t border-border2 flex items-center justify-between text-[11px] font-mono text-txt3">
            <div className="flex items-center gap-2">
              <StatusDot status={ollama?.reachable ? "ok" : "fail"} size={6} />
              ollama
              {ollama?.model && <span className="text-txt2">{ollama.model}</span>}
            </div>
            <div>data root {fmtBytes(dataRoot)}</div>
          </div>
        </section>
      </div>

      <div className="col-span-1 space-y-4">
        {/* Services card */}
        <section className="rounded-panel bg-surface1 hairline">
          <div className="px-5 py-3 border-b border-border1 flex items-center gap-2">
            <Icon name="ServerCog" className="text-brandSoft" size={16} />
            <h2 className="font-display text-sm font-emphasized">Services</h2>
          </div>
          <ul className="divide-y divide-border2">
            {services.length === 0 && (
              <li className="px-5 py-3 text-xs text-txt3">
                {lexPickStable("empty_services", "system-services")}
              </li>
            )}
            {services.map((svc) => (
              <li
                key={svc.id}
                className="px-5 py-2.5 flex items-center justify-between"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <StatusDot
                    status={svc.status === "ok" ? "ok" : svc.status === "warn" ? "warn" : "fail"}
                  />
                  <span className="text-sm text-txt1 truncate">{svc.label}</span>
                </div>
                {svc.detail && (
                  <span
                    className="text-[11px] font-mono text-txt3 truncate ml-3"
                    title={svc.detail}
                  >
                    {svc.detail}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Brain diagnostics spans full width, between vitals and log tail */}
      <div className="col-span-3">
        <DiagnosticsPanel />
      </div>

      {/* One-time backfill of historical Claude transcripts */}
      <div className="col-span-3">
        <BackfillPanel />
      </div>

      {/* PWA hard reset */}
      <div className="col-span-3">
        <PwaResetCard />
      </div>

      {/* Daemon log tail spans full width */}
      <div className="col-span-3">
        <LogTail />
      </div>
    </div>
  );
}

/* PWA hard-reset card.
 *
 * Forces a clean reload of the dashboard on any platform. Useful on
 * iPad where Safari aggressively caches the service worker and the
 * normal reload icon doesn't refresh the JS bundle. Steps in order:
 *
 *   1. unregister every service worker for this origin
 *   2. delete every CacheStorage cache (handles both SW caches and
 *      anything Workbox/RuntimeCache stashed)
 *   3. clear localStorage + sessionStorage (cosmetic; keeps state
 *      from leaking across resets)
 *   4. window.location.reload() with a cache-busting query param so
 *      Safari doesn't serve a 304 for the HTML shell
 *
 * Wrapped in try/catch per step so a single API miss (e.g. caches API
 * absent on a stripped browser) doesn't abort the whole reset. */
function PwaResetCard() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function hardReset() {
    setBusy(true);
    setMsg("Unregistering service workers…");
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch {
      /* continue */
    }
    try {
      setMsg("Clearing caches…");
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      /* continue */
    }
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* continue */
    }
    setMsg("Reloading…");
    const url = new URL(window.location.href);
    url.searchParams.set("_reset", String(Date.now()));
    // Tiny delay so the user sees the final message before the reload.
    setTimeout(() => {
      window.location.replace(url.toString());
    }, 300);
  }

  return (
    <section className="rounded-panel bg-surface1 hairline">
      <div className="px-5 py-3 border-b border-border1 flex items-center gap-2">
        <Icon name="RefreshCw" className="text-brandSoft" size={16} />
        <h2 className="font-display text-sm font-emphasized">Hard reset</h2>
      </div>
      <div className="px-5 py-4 flex items-center justify-between gap-4">
        <p className="text-xs text-txt3 max-w-md">
          Unregister the service worker, drop every cached asset, and reload
          with a cache-buster. Use this when iPad Safari (or any PWA) is
          serving a stale build.
        </p>
        <button
          type="button"
          onClick={hardReset}
          disabled={busy}
          className="h-9 px-4 rounded-input bg-err/10 hairline ring-1 ring-err/30 text-err text-xs font-emphasized disabled:opacity-40"
          aria-label="Hard reset PWA"
        >
          {busy ? msg ?? "resetting…" : "hard reset"}
        </button>
      </div>
    </section>
  );
}
