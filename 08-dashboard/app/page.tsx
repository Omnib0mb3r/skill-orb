import { AppShell } from "@/components/AppShell";
import { DailyBrief } from "@/components/DailyBrief";
import { InstallPrompt } from "@/components/InstallPrompt";

export default function HomePage() {
  return (
    <AppShell>
      <div className="px-6 py-5 flex flex-col gap-5">
        <div className="flex items-center justify-end">
          <InstallPrompt />
        </div>
        <DailyBrief />
        {/* Project status grid + Orb panel land here in 3.4.4. Stubbed for now. */}
        <section className="grid grid-cols-2 gap-5">
          <div className="rounded-panel bg-surface1 hairline p-6 min-h-[220px]">
            <div className="text-nano text-txt3 mb-2">Projects</div>
            <p className="text-txt3 text-xs">
              Project status grid wires up in Phase 3.4.4.
            </p>
          </div>
          <div className="rounded-panel bg-surface1 hairline p-6 min-h-[220px]">
            <div className="text-nano text-txt3 mb-2">Orb</div>
            <p className="text-txt3 text-xs">
              Orb visualization launches in Phase 4.
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
