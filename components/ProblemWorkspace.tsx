"use client";

import { useMutation, useQuery } from "convex/react";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  BarChart3,
  BookOpenCheck,
  Brain,
  ClipboardCopy,
  Download,
  ExternalLink,
  FileText,
  FlaskConical,
  Lightbulb,
  ListFilter,
  LoaderCircle,
  MessageSquareText,
  Network,
  Plus,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSessionId } from "@/hooks/useSessionId";
import type { WorkflowStage } from "@/types/consilium";
import { MarkdownReport } from "./MarkdownReport";
import { ProgressRail } from "./ProgressRail";
import { StatusBadge } from "./StatusBadge";
import { ThemeToggle } from "./ThemeToggle";

type Problem = Doc<"problems">;
type Ref = Doc<"references">;
type Gap = Doc<"gapCandidates">;
type Msg = Doc<"agentMessages">;
type Agent = Doc<"agents">;
type CenterTab = "summary" | "report" | "debate" | "evidence" | "ideas";
type RightTab = "refs" | "gaps" | "evidence";
type Bucket = "direct" | "indirect" | "preclinical" | "mechanistic";

const centerTabs: { key: CenterTab; label: string; icon: typeof FileText }[] = [
  { key: "summary", label: "Summary", icon: ShieldCheck },
  { key: "report", label: "Report", icon: FileText },
  { key: "debate", label: "Debate Trace", icon: MessageSquareText },
  { key: "evidence", label: "Evidence Map", icon: Network },
  { key: "ideas", label: "Study Ideas", icon: Lightbulb },
];

const agentAvatars: Record<string, string> = {
  "clinical expert": "/avatars/clinical-expert.png",
  "molecular mechanist": "/avatars/molecular-mechanist.png",
  biostatistician: "/avatars/biostatistician.png",
  "meta-researcher": "/avatars/meta-researcher.png",
  "gap seeker": "/avatars/gap-seeker.png",
};

export function ProblemWorkspace({ problemId }: { problemId: Id<"problems"> }) {
  const sessionId = useSessionId();
  const workspace = useQuery(
    api.problems.getWorkspace,
    sessionId ? { problemId, sessionId } : "skip",
  );
  const problems = useQuery(api.problems.list, sessionId ? { sessionId } : "skip");
  const retry = useMutation(api.problems.retry);

  const [centerTab, setCenterTab] = useState<CenterTab>("summary");
  const [rightTab, setRightTab] = useState<RightTab>("refs");
  const [filter, setFilter] = useState("");
  const [selectedGap, setSelectedGap] = useState<Gap | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<Bucket | "all">("all");
  const [retrying, setRetrying] = useState(false);

  const finalReport = useMemo(() => {
    if (!workspace) return undefined;
    return [...workspace.messages].reverse().find((message) => message.stepType === "finalReport");
  }, [workspace]);

  const summary = useMemo(() => {
    if (!workspace) return null;
    return summarizeWorkspace(
      workspace.problem,
      workspace.references,
      workspace.gapCandidates,
      workspace.messages,
      workspace.agents,
    );
  }, [workspace]);

  if (workspace === undefined) return <WorkspaceLoading />;

  if (workspace === null || summary === null) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--background)] p-6">
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-6">
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

  const discussionMessages = workspace.messages.filter((message) => message.stepType !== "finalReport");
  const filteredReferences = workspace.references.filter((reference) => {
    const matchesText = `${reference.title} ${reference.abstract ?? ""} ${reference.tags.join(" ")}`
      .toLowerCase()
      .includes(filter.toLowerCase());
    const matchesBucket = selectedBucket === "all" || classifyReference(reference).bucket === selectedBucket;
    return matchesText && matchesBucket;
  });
  const filteredGaps = workspace.gapCandidates.filter((gap) =>
    `${gap.title} ${gap.description}`.toLowerCase().includes(filter.toLowerCase()),
  );

  async function retryWorkflow() {
    if (!sessionId || retrying) return;
    setRetrying(true);
    try {
      await retry({ problemId, sessionId });
    } finally {
      setRetrying(false);
    }
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="grid h-full min-h-0 overflow-hidden xl:grid-cols-[296px_minmax(0,1fr)_392px]">
        <aside className="hidden min-h-0 overflow-hidden border-r border-[var(--line)] bg-[var(--surface)]/95 xl:block">
          <WorkspaceSidebar problems={problems ?? []} activeProblemId={problemId} />
        </aside>

        <section className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
          <ConsiliumHeader
            problem={workspace.problem}
            report={finalReport}
            retrying={retrying}
            onRetry={retryWorkflow}
          />

          <div className="mx-auto grid max-w-6xl gap-5 px-4 py-5 md:px-6">
            <ExecutiveSummaryStrip summary={summary} />

            <section className="research-panel p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="dashboard-label">Consilium workflow</p>
                  <h2 className="text-base font-semibold">Pipeline status</h2>
                </div>
                {workspace.problem.status === "running" && (
                  <span className="inline-flex items-center gap-2 rounded-md border border-[#2f8f7b33] bg-[#dff4ef] px-2.5 py-1.5 text-xs font-semibold text-[#116252]">
                    <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
                    Active run
                  </span>
                )}
              </div>
              <ProgressRail
                stage={workspace.problem.stage}
                counts={{
                  clarification: workspace.messages.filter((message) => message.stepType === "clarification").length,
                  literature: workspace.references.length,
                  debate: discussionMessages.filter((message) => message.round !== undefined).length,
                  ranking: workspace.gapCandidates.length,
                  report: finalReport ? 1 : 0,
                }}
                onStageClick={scrollToStage}
              />
            </section>

            <MetricsRow
              agents={workspace.agents.length}
              references={workspace.references.length}
              gaps={workspace.gapCandidates.length}
              calls={workspace.usageSummary.calls}
              cost={workspace.usageSummary.costEstimate}
              summary={summary}
            />

            <section id="summary" className="research-panel overflow-hidden">
              <CenterTabs activeTab={centerTab} onChange={setCenterTab} />
              <div className="p-4 md:p-5">
                {centerTab === "summary" && (
                  <SummaryView
                    problem={workspace.problem}
                    summary={summary}
                    references={workspace.references}
                    gaps={workspace.gapCandidates}
                    agents={workspace.agents}
                    onOpenGap={setSelectedGap}
                    onFilterEvidence={(bucket) => {
                      setSelectedBucket(bucket);
                      setRightTab("refs");
                    }}
                  />
                )}
                {centerTab === "report" && (
                  <ReportView report={finalReport} title={workspace.problem.title} running={workspace.problem.status === "running"} />
                )}
                {centerTab === "debate" && <DebateTraceView messages={discussionMessages} agents={workspace.agents} />}
                {centerTab === "evidence" && (
                  <EvidenceMapView
                    references={workspace.references}
                    summary={summary}
                    onFilterEvidence={(bucket) => {
                      setSelectedBucket(bucket);
                      setRightTab("refs");
                    }}
                  />
                )}
                {centerTab === "ideas" && <StudyIdeasView gaps={workspace.gapCandidates} onOpenGap={setSelectedGap} />}
              </div>
            </section>
          </div>
        </section>

        <aside className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden border-t border-[var(--line)] bg-[var(--surface)]/95 xl:border-l xl:border-t-0">
          <RightSidebar
            activeTab={rightTab}
            onChange={setRightTab}
            filter={filter}
            onFilterChange={setFilter}
            references={filteredReferences}
            gaps={filteredGaps}
            summary={summary}
            selectedBucket={selectedBucket}
            onSelectBucket={setSelectedBucket}
            onOpenGap={setSelectedGap}
          />
        </aside>
      </div>

      {selectedGap && <GapDetailPanel gap={selectedGap} onClose={() => setSelectedGap(null)} />}
    </main>
  );
}

function WorkspaceSidebar({ problems, activeProblemId }: { problems: Problem[]; activeProblemId: Id<"problems"> }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-[var(--line)] p-5">
        <Link className="mb-5 flex items-center gap-3" href="/">
          <span className="flex size-10 items-center justify-center rounded-lg bg-[var(--ink)] text-white">
            <FlaskConical size={19} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">Research OS</span>
            <span className="block font-semibold">AI Health Consilium</span>
          </span>
        </Link>
        <Link className="primary-button w-full justify-center" href="/new">
          <Plus size={17} aria-hidden="true" />
          New Consilium
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
        <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Sessions</div>
        {problems.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
            No active sessions.
          </div>
        )}
        {problems.map((problem) => (
          <Link
            key={problem._id}
            href={`/problems/${problem._id}`}
            className={`mb-2 block rounded-lg border p-3 text-sm transition ${
              problem._id === activeProblemId
                ? "border-[var(--accent)] bg-[#e4f4ef] shadow-[inset_3px_0_0_var(--accent)]"
                : "border-transparent bg-transparent hover:border-[var(--line)] hover:bg-[var(--soft)]"
            }`}
          >
            <div className="mb-3 line-clamp-2 font-semibold leading-5">{problem.title}</div>
            <div className="mb-3"><StatusBadge status={problem.status} /></div>
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
              <span className="capitalize">{problem.stage}</span>
              <time>{relativeTime(problem.updatedAt)}</time>
            </div>
          </Link>
        ))}
      </div>
      <div className="border-t border-[var(--line)] p-4"><ThemeToggle /></div>
    </div>
  );
}

function ConsiliumHeader({ problem, report, retrying, onRetry }: { problem: Problem; report?: Msg; retrying: boolean; onRetry: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copyQuestion() {
    await navigator.clipboard.writeText(`${problem.title}\n\n${problem.description}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function exportReport() {
    const blob = new Blob([report?.content ?? `${problem.title}\n\n${problem.description}`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${problem.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-consilium.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--background)]/95 px-4 py-4 backdrop-blur md:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center gap-2 xl:hidden">
            <Link className="icon-button" href="/" title="Back"><ArrowLeft size={16} aria-hidden="true" /><span className="sr-only">Back</span></Link>
            <Link className="secondary-button" href="/new">New</Link>
            <ThemeToggle />
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <StatusBadge status={problem.status} />
            <span className="dashboard-label">Biomedical evidence review</span>
            {problem.status === "running" && (
              <span className="inline-flex h-7 items-center gap-2 text-sm text-[var(--muted)]">
                <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />Running consilium
              </span>
            )}
          </div>
          <h1 className="max-w-4xl text-balance text-2xl font-semibold leading-tight md:text-3xl">{problem.title}</h1>
          <p className="mt-2 line-clamp-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">Original question: {problem.description}</p>
          {problem.error && <div className="mt-3 rounded-lg border border-[#a3483d33] bg-[#f8e7e3] px-4 py-3 text-sm text-[#8f3329]">{problem.error}</div>}
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-button" type="button" onClick={copyQuestion} title="Copy question"><ClipboardCopy size={16} aria-hidden="true" /><span className="sr-only">{copied ? "Copied" : "Copy question"}</span></button>
          <button className="icon-button" type="button" onClick={exportReport} title="Export markdown"><Download size={16} aria-hidden="true" /><span className="sr-only">Export markdown</span></button>
          <button className="icon-button" type="button" title="Share"><Share2 size={16} aria-hidden="true" /><span className="sr-only">Share</span></button>
          {problem.status === "failed" && <button className="secondary-button" type="button" onClick={onRetry}><RefreshCw size={16} className={retrying ? "animate-spin" : ""} aria-hidden="true" />Retry</button>}
        </div>
      </div>
    </header>
  );
}

function ExecutiveSummaryStrip({ summary }: { summary: Summary }) {
  const cards = [
    { label: "Evidence strength", value: summary.evidenceStrength, note: summary.evidenceStrengthNote, icon: ShieldCheck },
    { label: "Uncertainty", value: summary.uncertainty, note: summary.uncertaintyNote, icon: AlertCircle },
    { label: "Top gap type", value: summary.topGapType, note: summary.topGapNote, icon: Target },
    { label: "Population specificity", value: summary.populationSpecificity, note: summary.populationNote, icon: Activity },
  ];

  return (
    <section className="research-panel p-4 md:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="dashboard-label">Executive summary</p>
          <h2 className="text-lg font-semibold">What matters most</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <EvidencePill label="Human" value={summary.counts.direct + summary.counts.indirect} />
          <EvidencePill label="Preclinical" value={summary.counts.preclinical} />
          <EvidencePill label="Mechanistic" value={summary.counts.mechanistic} />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.label} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="dashboard-label">{card.label}</span>
                <Icon size={16} className="text-[var(--accent)]" aria-hidden="true" />
              </div>
              <div className="text-lg font-semibold">{card.value}</div>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{card.note}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EvidencePill({ label, value }: { label: string; value: number }) {
  return <span className="rounded-md border border-[var(--line)] bg-[var(--soft)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">{label}: {value}</span>;
}

function MetricsRow({ agents, references, gaps, calls, cost, summary }: { agents: number; references: number; gaps: number; calls: number; cost: number; summary: Summary }) {
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <Metric label="Agents" value={agents} note={`${summary.modelOpinions} model opinions`} icon={Brain} />
      <Metric label="References" value={references} note={summary.referenceMix} icon={BookOpenCheck} />
      <Metric label="Gaps" value={gaps} note={`${summary.highPriorityGaps} high priority`} icon={Target} />
      <Metric label="LLM calls" value={calls} note={`${summary.debateRounds} debate rounds`} icon={Sparkles} />
      <Metric label="Cost" value={cost > 0 ? `$${cost.toFixed(3)}` : "-"} note={cost > 0 ? "estimated run cost" : "not reported"} icon={BarChart3} />
    </section>
  );
}

function Metric({ label, value, note, icon: Icon }: { label: string; value: number | string; note: string; icon: typeof Activity }) {
  return (
    <article className="research-panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2"><span className="text-sm font-medium text-[var(--muted)]">{label}</span><Icon size={16} className="text-[var(--accent)]" aria-hidden="true" /></div>
      <div className="text-2xl font-semibold">{typeof value === "number" ? value.toLocaleString() : value}</div>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{note}</p>
    </article>
  );
}

function CenterTabs({ activeTab, onChange }: { activeTab: CenterTab; onChange: (tab: CenterTab) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-[var(--line)] bg-[var(--surface)] px-3 py-2 md:px-4">
      {centerTabs.map((item) => {
        const Icon = item.icon;
        return <button key={item.key} className={`workspace-tab ${activeTab === item.key ? "workspace-tab-active" : ""}`} type="button" onClick={() => onChange(item.key)}><Icon size={15} aria-hidden="true" />{item.label}</button>;
      })}
    </div>
  );
}

function SummaryView({ problem, summary, references, gaps, agents, onOpenGap, onFilterEvidence }: { problem: Problem; summary: Summary; references: Ref[]; gaps: Gap[]; agents: Agent[]; onOpenGap: (gap: Gap) => void; onFilterEvidence: (bucket: Bucket) => void }) {
  return (
    <div className="grid gap-5">
      <AgentRoster agents={agents} />

      <section className="grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-lg border border-[var(--line)] bg-[var(--soft)] p-4">
          <p className="dashboard-label">PICO frame</p>
          <h3 className="mt-1 text-lg font-semibold">{problem.title}</h3>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{problem.description}</p>
        </article>
        <article className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
          <p className="dashboard-label">Run interpretation</p>
          <InsightLine label="Signal" value={summary.evidenceStrengthNote} />
          <InsightLine label="Risk" value={summary.uncertaintyNote} />
          <InsightLine label="Next best move" value={summary.nextBestMove} />
        </article>
      </section>

      <section className="grid gap-3 xl:grid-cols-3">
        <Callout title="Key gaps" tone="amber">
          <div className="grid gap-2">
            {gaps.slice(0, 3).map((gap) => (
              <button key={gap._id} className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 text-left transition hover:border-[var(--accent)]" type="button" onClick={() => onOpenGap(gap)}>
                <div className="flex items-start justify-between gap-3"><span className="line-clamp-2 text-sm font-semibold">{gap.title}</span><span className="rounded-md bg-[#e7f4e8] px-2 py-1 text-xs font-semibold text-[#25613a]">{Math.round(gap.priorityScore ?? 0)}</span></div>
              </button>
            ))}
            {gaps.length === 0 && <p>No ranked gaps yet.</p>}
          </div>
        </Callout>
        <Callout title="Limitations" tone="neutral"><p>{summary.limitations}</p></Callout>
        <Callout title="Safety disclaimer" tone="green"><p>This dashboard supports biomedical research ideation and evidence mapping. It is not medical advice.</p></Callout>
      </section>

      <section>
        <div className="mb-3"><p className="dashboard-label">Evidence distribution</p><h3 className="font-semibold">Directness map</h3></div>
        <EvidenceSegments summary={summary} onSelect={onFilterEvidence} />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-semibold">Representative references</h3><span className="text-xs text-[var(--muted)]">{references.length} total</span></div>
        <div className="grid gap-3 md:grid-cols-2">
          {references.slice(0, 4).map((reference) => <ReferenceCard key={reference._id} reference={reference} compact />)}
          {references.length === 0 && <EmptyPanel icon="file" label="No references collected yet" />}
        </div>
      </section>
    </div>
  );
}

function AgentRoster({ agents }: { agents: Agent[] }) {
  if (agents.length === 0) return null;

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="dashboard-label">Consilium agents</p>
          <h3 className="font-semibold">Expert panel</h3>
        </div>
        <span className="text-xs text-[var(--muted)]">{agents.length} active agents</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {agents.map((agent) => (
          <article key={agent._id} className="rounded-lg border border-[var(--line)] bg-[var(--soft)] p-3">
            <div className="mb-3 flex items-center gap-2">
              <AgentAvatar name={agent.name} size="md" />
              <div className="min-w-0">
                <h4 className="truncate text-sm font-semibold">{agent.name}</h4>
                <p className="truncate text-xs text-[var(--muted)]">{agent.model}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {agent.specializationTags.slice(0, 2).map((tag) => (
                <span key={tag} className="rounded-md bg-[var(--surface)] px-2 py-1 text-[0.68rem] text-[var(--muted)]">
                  {tag}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ReportView({ report, title, running }: { report?: Msg; title: string; running: boolean }) {
  if (!report) return running ? <StageSkeleton label="Report is being assembled after ranking completes." /> : <EmptyPanel icon="file" label="No final report available yet" />;
  return <MarkdownReport content={report.content} title={title} />;
}

function DebateTraceView({ messages, agents }: { messages: Msg[]; agents: Agent[] }) {
  const agentNames = new Set(agents.map((agent) => agent.name));
  return (
    <section id="debate" className="grid gap-3">
      {messages.length === 0 && <EmptyPanel icon="chat" label="No debate trace yet" />}
      {messages.map((message) => {
        const isAgent = agentNames.has(message.speakerName);
        return (
          <article key={message._id} className={`rounded-lg border p-4 ${message.stepType === "error" ? "border-[#a3483d33] bg-[#fff7f4]" : isAgent ? "border-[#2f8f7b33] bg-[#f7fffc]" : "border-[var(--line)] bg-[var(--surface)]"}`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {isAgent ? (
                  <AgentAvatar name={message.speakerName} size="sm" />
                ) : (
                  <span className="flex size-9 items-center justify-center rounded-md bg-[var(--soft)] text-[var(--ink)]"><MessageSquareText size={15} aria-hidden="true" /></span>
                )}
                <div><h3 className="font-medium">{message.speakerName}</h3><p className="text-xs text-[var(--muted)]">{message.stepType}{message.round ? ` - round ${message.round}` : ""}</p></div>
              </div>
              <time className="text-xs text-[var(--muted)]">{formatTime(message.createdAt)}</time>
            </div>
            <div className="message-content whitespace-pre-wrap text-sm leading-6">{message.content}</div>
          </article>
        );
      })}
    </section>
  );
}

function getAgentAvatar(name: string) {
  return agentAvatars[name.toLowerCase()] ?? "/avatars/clinical-expert.png";
}

function AgentAvatar({ name, size }: { name: string; size: "sm" | "md" }) {
  const src = getAgentAvatar(name);
  const box = size === "sm" ? "size-9" : "size-11";
  const imageSize = size === "sm" ? 36 : 44;

  return (
    <span className={`${box} relative shrink-0 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-sm`}>
      <Image
        src={src}
        alt={`${name} avatar`}
        width={imageSize}
        height={imageSize}
        className="h-full w-full object-cover"
      />
    </span>
  );
}

function EvidenceMapView({ references, summary, onFilterEvidence }: { references: Ref[]; summary: Summary; onFilterEvidence: (bucket: Bucket) => void }) {
  return (
    <section id="literature" className="grid gap-5">
      <EvidenceSegments summary={summary} onSelect={onFilterEvidence} />
      <div className="grid gap-3 md:grid-cols-2">
        {(["direct", "indirect", "preclinical", "mechanistic"] as Bucket[]).map((bucket) => {
          const refs = references.filter((reference) => classifyReference(reference).bucket === bucket);
          return <article key={bucket} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-semibold">{bucketLabel(bucket)}</h3><span className="text-xs font-semibold text-[var(--muted)]">{refs.length}</span></div><div className="grid gap-2">{refs.slice(0, 3).map((reference) => <ReferenceCard key={reference._id} reference={reference} compact />)}{refs.length === 0 && <p className="text-sm leading-6 text-[var(--muted)]">No references in this category yet.</p>}</div></article>;
        })}
      </div>
    </section>
  );
}

function StudyIdeasView({ gaps, onOpenGap }: { gaps: Gap[]; onOpenGap: (gap: Gap) => void }) {
  return (
    <section id="ranking" className="grid gap-3">
      {gaps.length === 0 && <EmptyPanel icon="flask" label="No ranked study ideas yet" />}
      {gaps.map((gap, index) => <GapCard key={gap._id} gap={gap} index={index + 1} onSelect={onOpenGap} />)}
    </section>
  );
}

function RightSidebar({ activeTab, onChange, filter, onFilterChange, references, gaps, summary, selectedBucket, onSelectBucket, onOpenGap }: { activeTab: RightTab; onChange: (tab: RightTab) => void; filter: string; onFilterChange: (value: string) => void; references: Ref[]; gaps: Gap[]; summary: Summary; selectedBucket: Bucket | "all"; onSelectBucket: (bucket: Bucket | "all") => void; onOpenGap: (gap: Gap) => void }) {
  return (
    <div className="grid min-w-0 gap-4 overflow-x-hidden p-4">
      <div className="flex items-center gap-2"><ListFilter size={17} aria-hidden="true" /><h2 className="text-lg font-semibold">Evidence desk</h2></div>
      <div className="sticky top-0 z-20 grid min-w-0 gap-3 border-b border-[var(--line)] bg-[var(--surface)] pb-3 pt-1">
        <div className="flex rounded-lg border border-[var(--line)] bg-[var(--soft)] p-1">
          {(["refs", "gaps", "evidence"] as RightTab[]).map((tab) => <button key={tab} className={`workspace-tab flex-1 justify-center ${activeTab === tab ? "workspace-tab-active" : ""}`} type="button" onClick={() => onChange(tab)}>{tab}</button>)}
        </div>
        <label className="flex h-10 items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-3 text-sm"><Search size={15} className="text-[var(--muted)]" aria-hidden="true" /><input className="min-w-0 flex-1 bg-transparent outline-none" value={filter} onChange={(event) => onFilterChange(event.target.value)} placeholder="Filter refs or gaps" /></label>
      </div>
      {activeTab === "refs" && <div className="grid min-w-0 gap-3 overflow-x-hidden"><EvidenceFilterChips summary={summary} selectedBucket={selectedBucket} onSelectBucket={onSelectBucket} />{references.length === 0 && <EmptyPanel icon="file" label="No matching references" />}{references.map((reference) => <ReferenceCard key={reference._id} reference={reference} />)}</div>}
      {activeTab === "gaps" && <div className="grid min-w-0 gap-3 overflow-x-hidden">{gaps.length === 0 && <EmptyPanel icon="flask" label="No matching gaps" />}{gaps.map((gap, index) => <GapCard key={gap._id} gap={gap} index={index + 1} onSelect={onOpenGap} />)}</div>}
      {activeTab === "evidence" && <div className="grid min-w-0 gap-4 overflow-x-hidden"><EvidenceFilterChips summary={summary} selectedBucket={selectedBucket} onSelectBucket={onSelectBucket} /><EvidenceSegments summary={summary} onSelect={onSelectBucket} /><Callout title="Map reading" tone="neutral"><p>Evidence is classified from tags, titles, abstracts, and source metadata. Verify study design in the cited papers.</p></Callout></div>}
    </div>
  );
}

function ReferenceCard({ reference, compact = false }: { reference: Ref; compact?: boolean }) {
  const evidence = classifyReference(reference);
  return (
    <article className="group min-w-0 overflow-hidden rounded-lg border border-[var(--line)] bg-white p-3 transition hover:border-[var(--accent)] hover:shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className={`${compact ? "line-clamp-2" : ""} min-w-0 break-words text-sm font-semibold leading-5`}>{reference.title}</h3>
        {reference.url && <a className="icon-button size-8 shrink-0" href={reference.url} target="_blank" rel="noreferrer" title="Open"><ExternalLink size={14} aria-hidden="true" /><span className="sr-only">Open</span></a>}
      </div>
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2 text-xs text-[var(--muted)]"><EvidenceBadge bucket={evidence.bucket} label={evidence.label} /><span className="min-w-0 break-words">{[reference.journal, reference.year].filter(Boolean).join(" / ") || reference.sourceType}</span>{reference.sourceId && <span className="min-w-0 max-w-full break-all">{reference.sourceType.toUpperCase()} {reference.sourceId}</span>}</div>
      {!compact && reference.abstract && <p className="line-clamp-3 text-sm leading-6 text-[var(--muted)]">{reference.abstract}</p>}
      {reference.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{reference.tags.slice(0, compact ? 3 : 6).map((tag) => <span key={tag} className="rounded-md bg-[var(--soft)] px-2 py-1 text-xs text-[var(--muted)]">{tag}</span>)}</div>}
    </article>
  );
}

function GapCard({ gap, index, onSelect }: { gap: Gap; index: number; onSelect: (gap: Gap) => void }) {
  const uncertainty = gap.uncertaintyLevel ?? (gap.evidenceScarcity !== undefined && gap.evidenceScarcity > 70 ? "high" : "moderate");
  return (
    <button className="rounded-lg border border-[var(--line)] bg-white p-3 text-left transition hover:border-[var(--accent)] hover:shadow-sm" type="button" onClick={() => onSelect(gap)}>
      <div className="mb-2 flex items-start justify-between gap-3"><div><p className="dashboard-label">Rank {index}</p><h3 className="text-sm font-semibold leading-5">{gap.title}</h3></div><span className="rounded-md bg-[#e7f4e8] px-2 py-1 text-xs font-semibold text-[#25613a]">{Math.round(gap.priorityScore ?? 0)}</span></div>
      <div className="mb-2 flex flex-wrap gap-1.5"><QuietBadge>{inferGapType(gap)}</QuietBadge><QuietBadge>Uncertainty {uncertainty}</QuietBadge><QuietBadge>{gap.evidenceLevel ?? (gap.evidenceScarcity && gap.evidenceScarcity > 70 ? "Sparse evidence" : "Mixed evidence")}</QuietBadge></div>
      <p className="line-clamp-3 text-sm leading-6 text-[var(--muted)]">{gap.description}</p>
    </button>
  );
}

function EvidenceFilterChips({ summary, selectedBucket, onSelectBucket }: { summary: Summary; selectedBucket: Bucket | "all"; onSelectBucket: (bucket: Bucket | "all") => void }) {
  const chips: { key: Bucket | "all"; label: string; count: number }[] = [
    { key: "all", label: "All", count: summary.referenceCount },
    { key: "direct", label: "Direct", count: summary.counts.direct },
    { key: "indirect", label: "Indirect", count: summary.counts.indirect },
    { key: "preclinical", label: "Preclinical", count: summary.counts.preclinical },
    { key: "mechanistic", label: "Mechanistic", count: summary.counts.mechanistic },
  ];
  return <div className="flex flex-wrap gap-1.5">{chips.map((chip) => <button key={chip.key} className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${selectedBucket === chip.key ? "border-[var(--accent)] bg-[#dff4ef] text-[#105d4f]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--accent)]"}`} type="button" onClick={() => onSelectBucket(chip.key)}>{chip.label} {chip.count}</button>)}</div>;
}

function EvidenceSegments({ summary, onSelect }: { summary: Summary; onSelect: (bucket: Bucket) => void }) {
  const buckets: { key: Bucket; label: string; count: number }[] = [
    { key: "direct", label: "Direct human evidence", count: summary.counts.direct },
    { key: "indirect", label: "Indirect human evidence", count: summary.counts.indirect },
    { key: "preclinical", label: "Preclinical only", count: summary.counts.preclinical },
    { key: "mechanistic", label: "Speculative / mechanistic", count: summary.counts.mechanistic },
  ];
  const total = Math.max(1, summary.referenceCount);
  return (
    <div className="grid gap-3">
      <div className="flex h-3 overflow-hidden rounded-full border border-[var(--line)] bg-[var(--soft)]">{buckets.map((bucket) => <button key={bucket.key} className={`h-full ${barColor(bucket.key)}`} style={{ width: `${(bucket.count / total) * 100}%` }} type="button" onClick={() => onSelect(bucket.key)} title={bucket.label} />)}</div>
      <div className="grid gap-2 md:grid-cols-2">{buckets.map((bucket) => <button key={bucket.key} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-left transition hover:border-[var(--accent)]" type="button" onClick={() => onSelect(bucket.key)}><div className="mb-2 flex items-center justify-between gap-3"><span className="text-sm font-semibold">{bucket.label}</span><span className="text-sm font-semibold">{bucket.count}</span></div><div className="text-xs text-[var(--muted)]">{Math.round((bucket.count / total) * 100)}% of refs</div></button>)}</div>
    </div>
  );
}

function GapDetailPanel({ gap, onClose }: { gap: Gap; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/20" role="dialog" aria-modal="true">
      <button className="absolute inset-0 cursor-default" type="button" onClick={onClose}><span className="sr-only">Close</span></button>
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-[var(--line)] bg-[var(--surface)] shadow-xl">
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-[var(--line)] bg-[var(--surface)] p-5"><div><p className="mb-2 text-sm font-medium text-[var(--accent)]">Priority {Math.round(gap.priorityScore ?? 0)}/100</p><h2 className="text-xl font-semibold">{gap.title}</h2></div><button className="icon-button" type="button" onClick={onClose} title="Close"><X size={17} aria-hidden="true" /><span className="sr-only">Close</span></button></div>
        <div className="grid gap-5 p-5">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Score label="Gap type" value={gap.primaryGapType} />
            <Score label="Evidence" value={gap.evidenceLevel} />
            <Score label="Uncertainty" value={gap.uncertaintyLevel} />
            <Score label="Distinctiveness" value={gap.distinctiveness} />
          </div>
          <DetailBlock title="Rationale" content={gap.description} />
          {gap.whyTrueGap && <DetailBlock title="Why this is a true gap" content={gap.whyTrueGap} />}
          {gap.whatKnown && <DetailBlock title="What is already known" content={gap.whatKnown} />}
          {gap.whatMissing && <DetailBlock title="What is missing" content={gap.whatMissing} />}
          <DetailBlock title="Evidence for" content={gap.evidenceFor} />
          <DetailBlock title="Evidence against" content={gap.evidenceAgainst} />
          <div>
            <h3 className="mb-2 font-semibold">Scores</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Score label="Scarcity" value={gap.evidenceScarcity} />
              <Score label="Actionability" value={gap.actionability} />
              <Score label="Clinical" value={gap.clinicalRelevance} />
              <Score label="Mechanistic" value={gap.mechanisticImportance} />
              <Score label="Feasibility" value={gap.feasibility} />
              <Score label="Novelty" value={gap.novelty} />
            </div>
          </div>
          {gap.diversityRationale && <DetailBlock title="Ranking rationale" content={gap.diversityRationale} />}
          {gap.studyProposal && <StudyProposal proposal={gap.studyProposal} />}
          <div><h3 className="mb-2 font-semibold">Study ideas</h3><ul className="grid gap-2 text-sm leading-6 text-[var(--muted)]">{gap.implementationIdeas.map((idea) => <li key={idea} className="rounded-md border-l-2 border-[var(--accent)] bg-[var(--soft)] px-3 py-2">{idea}</li>)}</ul></div>
        </div>
      </aside>
    </div>
  );
}

function StudyProposal({ proposal }: { proposal: NonNullable<Gap["studyProposal"]> }) {
  return (
    <div>
      <h3 className="mb-2 font-semibold">Structured study proposal</h3>
      <div className="grid gap-3">
        <DetailBlock title="Objective" content={proposal.objective} />
        <DetailBlock title="Population" content={proposal.population} />
        <DetailBlock title="Intervention / exposure" content={proposal.interventionOrExposure} />
        <DetailBlock title="Comparator" content={proposal.comparator} />
        <DetailBlock title="Primary outcomes" content={proposal.primaryOutcomes.join("; ") || "Not specified"} />
        <DetailBlock title="Secondary outcomes" content={proposal.secondaryOutcomes.join("; ") || "Not specified"} />
        <DetailBlock title="Biomarkers" content={proposal.biomarkers.join("; ") || "None specified"} />
        <DetailBlock title="Study design" content={proposal.studyDesign} />
        <DetailBlock title="Feasibility notes" content={proposal.feasibilityNotes} />
      </div>
    </div>
  );
}

function DetailBlock({ title, content }: { title: string; content: string }) {
  return <div><h3 className="mb-2 font-semibold">{title}</h3><p className="text-sm leading-6 text-[var(--muted)]">{content}</p></div>;
}

function Score({ label, value }: { label: string; value?: number | string }) {
  return <div className="rounded-lg border border-[var(--line)] bg-white px-3 py-2"><div className="break-words font-semibold">{value === undefined ? "-" : typeof value === "number" ? Math.round(value) : value}</div><div className="text-xs text-[var(--muted)]">{label}</div></div>;
}

function Callout({ title, tone, children }: { title: string; tone: "green" | "amber" | "neutral"; children: React.ReactNode }) {
  const toneClass = tone === "green" ? "border-[#2f8f7b33] bg-[#f4fbf8]" : tone === "amber" ? "border-[#b36b1f33] bg-[#fff9ed]" : "border-[var(--line)] bg-[var(--soft)]";
  return <article className={`rounded-lg border p-4 text-sm leading-6 ${toneClass}`}><h3 className="mb-2 font-semibold">{title}</h3><div className="text-[var(--muted)]">{children}</div></article>;
}

function InsightLine({ label, value }: { label: string; value: string }) {
  return <div className="mt-3"><div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</div><div className="mt-1 text-sm leading-6">{value}</div></div>;
}

function QuietBadge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md border border-[var(--line)] bg-[var(--soft)] px-2 py-1 text-xs text-[var(--muted)]">{children}</span>;
}

function EvidenceBadge({ bucket, label }: { bucket: Bucket; label: string }) {
  return <span className={`rounded-md px-2 py-1 text-xs font-semibold ${badgeClass(bucket)}`}>{label}</span>;
}

function EmptyPanel({ icon, label }: { icon: "file" | "flask" | "chat"; label: string }) {
  const Icon = icon === "file" ? FileText : icon === "chat" ? MessageSquareText : FlaskConical;
  return <div className="grid place-items-center rounded-lg border border-[var(--line)] bg-white px-4 py-10 text-center text-sm text-[var(--muted)]"><Icon className="mb-3 text-[var(--accent)]" size={24} aria-hidden="true" />{label}</div>;
}

function StageSkeleton({ label }: { label: string }) {
  return <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5"><div className="mb-4 flex items-center gap-2 text-sm text-[var(--muted)]"><LoaderCircle size={16} className="animate-spin text-[var(--accent)]" aria-hidden="true" />{label}</div><div className="grid gap-2"><div className="h-4 w-3/4 animate-pulse rounded bg-[var(--soft)]" /><div className="h-4 w-full animate-pulse rounded bg-[var(--soft)]" /><div className="h-4 w-2/3 animate-pulse rounded bg-[var(--soft)]" /></div></div>;
}

function WorkspaceLoading() {
  return <main className="min-h-screen bg-[var(--background)] p-5"><div className="grid gap-4 xl:grid-cols-[296px_1fr_392px]"><div className="hidden h-[calc(100vh-40px)] animate-pulse rounded-lg border border-[var(--line)] bg-[var(--surface)] xl:block" /><div className="grid gap-4"><div className="h-48 animate-pulse rounded-lg border border-[var(--line)] bg-[var(--surface)]" /><div className="h-32 animate-pulse rounded-lg border border-[var(--line)] bg-[var(--surface)]" /><div className="h-96 animate-pulse rounded-lg border border-[var(--line)] bg-[var(--surface)]" /></div><div className="h-[calc(100vh-40px)] animate-pulse rounded-lg border border-[var(--line)] bg-[var(--surface)]" /></div></main>;
}

interface Summary {
  referenceCount: number;
  counts: Record<Bucket, number>;
  evidenceStrength: string;
  evidenceStrengthNote: string;
  uncertainty: string;
  uncertaintyNote: string;
  topGapType: string;
  topGapNote: string;
  populationSpecificity: string;
  populationNote: string;
  referenceMix: string;
  debateRounds: number;
  modelOpinions: number;
  highPriorityGaps: number;
  limitations: string;
  nextBestMove: string;
}

function summarizeWorkspace(problem: Problem, references: Ref[], gaps: Gap[], messages: Msg[], agents: Agent[]): Summary {
  const counts: Record<Bucket, number> = { direct: 0, indirect: 0, preclinical: 0, mechanistic: 0 };
  references.forEach((reference) => counts[classifyReference(reference).bucket] += 1);
  const debateRounds = Math.max(0, ...messages.map((message) => message.round ?? 0));
  const highPriorityGaps = gaps.filter((gap) => (gap.priorityScore ?? 0) >= 70).length;
  const topGap = gaps[0];
  const human = counts.direct + counts.indirect;
  const populationSpecificity = /\b(adult|pediatric|elderly|women|men|patients with|cohort|pregnant|diabetes|cancer|stage|age)\b/i.test(problem.description) ? "Specific" : "Broad";

  return {
    referenceCount: references.length,
    counts,
    evidenceStrength: counts.direct >= 3 ? "Moderate human signal" : human > 0 ? "Mixed translational signal" : "Early signal",
    evidenceStrengthNote: counts.direct > 0 ? `${counts.direct} direct human references anchor the current read.` : "No direct human bucket dominates yet; interpretation should stay cautious.",
    uncertainty: gaps.length === 0 ? "Not assessed" : highPriorityGaps >= 3 ? "High" : highPriorityGaps > 0 ? "Moderate" : "Lower",
    uncertaintyNote: gaps.length > 0 ? `${gaps.length} gaps surfaced, ${highPriorityGaps} above the high-priority threshold.` : "Gap ranking has not produced actionable uncertainty signals yet.",
    topGapType: topGap ? inferGapType(topGap) : "Not ranked",
    topGapNote: topGap ? `Highest ranked gap: ${topGap.title}` : "Ranking is pending or no gap candidate was retained.",
    populationSpecificity,
    populationNote: populationSpecificity === "Specific" ? "The question contains population or cohort signals." : "Population details are broad; subgroup applicability may need refinement.",
    referenceMix: `${human} human, ${counts.preclinical} preclinical`,
    debateRounds,
    modelOpinions: messages.filter((message) => message.role === "agent" || agents.some((agent) => agent.name === message.speakerName)).length,
    highPriorityGaps,
    limitations: references.length === 0 ? "The evidence base has not been collected yet." : "Automated classification is heuristic; verify study design, population, intervention, and endpoints in the cited papers.",
    nextBestMove: topGap?.implementationIdeas[0] ?? "Wait for ranking output, then prioritize the highest-scoring gap with feasible validation.",
  };
}

function classifyReference(reference: Ref): { bucket: Bucket; label: string } {
  if (reference.evidenceProfile) {
    if (reference.evidenceProfile.evidenceLevel === "direct_human_cp_adolescents") return { bucket: "direct", label: "direct CP adolescent" };
    if (reference.evidenceProfile.evidenceLevel === "human_cp_broader_age" || reference.evidenceProfile.evidenceLevel === "indirect_human_other_neurological") return { bucket: "indirect", label: "indirect human" };
    if (reference.evidenceProfile.evidenceLevel === "preclinical_animal") return { bucket: "preclinical", label: "preclinical" };
    return { bucket: "mechanistic", label: "speculative" };
  }
  const text = `${reference.title} ${reference.abstract ?? ""} ${reference.tags.join(" ")} ${reference.cluster ?? ""}`.toLowerCase();
  if (/\b(meta-analysis|systematic review|guideline|review)\b/.test(text)) return { bucket: "indirect", label: text.includes("guideline") ? "guideline" : "review" };
  if (/\b(randomized|clinical trial|cohort|case-control|patient|patients|human|humans)\b/.test(text)) return { bucket: "direct", label: "human" };
  if (/\b(mouse|mice|rat|rats|animal|murine|in vivo|in vitro|cell line|preclinical)\b/.test(text)) return { bucket: "preclinical", label: "preclinical" };
  if (reference.sourceType === "pubmed") return { bucket: "indirect", label: "biomedical" };
  return { bucket: "mechanistic", label: "mechanistic" };
}

function inferGapType(gap: Gap) {
  if (gap.primaryGapType) return gap.primaryGapType;
  const text = `${gap.title} ${gap.description}`.toLowerCase();
  if (/\b(population|subgroup|cohort|patient)\b/.test(text)) return "Population gap";
  if (/\b(mechanism|pathway|biomarker|causal)\b/.test(text)) return "Mechanistic gap";
  if (/\b(trial|study design|endpoint|power|randomized)\b/.test(text)) return "Study design gap";
  if (/\b(safety|adverse|toxicity)\b/.test(text)) return "Safety gap";
  return "Evidence gap";
}

function bucketLabel(bucket: Bucket) {
  return { direct: "Direct human evidence", indirect: "Indirect human evidence", preclinical: "Preclinical evidence", mechanistic: "Mechanistic signal" }[bucket];
}

function badgeClass(bucket: Bucket) {
  return { direct: "bg-[#dff4ef] text-[#105d4f]", indirect: "bg-[#e8f0ee] text-[#405957]", preclinical: "bg-[#fff1d8] text-[#8a5318]", mechanistic: "bg-[#edf2ec] text-[var(--muted)]" }[bucket];
}

function barColor(bucket: Bucket) {
  return { direct: "bg-[#21846f]", indirect: "bg-[#75a99b]", preclinical: "bg-[#d49b45]", mechanistic: "bg-[#a9b6b1]" }[bucket];
}

function scrollToStage(stage: WorkflowStage) {
  const targets: Partial<Record<WorkflowStage, string>> = { clarification: "summary", literature: "literature", debate: "debate", ranking: "ranking", report: "summary" };
  const target = targets[stage];
  if (target) document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

function relativeTime(timestamp: number) {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
