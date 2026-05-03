import { AppShell } from "@/components/AppShell";

export default function ProjectsPage() {
  return (
    <AppShell>
      <div className="px-6 py-5">
        <div className="rounded-panel bg-surface1 hairline p-8">
          <h1 className="font-display text-2xl font-emphasized mb-2">Projects</h1>
          <p className="text-txt3 text-sm">
            Project grid + new-project flow lands in Phase 3.4.4.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
