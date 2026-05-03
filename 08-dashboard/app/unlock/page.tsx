import { Suspense } from "react";
import { UnlockForm } from "./UnlockForm";

export default function UnlockPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen grid place-items-center">
          <div className="text-nano text-txt3">connecting…</div>
        </div>
      }
    >
      <UnlockForm />
    </Suspense>
  );
}
