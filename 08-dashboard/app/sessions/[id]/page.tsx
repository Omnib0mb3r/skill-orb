import { AppShell } from "@/components/AppShell";
import { SessionDetail } from "@/components/SessionDetail";
import { SendPromptForm } from "@/components/SendPromptForm";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell>
      <div className="px-6 py-5 grid grid-cols-3 gap-5">
        <div className="col-span-2">
          <SessionDetail sessionId={id} />
        </div>
        <div className="col-span-1">
          <SendPromptForm sessionId={id} />
        </div>
      </div>
    </AppShell>
  );
}
