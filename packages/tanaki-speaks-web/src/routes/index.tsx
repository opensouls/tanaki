import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@/components/ClientOnly";
import { Suspense, lazy } from "react";

export const Route = createFileRoute("/")({ component: TanakiRoute });

const TanakiClient = lazy(() => import("@/components/TanakiClient"));

function TanakiRoute() {
  return (
    <ClientOnly
      fallback={
        <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
          <p className="font-mono text-sm">Loading…</p>
        </div>
      }
    >
      <Suspense
        fallback={
          <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
            <p className="font-mono text-sm">Loading Tanaki…</p>
          </div>
        }
      >
        <TanakiClient />
      </Suspense>
    </ClientOnly>
  );
}
