"use client";

import { useQuery } from "@tanstack/react-query";
import { systemMetrics, services as servicesClient } from "@/lib/daemon-client";
import { StatusDot } from "./StatusDot";

function fmtBytes(bytes: number): string {
  if (!bytes) return "0";
  const u = ["B", "K", "M", "G", "T"];
  const i = Math.min(u.length - 1, Math.floor(Math.log10(bytes) / 3));
  return `${(bytes / 10 ** (i * 3)).toFixed(1)}${u[i]}`;
}

export function VitalsRibbon() {
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
  const mem = m.data?.memory.used_percent ?? 0;
  const dataRoot = m.data?.data_root_bytes ?? 0;
  const svc = s.data?.services ?? [];

  return (
    <footer className="h-10 flex items-center px-5 gap-5 hairline-soft border-t border-border2 bg-surface1">
      <div className="text-[11px] font-mono text-txt3 flex items-center gap-2">
        CPU <span className="text-txt1">{cpu.toFixed(0)}%</span>
      </div>
      <div className="text-[11px] font-mono text-txt3 flex items-center gap-2">
        MEM <span className="text-txt1">{mem.toFixed(0)}%</span>
      </div>
      <div className="text-[11px] font-mono text-txt3 flex items-center gap-2">
        DATA <span className="text-txt1">{fmtBytes(dataRoot)}</span>
      </div>
      <div className="ml-auto flex items-center gap-3 text-[11px] font-mono text-txt3">
        {/* The services manifest already contains ollama, so we render it once here. */}
        {svc.slice(0, 6).map((svcEntry) => (
          <span key={svcEntry.id} className="flex items-center gap-1.5">
            <StatusDot status={svcEntry.status === "ok" ? "ok" : svcEntry.status === "warn" ? "warn" : "fail"} size={6} />
            {svcEntry.label}
          </span>
        ))}
      </div>
    </footer>
  );
}
