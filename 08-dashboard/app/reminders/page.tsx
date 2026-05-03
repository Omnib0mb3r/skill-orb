import { AppShell } from "@/components/AppShell";
import { RemindersPanel } from "@/components/RemindersPanel";

export default function RemindersPage() {
  return (
    <AppShell>
      <div className="px-6 py-5 space-y-5 max-w-3xl">
        <h1 className="font-display text-2xl font-emphasized">Reminders</h1>
        <RemindersPanel />
      </div>
    </AppShell>
  );
}
