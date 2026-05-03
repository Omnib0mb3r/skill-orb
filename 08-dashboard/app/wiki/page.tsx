import { AppShell } from "@/components/AppShell";

export default function WikiPage() {
  return (
    <AppShell>
      <div className="px-6 py-5">
        <div className="rounded-panel bg-surface1 hairline p-8">
          <h1 className="font-display text-2xl font-emphasized mb-2">Wiki</h1>
          <p className="text-txt3 text-sm">
            Search across wiki pages, raw chunks, and reference docs lands in Phase 3.4.3.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
