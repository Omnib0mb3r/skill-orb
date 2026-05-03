import { AppShell } from "@/components/AppShell";

export default function SystemPage() {
  return (
    <AppShell>
      <div className="px-6 py-5">
        <div className="rounded-panel bg-surface1 hairline p-8">
          <h1 className="font-display text-2xl font-emphasized mb-2">System</h1>
          <p className="text-txt3 text-sm">
            CPU/RAM/disk/GPU charts + service status grid lands in Phase 3.4.4 / 3.8.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
