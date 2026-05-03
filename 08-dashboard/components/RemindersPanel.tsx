"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  reminders as remindersClient,
  createReminder,
  completeReminder,
  deleteReminder,
} from "@/lib/daemon-client";
import { Icon } from "./Icon";
import { PushSubscribeButton } from "./PushSubscribeButton";

export function RemindersPanel() {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);

  const q = useQuery({
    queryKey: ["reminders"],
    queryFn: remindersClient,
    refetchInterval: 30_000,
  });

  const createM = useMutation({
    mutationFn: (input: { title: string; due_at?: string }) => createReminder(input),
    onSuccess: () => {
      setTitle("");
      setDueAt("");
      qc.invalidateQueries({ queryKey: ["reminders"] });
    },
  });

  const toggleM = useMutation({
    mutationFn: ({ id, complete }: { id: string; complete: boolean }) =>
      completeReminder(id, complete),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reminders"] }),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => deleteReminder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reminders"] }),
  });

  const all = q.data?.reminders ?? [];
  const open = all.filter((r) => !r.completed_at && !r.archived_at);
  const done = all.filter((r) => r.completed_at && !r.archived_at);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <PushSubscribeButton />
      </div>
      {/* Quick add */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          createM.mutate({
            title: title.trim(),
            ...(dueAt ? { due_at: new Date(dueAt).toISOString() } : {}),
          });
        }}
        className="rounded-panel bg-surface1 hairline p-4 flex items-center gap-3"
      >
        <Icon name="Plus" className="text-brandSoft" size={18} />
        <label htmlFor="rem-title" className="sr-only">
          Reminder title
        </label>
        <input
          id="rem-title"
          name="rem-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a reminder…"
          className="bg-transparent flex-1 text-sm outline-none text-txt1 placeholder:text-txt3"
        />
        <label htmlFor="rem-due" className="sr-only">
          Due date
        </label>
        <input
          id="rem-due"
          name="rem-due"
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="h-8 px-2 rounded-input bg-surface2 hairline text-xs font-mono text-txt2 outline-none"
        />
        <button
          type="submit"
          disabled={!title.trim() || createM.isPending}
          className="h-8 px-3 rounded-input bg-brand text-base text-xs font-emphasized disabled:opacity-40"
        >
          add
        </button>
      </form>

      {/* Open */}
      <section className="rounded-panel bg-surface1 hairline">
        <div className="px-5 py-3 border-b border-border1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="ListChecks" className="text-brandSoft" size={16} />
            <h2 className="font-display text-sm font-emphasized">Open</h2>
          </div>
          <span className="text-nano text-txt3">{open.length}</span>
        </div>
        <ul className="divide-y divide-border2">
          {open.length === 0 && (
            <li className="px-5 py-4 text-xs text-txt3">All caught up.</li>
          )}
          {open.map((r) => (
            <li key={r.id} className="px-5 py-3 flex items-center gap-3">
              <input
                type="checkbox"
                aria-label={`Complete ${r.title}`}
                checked={false}
                onChange={(e) => toggleM.mutate({ id: r.id, complete: e.target.checked })}
                className="w-4 h-4 accent-brand bg-surface1"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-txt1">{r.title}</div>
                {r.due_at && (
                  <div className="text-nano text-txt3 mt-0.5">
                    due {new Date(r.due_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                )}
              </div>
              <button
                onClick={() => deleteM.mutate(r.id)}
                aria-label="Delete reminder"
                className="text-txt3 hover:text-err"
              >
                <Icon name="Trash2" size={14} />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Completed */}
      {done.length > 0 && (
        <section className="rounded-panel bg-surface1 hairline">
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            className="w-full px-5 py-3 border-b border-border1 flex items-center justify-between text-left lift"
          >
            <div className="flex items-center gap-2">
              <Icon name="CheckCircle2" className="text-ok" size={16} />
              <h2 className="font-display text-sm font-emphasized">Completed</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-nano text-txt3">{done.length}</span>
              <Icon name={showCompleted ? "ChevronUp" : "ChevronDown"} size={14} />
            </div>
          </button>
          {showCompleted && (
            <ul className="divide-y divide-border2">
              {done.slice(0, 30).map((r) => (
                <li key={r.id} className="px-5 py-3 flex items-center gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Reopen ${r.title}`}
                    checked
                    onChange={(e) =>
                      toggleM.mutate({ id: r.id, complete: e.target.checked })
                    }
                    className="w-4 h-4 accent-brand bg-surface1"
                  />
                  <span className="flex-1 text-sm text-txt3 line-through truncate">
                    {r.title}
                  </span>
                  <span className="text-nano text-txt3">
                    {r.completed_at &&
                      new Date(r.completed_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
