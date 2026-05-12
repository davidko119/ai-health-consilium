import { AlertCircle, CheckCircle2, Clock3, LoaderCircle } from "lucide-react";
import type { ProblemStatus } from "@/types/consilium";

export function StatusBadge({ status }: { status: ProblemStatus }) {
  const styles: Record<ProblemStatus, string> = {
    draft: "border-[var(--line)] bg-[var(--soft)] text-[var(--muted)]",
    running: "border-[#2f8f7b33] bg-[#dff4ef] text-[#116252]",
    completed: "border-[#357a4733] bg-[#e7f4e8] text-[#25613a]",
    failed: "border-[#a3483d33] bg-[#f8e7e3] text-[#8f3329]",
  };
  const Icon =
    status === "running"
      ? LoaderCircle
      : status === "completed"
        ? CheckCircle2
        : status === "failed"
          ? AlertCircle
          : Clock3;

  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium ${styles[status]}`}
    >
      <Icon size={13} className={status === "running" ? "animate-spin" : ""} aria-hidden="true" />
      {status}
    </span>
  );
}
