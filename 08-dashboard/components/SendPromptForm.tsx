"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queuePrompt, focusSession } from "@/lib/daemon-client";
import { Icon } from "./Icon";

interface Props {
  sessionId: string;
}

export function SendPromptForm({ sessionId }: Props) {
  const [text, setText] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  const sendM = useMutation({
    mutationFn: (t: string) => queuePrompt(sessionId, t),
    onSuccess: (_data, vars) => {
      setRecent((r) => [vars, ...r].slice(0, 3));
      setText("");
    },
  });

  const focusM = useMutation({
    mutationFn: () => focusSession(sessionId),
  });

  return (
    <div className="rounded-panel bg-surface1 hairline">
      <div className="px-5 py-3 border-b border-border1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="Send" className="text-brandSoft" size={16} />
          <h2 className="font-display text-sm font-emphasized">Steer this session</h2>
        </div>
        <button
          onClick={() => focusM.mutate()}
          disabled={focusM.isPending}
          className="text-xs font-mono text-txt3 hover:text-txt1 flex items-center gap-1"
        >
          <Icon name="Focus" size={14} />{" "}
          {focusM.isPending ? "focusing…" : "focus window"}
        </button>
      </div>
      <form
        className="p-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) sendM.mutate(text.trim());
        }}
      >
        <label htmlFor="prompt-input" className="sr-only">
          Prompt text
        </label>
        <textarea
          id="prompt-input"
          name="prompt-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a prompt to send to this session…"
          rows={3}
          className="w-full px-3 py-2 rounded-input bg-surface2 hairline text-txt1 outline-none focus:ring-1 focus:ring-brand/60 text-sm font-mono resize-y placeholder:text-txt3"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim()) {
              e.preventDefault();
              sendM.mutate(text.trim());
            }
          }}
        />
        <div className="flex items-center justify-between">
          <div className="text-nano text-txt3">
            <kbd className="font-mono">⌘↵</kbd> to send
          </div>
          <button
            type="submit"
            disabled={!text.trim() || sendM.isPending}
            className="h-9 px-4 rounded-input bg-brand hover:bg-brand/90 text-base text-sm font-emphasized disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {sendM.isPending ? "queuing…" : "send"}
          </button>
        </div>
        {sendM.isError && (
          <div className="text-xs text-err font-mono">
            Failed to queue: {(sendM.error as Error).message}
          </div>
        )}
      </form>

      {recent.length > 0 && (
        <div className="border-t border-border2 px-5 py-3">
          <div className="text-nano text-txt3 mb-1.5">Recently sent</div>
          <ul className="space-y-1">
            {recent.map((r, i) => (
              <li key={i} className="text-xs font-mono text-txt2 truncate">
                ↳ {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
