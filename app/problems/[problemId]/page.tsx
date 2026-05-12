import { ProblemWorkspace } from "@/components/ProblemWorkspace";
import type { Id } from "@/convex/_generated/dataModel";

export default async function ProblemPage({
  params,
}: {
  params: Promise<{ problemId: string }>;
}) {
  const { problemId } = await params;
  return <ProblemWorkspace problemId={problemId as Id<"problems">} />;
}
