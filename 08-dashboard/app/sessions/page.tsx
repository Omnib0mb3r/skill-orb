"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { SessionsTable } from "@/components/SessionsTable";
import { NewProjectModal } from "@/components/NewProjectModal";
import { Icon } from "@/components/Icon";

export default function SessionsPage() {
  const [creating, setCreating] = useState(false);

  return (
    <AppShell>
      <div className="px-6 py-5 space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-emphasized">Sessions</h1>
          <button
            onClick={() => setCreating(true)}
            className="h-9 px-3.5 rounded-card bg-brand/10 hairline ring-1 ring-brand/30 text-brandSoft text-xs font-emphasized hover:bg-brand/15 flex items-center gap-2"
            aria-label="Start a new project + Claude session"
          >
            <Icon name="Plus" size={14} /> new session
          </button>
        </div>
        <p className="text-sm text-txt3 max-w-2xl">
          Each row is a Claude Code session captured on OTLCDEV. Click a row to read the
          transcript, send a prompt to the running terminal, or focus the VSCode window. New
          sessions auto-appear within 5s of running <code className="font-mono">claude</code> in
          any DevNeural-aware project.
        </p>
        <SessionsTable />
      </div>

      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
    </AppShell>
  );
}
