"use client";

import { useMutation } from "convex/react";
import { ArrowLeft, LoaderCircle, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import { useSessionId } from "@/hooks/useSessionId";

export function NewConsiliumForm() {
  const router = useRouter();
  const sessionId = useSessionId();
  const createProblem = useMutation(api.problems.create);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [constraints, setConstraints] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionId || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const problemId = await createProblem({
        sessionId,
        title,
        description,
        constraints: constraints.trim() ? constraints : undefined,
      });
      router.push(`/problems/${problemId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create the session.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-5 py-6 text-[var(--foreground)]">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between border-b border-[var(--line)] pb-5">
          <div>
            <h1 className="text-2xl font-semibold">New Consilium</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">Define the biomedical research problem.</p>
          </div>
          <Link className="icon-button" href="/" title="Back">
            <ArrowLeft size={17} aria-hidden="true" />
            <span className="sr-only">Back</span>
          </Link>
        </div>

        <form className="grid gap-5 border border-[var(--line)] bg-[var(--surface)] p-5" onSubmit={onSubmit}>
          <label className="grid gap-2">
            <span className="text-sm font-medium">Title</span>
            <input
              className="field"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              minLength={3}
              maxLength={140}
              placeholder="BDNF modulation and motor outcomes in adolescent cerebral palsy"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Detailed question and context</span>
            <textarea
              className="field min-h-56 resize-y"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              required
              minLength={12}
              maxLength={8000}
              placeholder="Can BDNF modulation improve motor outcomes in adolescent cerebral palsy patients? Include relevant population, intervention, comparator, outcomes, mechanisms, and uncertainty."
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Constraints</span>
            <textarea
              className="field min-h-28 resize-y"
              value={constraints}
              onChange={(event) => setConstraints(event.target.value)}
              maxLength={3000}
              placeholder="Population, intervention, outcomes, timeframe, study types, or exclusions"
            />
          </label>

          {error && (
            <div className="border border-[#a3483d33] bg-[#f8e7e3] px-4 py-3 text-sm text-[#8f3329]">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
            <p className="text-sm text-[var(--muted)]">
              The workflow starts automatically after the problem is saved.
            </p>
            <button className="primary-button" type="submit" disabled={submitting || !sessionId}>
              {submitting ? (
                <LoaderCircle className="animate-spin" size={17} aria-hidden="true" />
              ) : (
                <Plus size={17} aria-hidden="true" />
              )}
              Create
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
