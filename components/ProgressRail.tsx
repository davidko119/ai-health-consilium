import { CheckCircle2, Circle, FileText, LoaderCircle, MessageSquareText, SearchCheck, Sparkles, Trophy } from "lucide-react";
import { WORKFLOW_STAGES } from "@/config/consilium";
import type { WorkflowStage } from "@/types/consilium";

const STAGE_ICONS: Partial<Record<WorkflowStage, typeof Circle>> = {
  clarification: MessageSquareText,
  literature: SearchCheck,
  debate: Sparkles,
  ranking: Trophy,
  report: FileText,
};

export function ProgressRail({
  stage,
  counts,
  onStageClick,
}: {
  stage: WorkflowStage;
  counts?: Partial<Record<WorkflowStage, number>>;
  onStageClick?: (stage: WorkflowStage) => void;
}) {
  const activeIndex = WORKFLOW_STAGES.findIndex((item) => item.key === stage);
  const completed = stage === "completed";
  const failed = stage === "failed";

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
      {WORKFLOW_STAGES.map((item, index) => {
        const isDone = completed || activeIndex > index;
        const isActive = activeIndex === index && !completed && !failed;
        const StateIcon = isDone ? CheckCircle2 : isActive ? LoaderCircle : Circle;
        const StageIcon = STAGE_ICONS[item.key] ?? Circle;
        const count = counts?.[item.key];
        return (
          <button
            key={item.key}
            className={`group relative min-h-16 rounded-lg border px-3 py-2 text-left text-sm transition hover:border-[var(--accent)] ${
              isActive
                ? "border-[var(--accent)] bg-[#dff4ef] text-[#105d4f]"
                : isDone
                  ? "border-[#357a4733] bg-[#eef8ef] text-[#2a623d]"
                  : "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]"
            }`}
            type="button"
            onClick={() => onStageClick?.(item.key)}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <StageIcon size={15} aria-hidden="true" />
                <span className="truncate font-semibold">{item.label}</span>
              </span>
              <StateIcon size={15} className={isActive ? "animate-spin" : ""} aria-hidden="true" />
            </div>
            <div className="text-xs text-[var(--muted)]">
              {isActive ? "In progress" : isDone ? "Complete" : "Pending"}
              {count !== undefined ? ` / ${count.toLocaleString()}` : ""}
            </div>
          </button>
        );
      })}
    </div>
  );
}
