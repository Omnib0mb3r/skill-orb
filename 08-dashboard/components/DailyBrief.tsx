"use client";

import { useQuery } from "@tanstack/react-query";
import { dailyBrief } from "@/lib/daemon-client";
import { Icon } from "./Icon";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Working late,";
  if (h < 12) return "Good morning,";
  if (h < 18) return "Afternoon,";
  return "Evening,";
}

export function DailyBrief() {
  const q = useQuery({
    queryKey: ["daily-brief"],
    queryFn: dailyBrief,
    refetchInterval: 60_000,
  });

  return (
    <section className="rounded-panel bg-surface1 hairline relative overflow-hidden">
      <div className="absolute inset-0 grid-bg pointer-events-none" />
      <div className="relative px-7 py-6 flex items-start gap-5">
        <div className="flex-1 min-w-0">
          <div className="text-nano text-txt3 mb-1">
            Daily brief ·{" "}
            {new Date().toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </div>
          <h1 className="font-display text-3xl font-bold leading-snug text-txt1 mb-2">
            {greeting()} <span className="text-brandSoft">Michael</span>.
          </h1>
          {q.isLoading ? (
            <div className="space-y-1.5">
              <div className="h-3 w-3/4 rounded bg-surface2 animate-pulse" />
              <div className="h-3 w-1/2 rounded bg-surface2 animate-pulse" />
            </div>
          ) : q.data?.brief ? (
            <p className="text-txt2 text-md max-w-2xl whitespace-pre-line">{q.data.brief}</p>
          ) : (
            <p className="text-txt3 text-sm">
              The brief generator hasn&apos;t produced anything yet. It runs overnight and lands here
              when ready.
            </p>
          )}
        </div>
        <button
          className="shrink-0 h-9 px-3.5 rounded-card bg-brand/10 hairline ring-1 ring-brand/30 text-brandSoft text-xs font-emphasized hover:bg-brand/15 flex items-center gap-2"
          aria-label="Run brief now"
        >
          <Icon name="Sparkles" size={14} /> run now
        </button>
      </div>

      {q.data?.whats_new && q.data.whats_new.length > 0 && (
        <div className="relative border-t border-border2 px-7 py-4">
          <div className="text-nano text-txt3 mb-2">What&apos;s new</div>
          <ul className="space-y-1.5">
            {q.data.whats_new.slice(0, 5).map((item, i) => (
              <li key={i} className="text-sm text-txt2 flex items-start gap-2">
                <span className="text-brandSoft mt-1">·</span>
                <span className="flex-1">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
