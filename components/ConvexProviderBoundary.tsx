"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { Database, Terminal } from "lucide-react";
import { useMemo } from "react";
import type { ReactNode } from "react";

export function ConvexProviderBoundary({ children }: { children: ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const client = useMemo(
    () => (convexUrl ? new ConvexReactClient(convexUrl) : null),
    [convexUrl],
  );

  if (!client) {
    return <MissingConvexUrl />;
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}

function MissingConvexUrl() {
  return (
    <main className="min-h-screen bg-[var(--background)] px-6 py-10 text-[var(--foreground)]">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-md bg-[var(--accent)] text-white">
            <Database size={20} aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold">Convex URL required</h1>
            <p className="text-sm text-[var(--muted)]">
              Set up Convex before opening the application workspace.
            </p>
          </div>
        </div>
        <div className="border border-[var(--line)] bg-[var(--soft)] p-4 font-mono text-sm">
          <div className="mb-3 flex items-center gap-2 text-[var(--muted)]">
            <Terminal size={16} aria-hidden="true" />
            Local setup
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap">{`npx convex dev
# copy the printed deployment URL into .env.local
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud`}</pre>
        </div>
      </div>
    </main>
  );
}
