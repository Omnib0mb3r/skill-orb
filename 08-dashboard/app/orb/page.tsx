import { AppShell } from "@/components/AppShell";
import { Orb } from "@/components/Orb";

export default function OrbPage() {
  return (
    <AppShell>
      {/* Orb fills the main content area. AppShell already reserves space for
       * the TopBar, ribbons, and side panels; the canvas just needs to expand
       * inside <main>. */}
      <div className="h-[calc(100vh-7rem)] w-full">
        <Orb />
      </div>
    </AppShell>
  );
}
