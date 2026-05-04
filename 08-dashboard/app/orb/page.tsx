import { AppShell } from "@/components/AppShell";
import { Orb } from "@/components/Orb";

export default function OrbPage() {
  return (
    <AppShell>
      {/* Orb fills the main content area. AppShell already reserves space for
       * the TopBar, ribbons, and side panels; the canvas just needs to expand
       * inside <main>. */}
      {/* sr-only h1 satisfies axe page-has-heading-one without taking
          visual space; the orb canvas already supplies the page identity. */}
      <h1 className="sr-only">Neural network</h1>
      <div className="h-[calc(100vh-7rem)] w-full">
        <Orb />
      </div>
    </AppShell>
  );
}
