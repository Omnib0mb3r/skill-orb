"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  queuePrompt,
  focusSession,
  bridgeStatus,
  DaemonError,
} from "@/lib/daemon-client";
import { Icon } from "./Icon";

interface Props {
  sessionId: string;
}

export function SendPromptForm({ sessionId }: Props) {
  const [text, setText] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [failMsg, setFailMsg] = useState<string | null>(null);

  // Poll bridge liveness so the user sees the form go red and the send
  // button disable when no VS Code window is running the bridge. Saves
  // them from typing a prompt that would fail anyway.
  const bridge = useQuery({
    queryKey: ["bridge-status"],
    queryFn: bridgeStatus,
    refetchInterval: 5_000,
  });

  const sendM = useMutation({
    mutationFn: (t: string) => queuePrompt(sessionId, t),
    onSuccess: (data, vars) => {
      if (data.ok) {
        setRecent((r) => [vars, ...r].slice(0, 3));
        setText("");
        setFailMsg(null);
      } else {
        setFailMsg(data.error ?? "queue refused");
      }
    },
    onError: (err) => {
      const e = err as DaemonError;
      const payload = e.payload as { error?: string } | undefined;
      setFailMsg(payload?.error ?? e.message);
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
          <span
            className={`text-nano font-mono ml-2 ${
              bridge.data?.alive ? "text-promoted" : "text-err"
            }`}
            title={
              bridge.data?.alive
                ? `bridge alive (last seen ${Math.round((bridge.data.age_ms ?? 0) / 1000)}s ago)`
                : "bridge offline. Reload your VS Code DevNeural window."
            }
          >
            {bridge.isLoading
              ? "bridge ?"
              : bridge.data?.alive
                ? "bridge live"
                : "bridge offline"}
          </span>
        </div>
        <button
          onClick={() => focusM.mutate()}
          disabled={focusM.isPending}
          className="text-xs font-mono text-txt3 hover:text-txt1 flex items-center gap-1"
        >
          <Icon name="Focus" size={14} />{" "}
          {focusM.isPending ? "focusing..." : "focus window"}
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
            disabled={!text.trim() || sendM.isPending || bridge.data?.alive === false}
            className="h-9 px-4 rounded-input bg-brand hover:bg-brand/90 text-base text-sm font-emphasized disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {sendM.isPending ? "queuing..." : "send"}
          </button>
        </div>
        {failMsg && (
          <div className="text-xs text-err font-mono">
            Failed to queue: {failMsg}
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
