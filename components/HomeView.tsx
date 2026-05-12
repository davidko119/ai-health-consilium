"use client";

import { useQuery } from "convex/react";
import { FileText, FlaskConical, Plus, Search } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { useSessionId } from "@/hooks/useSessionId";
import { StatusBadge } from "./StatusBadge";
import { ThemeToggle } from "./ThemeToggle";

export function HomeView() {
  const sessionId = useSessionId();
  const problems = useQuery(api.problems.list, sessionId ? { sessionId } : "skip");

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-6">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-5">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-md bg-[var(--ink)] text-white">
              <FlaskConical size={22} aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-2xl font-semibold">AI Health Consilium</h1>
              <p className="text-sm text-[var(--muted)]">Research gap sessions</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link className="primary-button" href="/new">
              <Plus size={17} aria-hidden="true" />
              New Consilium
            </Link>
          </div>
        </header>

        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Problems</h2>
            <div className="hidden items-center gap-2 text-sm text-[var(--muted)] sm:flex">
              <Search size={15} aria-hidden="true" />
              {problems ? `${problems.length} session${problems.length === 1 ? "" : "s"}` : "Loading"}
            </div>
          </div>

          {!problems && <ProblemSkeleton />}

          {problems?.length === 0 && (
            <div className="border border-[var(--line)] bg-[var(--surface)] p-8">
              <FileText className="mb-4 text-[var(--accent)]" size={28} aria-hidden="true" />
              <h3 className="text-xl font-semibold">No sessions yet</h3>
              <p className="mt-2 max-w-2xl text-[var(--muted)]">
                Create a research problem and the Convex workflow will assemble the expert panel,
                collect references, run the debate, and write the report.
              </p>
              <Link className="secondary-button mt-5 inline-flex" href="/new">
                <Plus size={16} aria-hidden="true" />
                New Consilium
              </Link>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {problems?.map((problem) => (
              <Link
                key={problem._id}
                href={`/problems/${problem._id}`}
                className="group min-h-44 border border-[var(--line)] bg-[var(--surface)] p-4 transition hover:border-[var(--accent)] hover:shadow-sm"
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <h3 className="line-clamp-2 text-lg font-semibold group-hover:text-[var(--accent)]">
                    {problem.title}
                  </h3>
                  <StatusBadge status={problem.status} />
                </div>
                <p className="line-clamp-3 text-sm leading-6 text-[var(--muted)]">
                  {problem.description}
                </p>
                <div className="mt-5 flex items-center justify-between text-xs text-[var(--muted)]">
                  <span>{problem.stage}</span>
                  <time>{formatDate(problem.createdAt)}</time>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function ProblemSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading problems">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-44 animate-pulse border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="mb-5 h-5 w-2/3 bg-[var(--soft)]" />
          <div className="mb-2 h-4 w-full bg-[var(--soft)]" />
          <div className="mb-2 h-4 w-5/6 bg-[var(--soft)]" />
          <div className="h-4 w-3/5 bg-[var(--soft)]" />
        </div>
      ))}
    </div>
  );
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}
