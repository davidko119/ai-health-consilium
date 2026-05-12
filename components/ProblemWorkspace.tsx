"use client";

import { useMutation, useQuery } from "convex/react";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  FileText,
  FlaskConical,
  ListFilter,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSessionId } from "@/hooks/useSessionId";
import { MarkdownReport } from "./MarkdownReport";
import { ProgressRail } from "./ProgressRail";
import { StatusBadge } from "./StatusBadge";
import { ThemeToggle } from "./ThemeToggle";

export function ProblemWorkspace({ problemId }: { problemId: Id<"problems"> }) {
  const sessionId = useSessionId();
  const workspace = useQuery(
    api.problems.getWorkspace,
    sessionId ? { problemId, sessionId } : "skip",
  );
  const problems = useQuery(api.problems.list, sessionId ? { sessionId } : "skip");
  const retry = useMutation(api.problems.retry);
  const [tab, setTab] = useState<"references" | "gaps">("references");
  const [filter, setFilter] = useState("");
  const [selectedGap, setSelectedGap] = useState<Doc<"gapCandidates"> | null>(null);
  const [retrying, setRetrying] = useState(false);

  const finalReport = useMemo(() => {
    if (!workspace) {
      return undefined;
    }
    return [...workspace.messages].reverse().find((message) => message.stepType === "finalReport");
  }, [workspace]);

  if (workspace === undefined) {
    return <WorkspaceLoading />;
  }

  if (workspace === null) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--background)] p-6">
        <div className="border border-[var(--line)] bg-[var(--surface)] p-6">
          <AlertCircle className="mb-3 text-[#8f3329]" size={26} aria-hidden="true" />
          <h1 className="text-xl font-semibold">Problem not found</h1>
          <Link className="secondary-button mt-5 inline-flex" href="/">
            <ArrowLeft size={16} aria-hidden="true" />
            Back
          </Link>
        </div>
      </main>
    );
  }

  const filteredReferences = workspace.references.filter((reference) =>
    `${reference.title} ${reference.abstract ?? ""} ${reference.tags.join(" ")}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const filteredGaps = workspace.gapCandidates.filter((gap) =>
    `${gap.title} ${gap.description}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const discussionMessages = workspace.messages.filter((message) => message.stepType !== "finalReport");

  async function retryWorkflow() {
    if (!sessionId || retrying) {
      return;
    }
    setRetrying(true);
    try {
      await retry({ problemId, sessionId });
    } finally {
      setRetrying(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="grid min-h-screen xl:grid-cols-[280px_1fr_380px]">
        <aside className="hidden border-r border-[var(--line)] bg-[var(--surface)] xl:block">
          <WorkspaceSidebar problems={problems ?? []} activeProblemId={problemId} />
        </aside>

        <section className="min-w-0 px-4 py-5 md:px-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] pb-5">
            <div className="min-w-0">
              <div className="mb-3 flex items-center gap-2 xl:hidden">
                <Link className="icon-button" href="/" title="Back">
                  <ArrowLeft size={16} aria-hidden="true" />
                  <span className="sr-only">Back</span>
                </Link>
                <Link className="secondary-button" href="/new">
                  New
                </Link>
                <ThemeToggle />
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <StatusBadge status={workspace.problem.status} />
                {workspace.problem.status === "running" && (
                  <span className="inline-flex h-7 items-center gap-2 text-sm text-[var(--muted)]">
                    <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
                    Thinking
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-semibold md:text-3xl">{workspace.problem.title}</h1>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--muted)]">
                {workspace.problem.description}
              </p>
              {workspace.problem.error && (
                <div className="mt-4 border border-[#a3483d33] bg-[#f8e7e3] px-4 py-3 text-sm text-[#8f3329]">
                  {workspace.problem.error}
                </div>
              )}
            </div>

            <div className="hidden items-center gap-2 xl:flex">
              <ThemeToggle />
              {workspace.problem.status === "failed" && (
                <button className="secondary-button" type="button" onClick={retryWorkflow}>
                  <RefreshCw size={16} className={retrying ? "animate-spin" : ""} aria-hidden="true" />
                  Retry
                </button>
              )}
            </div>
          </div>

          <div className="mb-5">
            <ProgressRail stage={workspace.problem.stage} />
          </div>

          <div className="mb-5 grid gap-3 md:grid-cols-4">
            <Metric label="Agents" value={workspace.agents.length} />
            <Metric label="References" value={workspace.references.length} />
            <Metric label="Gaps" value={workspace.gapCandidates.length} />
            <Metric label="LLM calls" value={workspace.usageSummary.calls} />
          </div>

          {finalReport && (
            <div className="mb-5">
              <MarkdownReport content={finalReport.content} title={workspace.problem.title} />
            </div>
          )}

          <MessageStream messages={discussionMessages} agents={workspace.agents} />
        </section>

        <aside className="border-t border-[var(--line)] bg-[var(--surface)] xl:border-l xl:border-t-0">
          <div className="sticky top-0 max-h-screen overflow-y-auto p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ListFilter size={17} aria-hidden="true" />
                <h2 className="text-lg font-semibold">Evidence</h2>
              </div>
              <div className="flex border border-[var(--line)]">
                <button
                  className={`tab-button ${tab === "references" ? "tab-button-active" : ""}`}
                  type="button"
                  onClick={() => setTab("references")}
                >
                  Refs
                </button>
                <button
                  className={`tab-button ${tab === "gaps" ? "tab-button-active" : ""}`}
                  type="button"
                  onClick={() => setTab("gaps")}
                >
                  Gaps
                </button>
              </div>
            </div>

            <label className="mb-4 flex h-10 items-center gap-2 border border-[var(--line)] bg-white px-3 text-sm">
              <Search size={15} className="text-[var(--muted)]" aria-hidden="true" />
              <input
                className="min-w-0 flex-1 bg-transparent outline-none"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter"
              />
            </label>

            {tab === "references" ? (
              <ReferenceList references={filteredReferences} />
            ) : (
              <GapList gaps={filteredGaps} onSelect={setSelectedGap} />
            )}
          </div>
        </aside>
      </div>

      {selectedGap && <GapDetailPanel gap={selectedGap} onClose={() => setSelectedGap(null)} />}
    </main>
  );
}

function WorkspaceSidebar({
  problems,
  activeProblemId,
}: {
  problems: Doc<"problems">[];
  activeProblemId: Id<"problems">;
}) {
  return (
    <div className="flex h-screen flex-col">
      <div className="border-b border-[var(--line)] p-4">
        <Link className="mb-4 flex items-center gap-3" href="/">
          <span className="flex size-9 items-center justify-center rounded-md bg-[var(--ink)] text-white">
            <FlaskConical size={18} aria-hidden="true" />
          </span>
          <span className="font-semibold">AI Health Consilium</span>
        </Link>
        <Link className="primary-button w-full justify-center" href="/new">
          New Consilium
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {problems.map((problem) => (
          <Link
            key={problem._id}
            href={`/problems/${problem._id}`}
            className={`mb-2 block border p-3 text-sm ${
              problem._id === activeProblemId
                ? "border-[var(--accent)] bg-[#dff4ef]"
                : "border-[var(--line)] bg-white hover:border-[var(--accent)]"
            }`}
          >
            <div className="mb-2 line-clamp-2 font-medium">{problem.title}</div>
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
              <span>{problem.stage}</span>
              <span>{problem.status}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
      <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
      <div className="text-sm text-[var(--muted)]">{label}</div>
    </div>
  );
}

function MessageStream({
  messages,
  agents,
}: {
  messages: Doc<"agentMessages">[];
  agents: Doc<"agents">[];
}) {
  const agentNames = new Set(agents.map((agent) => agent.name));

  return (
    <section className="border border-[var(--line)] bg-[var(--surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
        <MessageSquareText size={17} aria-hidden="true" />
        <h2 className="text-lg font-semibold">Conversation trace</h2>
      </div>
      <div className="grid gap-3 p-4">
        {messages.length === 0 && (
          <div className="py-10 text-center text-sm text-[var(--muted)]">No messages yet.</div>
        )}
        {messages.map((message) => {
          const isAgent = agentNames.has(message.speakerName);
          return (
            <article
              key={message._id}
              className={`border p-4 ${
                message.stepType === "error"
                  ? "border-[#a3483d33] bg-[#fff7f4]"
                  : isAgent
                    ? "border-[#2f8f7b33] bg-[#f7fffc]"
                    : "border-[var(--line)] bg-white"
              }`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-md bg-[var(--soft)] text-[var(--ink)]">
                    {message.stepType === "error" ? (
                      <AlertCircle size={15} aria-hidden="true" />
                    ) : message.stepType === "summary" ? (
                      <Activity size={15} aria-hidden="true" />
                    ) : (
                      <MessageSquareText size={15} aria-hidden="true" />
                    )}
                  </span>
                  <div>
                    <h3 className="font-medium">{message.speakerName}</h3>
                    <p className="text-xs text-[var(--muted)]">
                      {message.stepType}
                      {message.round ? ` - round ${message.round}` : ""}
                    </p>
                  </div>
                </div>
                <time className="text-xs text-[var(--muted)]">{formatTime(message.createdAt)}</time>
              </div>
              <div className="message-content whitespace-pre-wrap text-sm leading-6">{message.content}</div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ReferenceList({ references }: { references: Doc<"references">[] }) {
  if (references.length === 0) {
    return <EmptyPanel icon="file" label="No references" />;
  }

  return (
    <div className="grid gap-3">
      {references.map((reference) => (
        <article key={reference._id} className="border border-[var(--line)] bg-white p-3">
          <div className="mb-2 flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold leading-5">{reference.title}</h3>
            {reference.url && (
              <a className="icon-button size-8" href={reference.url} target="_blank" rel="noreferrer" title="Open">
                <ExternalLink size={14} aria-hidden="true" />
                <span className="sr-only">Open</span>
              </a>
            )}
          </div>
          <p className="mb-2 text-xs text-[var(--muted)]">
            {[reference.sourceType, reference.sourceId, reference.journal, reference.year]
              .filter(Boolean)
              .join(" - ")}
          </p>
          {reference.abstract && (
            <p className="line-clamp-4 text-sm leading-6 text-[var(--muted)]">{reference.abstract}</p>
          )}
          {reference.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {reference.tags.slice(0, 6).map((tag) => (
                <span key={tag} className="rounded-md bg-[var(--soft)] px-2 py-1 text-xs text-[var(--muted)]">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function GapList({
  gaps,
  onSelect,
}: {
  gaps: Doc<"gapCandidates">[];
  onSelect: (gap: Doc<"gapCandidates">) => void;
}) {
  if (gaps.length === 0) {
    return <EmptyPanel icon="flask" label="No gaps" />;
  }

  return (
    <div className="grid gap-3">
      {gaps.map((gap) => (
        <button
          key={gap._id}
          className="border border-[var(--line)] bg-white p-3 text-left transition hover:border-[var(--accent)]"
          type="button"
          onClick={() => onSelect(gap)}
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold leading-5">{gap.title}</h3>
            <span className="rounded-md bg-[#e7f4e8] px-2 py-1 text-xs font-semibold text-[#25613a]">
              {Math.round(gap.priorityScore ?? 0)}
            </span>
          </div>
          <p className="line-clamp-4 text-sm leading-6 text-[var(--muted)]">{gap.description}</p>
        </button>
      ))}
    </div>
  );
}

function GapDetailPanel({
  gap,
  onClose,
}: {
  gap: Doc<"gapCandidates">;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/20" role="dialog" aria-modal="true">
      <button className="absolute inset-0 cursor-default" type="button" onClick={onClose}>
        <span className="sr-only">Close</span>
      </button>
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-[var(--line)] bg-[var(--surface)] shadow-xl">
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-[var(--line)] bg-[var(--surface)] p-5">
          <div>
            <p className="mb-2 text-sm font-medium text-[var(--accent)]">
              Priority {Math.round(gap.priorityScore ?? 0)}/100
            </p>
            <h2 className="text-xl font-semibold">{gap.title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={17} aria-hidden="true" />
            <span className="sr-only">Close</span>
          </button>
        </div>
        <div className="grid gap-5 p-5">
          <DetailBlock title="Description" content={gap.description} />
          <DetailBlock title="Evidence for" content={gap.evidenceFor} />
          <DetailBlock title="Evidence against" content={gap.evidenceAgainst} />
          <div>
            <h3 className="mb-2 font-semibold">Scores</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Score label="Scarcity" value={gap.evidenceScarcity} />
              <Score label="Impact" value={gap.potentialImpact} />
              <Score label="Feasibility" value={gap.feasibility} />
              <Score label="Novelty" value={gap.novelty} />
            </div>
          </div>
          <div>
            <h3 className="mb-2 font-semibold">Study ideas</h3>
            <ul className="grid gap-2 text-sm leading-6 text-[var(--muted)]">
              {gap.implementationIdeas.map((idea) => (
                <li key={idea} className="border-l-2 border-[var(--accent)] pl-3">
                  {idea}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
}

function DetailBlock({ title, content }: { title: string; content: string }) {
  return (
    <div>
      <h3 className="mb-2 font-semibold">{title}</h3>
      <p className="text-sm leading-6 text-[var(--muted)]">{content}</p>
    </div>
  );
}

function Score({ label, value }: { label: string; value?: number }) {
  return (
    <div className="border border-[var(--line)] bg-white px-3 py-2">
      <div className="font-semibold">{value === undefined ? "-" : Math.round(value)}</div>
      <div className="text-xs text-[var(--muted)]">{label}</div>
    </div>
  );
}

function EmptyPanel({ icon, label }: { icon: "file" | "flask"; label: string }) {
  const Icon = icon === "file" ? FileText : FlaskConical;
  return (
    <div className="grid place-items-center border border-[var(--line)] bg-white px-4 py-10 text-center text-sm text-[var(--muted)]">
      <Icon className="mb-3 text-[var(--accent)]" size={24} aria-hidden="true" />
      {label}
    </div>
  );
}

function WorkspaceLoading() {
  return (
    <main className="min-h-screen bg-[var(--background)] p-5">
      <div className="grid gap-4 xl:grid-cols-[280px_1fr_380px]">
        <div className="hidden h-[calc(100vh-40px)] animate-pulse border border-[var(--line)] bg-[var(--surface)] xl:block" />
        <div className="grid gap-4">
          <div className="h-40 animate-pulse border border-[var(--line)] bg-[var(--surface)]" />
          <div className="h-96 animate-pulse border border-[var(--line)] bg-[var(--surface)]" />
        </div>
        <div className="h-[calc(100vh-40px)] animate-pulse border border-[var(--line)] bg-[var(--surface)]" />
      </div>
    </main>
  );
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
