interface Props {
  status: "ok" | "warn" | "fail" | "live" | "ai" | "promoted" | "idle";
  pulse?: boolean;
  size?: number;
  className?: string;
}

const COLORS: Record<Props["status"], string> = {
  ok: "var(--c-ok)",
  warn: "var(--c-warn)",
  fail: "var(--c-err)",
  live: "var(--c-live)",
  ai: "var(--c-ai)",
  promoted: "var(--c-promoted)",
  idle: "var(--c-fg-disabled)",
};

export function StatusDot({ status, pulse, size = 8, className = "" }: Props) {
  return (
    <span
      aria-hidden
      className={`inline-block rounded-pill ${pulse ? "pulse-live" : ""} ${className}`}
      style={{ width: size, height: size, background: COLORS[status] }}
    />
  );
}
