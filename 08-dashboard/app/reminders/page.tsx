import { AppShell } from "@/components/AppShell";

export default function RemindersPage() {
  return (
    <AppShell>
      <div className="px-6 py-5">
        <div className="rounded-panel bg-surface1 hairline p-8">
          <h1 className="font-display text-2xl font-emphasized mb-2">Reminders</h1>
          <p className="text-txt3 text-sm">
            Full reminders list, quick-add, and notification routing lands in Phase 3.4.5.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
