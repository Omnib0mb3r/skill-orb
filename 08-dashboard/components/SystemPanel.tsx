"use client";

import { useQuery } from "@tanstack/react-query";
import { systemMetrics, services as servicesClient } from "@/lib/daemon-client";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";

function fmtBytes(bytes: number): string {
  if (!bytes) return "0";
  const u = ["B", "K", "M", "G", "T"];
  const i = Math.min(u.length - 1, Math.floor(Math.log10(bytes) / 3));
  return `${(bytes / 10 ** (i * 3)).toFixed(1)}${u[i]}`;
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
            {disks.map((d) => (
              <Bar
                key={d.mount}
                pct={d.used_percent}
                label={`Disk ${d.mount}`}
                caption={`${fmtBytes(d.used_bytes)} / ${fmtBytes(d.total_bytes)}`}
                tone={d.used_percent > 90 ? "err" : d.used_percent > 80 ? "warn" : "ok"}
              />
            ))}
          </div>
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
              <li className="px-5 py-3 text-xs text-txt3">No service manifest found.</li>
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
    </div>
  );
}
