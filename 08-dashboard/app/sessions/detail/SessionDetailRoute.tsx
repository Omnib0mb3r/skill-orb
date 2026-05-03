"use client";

import { useSearchParams } from "next/navigation";
import { SessionDetail } from "@/components/SessionDetail";
import { SendPromptForm } from "@/components/SendPromptForm";

export function SessionDetailRoute() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";

  if (!id) {
    return (
      <div className="px-6 py-5 text-sm text-txt3">
        Missing session id. Open a session from the Stream Deck or the Sessions tab.
      </div>
    );
  }

  return (
    <div className="px-6 py-5 grid grid-cols-3 gap-5">
      <div className="col-span-2">
        <SessionDetail sessionId={id} />
      </div>
      <div className="col-span-1">
        <SendPromptForm sessionId={id} />
      </div>
    </div>
  );
}
