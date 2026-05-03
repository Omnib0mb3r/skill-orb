"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createProject } from "@/lib/daemon-client";
import { Icon } from "./Icon";

const STAGES = ["alpha", "beta", "deployed", "archived"] as const;

interface Props {
  onClose: () => void;
}

export function NewProjectModal({ onClose }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [stage, setStage] = useState<(typeof STAGES)[number]>("alpha");
  const [tags, setTags] = useState("");
  const [description, setDescription] = useState("");
  const [openVscode, setOpenVscode] = useState(true);

  const m = useMutation({
    mutationFn: () =>
      createProject({
        name,
        stage,
        description,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        open_vscode: openVscode,
      }),
    onSuccess: (r) => {
      if (r.ok) {
        qc.invalidateQueries({ queryKey: ["projects"] });
        onClose();
      }
    },
  });

  const nameValid = /^[a-z0-9-]{2,}$/.test(name);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center px-6"
      style={{ background: "var(--c-bg-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-panel bg-surface1 hairline p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-base font-emphasized">New project</h2>
          <button
            onClick={onClose}
            aria-label="Close new project modal"
            className="text-txt3 hover:text-txt1"
          >
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="np-name" className="text-nano text-txt3 block mb-1">
              Name (kebab-case)
            </label>
            <input
              id="np-name"
              name="np-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="warehouse-sim"
              className="w-full h-9 px-3 rounded-input bg-surface2 hairline text-txt1 outline-none focus:ring-1 focus:ring-brand/60 text-sm font-mono"
            />
          </div>

          <div>
            <label htmlFor="np-stage" className="text-nano text-txt3 block mb-1">
              Stage
            </label>
            <select
              id="np-stage"
              name="np-stage"
              value={stage}
              onChange={(e) => setStage(e.target.value as (typeof STAGES)[number])}
              className="w-full h-9 px-3 rounded-input bg-surface2 hairline text-txt1 outline-none focus:ring-1 focus:ring-brand/60 text-sm"
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="np-tags" className="text-nano text-txt3 block mb-1">
              Tags
            </label>
            <input
              id="np-tags"
              name="np-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="conveyor, sim, warehouse"
              className="w-full h-9 px-3 rounded-input bg-surface2 hairline text-txt1 outline-none focus:ring-1 focus:ring-brand/60 text-sm font-mono"
            />
          </div>

          <div>
            <label htmlFor="np-desc" className="text-nano text-txt3 block mb-1">
              Description
            </label>
            <input
              id="np-desc"
              name="np-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One-line description (auto-fills devneural.jsonc)"
              className="w-full h-9 px-3 rounded-input bg-surface2 hairline text-txt1 outline-none focus:ring-1 focus:ring-brand/60 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-txt2">
            <input
              type="checkbox"
              checked={openVscode}
              onChange={(e) => setOpenVscode(e.target.checked)}
              aria-label="Open in VS Code"
              className="w-3.5 h-3.5 accent-brand bg-surface1"
            />
            Open in VS Code on OTLCDEV
          </label>
        </div>

        {m.isError && (
          <div className="mt-3 text-xs text-err font-mono">
            Failed: {(m.error as Error).message}
          </div>
        )}
        {m.data && !m.data.ok && (
          <div className="mt-3 text-xs text-err font-mono">{m.data.error}</div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-input text-txt3 hover:text-txt1 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => m.mutate()}
            disabled={!nameValid || m.isPending}
            className="h-9 px-4 rounded-input bg-brand hover:bg-brand/90 text-base text-sm font-emphasized disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {m.isPending ? "creating…" : "create + scaffold"}
          </button>
        </div>
      </div>
    </div>
  );
}
