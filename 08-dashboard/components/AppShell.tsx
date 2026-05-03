"use client";

import { usePathname } from "next/navigation";
import { TopBar } from "./TopBar";
import { StreamDeck } from "./StreamDeck";
import { RightRail } from "./RightRail";
import { VitalsRibbon } from "./VitalsRibbon";
import { CommandPalette } from "./CommandPalette";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  // Match the active tab to the topmost path segment.
  const segments = pathname.split("/").filter(Boolean);
  const activeTab = segments.length === 0 ? "/" : `/${segments[0]}`;

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar activeTab={activeTab} />
      <div className="flex-1 flex min-h-0">
        <StreamDeck />
        <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
        <RightRail />
      </div>
      <VitalsRibbon />
      <CommandPalette />
    </div>
  );
}
