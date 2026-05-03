import { AppShell } from "@/components/AppShell";
import { SessionsTable } from "@/components/SessionsTable";

export default function SessionsPage() {
  return (
    <AppShell>
      <div className="px-6 py-5">
        <SessionsTable />
      </div>
    </AppShell>
  );
}
