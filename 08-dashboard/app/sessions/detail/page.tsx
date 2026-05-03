import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { SessionDetailRoute } from "./SessionDetailRoute";

/* Static export does not allow dynamic [id] routes without
 * generateStaticParams. Sessions are fully dynamic, so the detail page is
 * statically rendered as a shell that reads ?id=... at runtime. The
 * StreamDeck + SessionsTable link to /sessions/detail?id=<session_id>. */
export default function SessionDetailPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="px-6 py-5 text-nano text-txt3">loading session…</div>
        }
      >
        <SessionDetailRoute />
      </Suspense>
    </AppShell>
  );
}
