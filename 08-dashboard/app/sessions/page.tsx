import { AppShell } from "@/components/AppShell";

export default function SessionsPage() {
  return (
    <AppShell>
      <div className="px-6 py-5">
        <div className="rounded-panel bg-surface1 hairline p-8">
          <h1 className="font-display text-2xl font-emphasized mb-2">Sessions</h1>
          <p className="text-txt3 text-sm">
            Detailed session view + send-prompt panel lands in Phase 3.4.2.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
