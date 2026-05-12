import { CheckCircle2, Circle, LoaderCircle } from "lucide-react";
import { WORKFLOW_STAGES } from "@/config/consilium";
import type { WorkflowStage } from "@/types/consilium";

export function ProgressRail({ stage }: { stage: WorkflowStage }) {
  const activeIndex = WORKFLOW_STAGES.findIndex((item) => item.key === stage);
  const completed = stage === "completed";
  const failed = stage === "failed";

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
      {WORKFLOW_STAGES.map((item, index) => {
        const isDone = completed || activeIndex > index;
        const isActive = activeIndex === index && !completed && !failed;
        const Icon = isDone ? CheckCircle2 : isActive ? LoaderCircle : Circle;
        return (
          <div
            key={item.key}
            className={`flex h-10 items-center gap-2 border px-3 text-sm ${
              isActive
                ? "border-[var(--accent)] bg-[#dff4ef] text-[#105d4f]"
                : isDone
                  ? "border-[#357a4733] bg-[#eef8ef] text-[#2a623d]"
                  : "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]"
            }`}
          >
            <Icon size={15} className={isActive ? "animate-spin" : ""} aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}
