import { AppShell } from "@/components/AppShell";
import { SystemPanel } from "@/components/SystemPanel";

export default function SystemPage() {
  return (
    <AppShell>
      <div className="px-6 py-5 space-y-5">
        <h1 className="font-display text-2xl font-emphasized">System</h1>
        <SystemPanel />
      </div>
    </AppShell>
  );
}
