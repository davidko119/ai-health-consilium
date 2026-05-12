import { v } from "convex/values";
import { DEFAULT_AGENT_TEMPLATES, SYSTEM_GUARDRAILS } from "../config/consilium";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { messageRole, problemStatus, sourceType, stepType, workflowStage } from "./schema";

const referenceInput = v.object({
  sourceType,
  sourceId: v.optional(v.string()),
  title: v.string(),
  authors: v.array(v.string()),
  journal: v.optional(v.string()),
  year: v.optional(v.number()),
  url: v.optional(v.string()),
  abstract: v.optional(v.string()),
  rawMetadata: v.optional(v.any()),
  tags: v.array(v.string()),
  cluster: v.optional(v.string()),
});

const referenceTagInput = v.object({
  referenceId: v.id("references"),
  tags: v.array(v.string()),
  cluster: v.optional(v.string()),
});

const gapInput = v.object({
  problemId: v.id("problems"),
  agentId: v.optional(v.id("agents")),
  title: v.string(),
  description: v.string(),
  evidenceFor: v.string(),
  evidenceAgainst: v.string(),
  priorityScore: v.optional(v.number()),
  implementationIdeas: v.array(v.string()),
  linkedReferenceIds: v.array(v.id("references")),
});

const gapScoreInput = v.object({
  gapId: v.id("gapCandidates"),
  priorityScore: v.number(),
  evidenceScarcity: v.optional(v.number()),
  potentialImpact: v.optional(v.number()),
  feasibility: v.optional(v.number()),
  novelty: v.optional(v.number()),
  evidenceFor: v.optional(v.string()),
  evidenceAgainst: v.optional(v.string()),
});

export const list = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("problems")
      .withIndex("by_session_updated", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .collect();
  },
});

export const getWorkspace = query({
  args: { problemId: v.id("problems"), sessionId: v.string() },
  handler: async (ctx, args) => {
    const problem = await ctx.db.get(args.problemId);
    if (!problem || problem.sessionId !== args.sessionId) {
      return null;
    }

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_problem", (q) => q.eq("problemId", args.problemId))
      .collect();
    const messages = await ctx.db
      .query("agentMessages")
      .withIndex("by_problem_created", (q) => q.eq("problemId", args.problemId))
      .collect();
    const references = await ctx.db
      .query("references")
      .withIndex("by_problem_created", (q) => q.eq("problemId", args.problemId))
      .collect();
    const gapCandidates = await ctx.db
      .query("gapCandidates")
      .withIndex("by_problem_created", (q) => q.eq("problemId", args.problemId))
      .collect();
    const usageLogs = await ctx.db
      .query("usageLogs")
      .withIndex("by_problem_created", (q) => q.eq("problemId", args.problemId))
      .collect();

    const usageSummary = summarizeUsage(usageLogs);

    return {
      problem,
      agents,
      messages,
      references,
      gapCandidates: gapCandidates.sort(
        (left, right) => (right.priorityScore ?? -1) - (left.priorityScore ?? -1),
      ),
      usageSummary,
    };
  },
});

export const create = mutation({
  args: {
    sessionId: v.string(),
    title: v.string(),
    description: v.string(),
    constraints: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const title = sanitizeText(args.title, 140);
    const description = sanitizeText(args.description, 8000);
    const constraints = args.constraints ? sanitizeText(args.constraints, 3000) : undefined;

    if (title.length < 3) {
      throw new Error("Title must be at least 3 characters.");
    }
    if (description.length < 12) {
      throw new Error("Description must be at least 12 characters.");
    }

    const timestamp = Date.now();
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (!existingUser) {
      await ctx.db.insert("users", {
        sessionId: args.sessionId,
        displayName: "Anonymous researcher",
        createdAt: timestamp,
      });
    }

    const problemId = await ctx.db.insert("problems", {
      sessionId: args.sessionId,
      title,
      description,
      constraints,
      status: "running",
      stage: "clarification",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    for (const agent of DEFAULT_AGENT_TEMPLATES) {
      await ctx.db.insert("agents", {
        problemId,
        name: agent.name,
        roleDescription: agent.roleDescription,
        specializationTags: agent.specializationTags,
        model: agent.model,
        temperature: agent.temperature,
        createdAt: timestamp,
      });
    }

    await ctx.db.insert("agentMessages", {
      problemId,
      speakerName: "System",
      role: "system",
      stepType: "system",
      content: SYSTEM_GUARDRAILS,
      createdAt: timestamp,
    });

    await ctx.db.insert("agentMessages", {
      problemId,
      speakerName: "Researcher",
      role: "user",
      stepType: "clarification",
      content: [description, constraints ? `Constraints: ${constraints}` : ""].filter(Boolean).join("\n\n"),
      createdAt: timestamp + 1,
    });

    await ctx.scheduler.runAfter(0, internal.workflow.runConsilium, { problemId });
    return problemId;
  },
});

export const retry = mutation({
  args: { problemId: v.id("problems"), sessionId: v.string() },
  handler: async (ctx, args) => {
    const problem = await ctx.db.get(args.problemId);
    if (!problem || problem.sessionId !== args.sessionId) {
      throw new Error("Problem not found.");
    }

    await ctx.db.patch(args.problemId, {
      status: "running",
      stage: "clarification",
      error: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.workflow.runConsilium, { problemId: args.problemId });
  },
});

export const loadForWorkflow = internalQuery({
  args: { problemId: v.id("problems") },
  handler: async (ctx, args) => {
    const problem = await ctx.db.get(args.problemId);
    if (!problem) {
      return null;
    }

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_problem", (q) => q.eq("problemId", args.problemId))
      .collect();
    const messages = await ctx.db
      .query("agentMessages")
      .withIndex("by_problem_created", (q) => q.eq("problemId", args.problemId))
      .collect();
    const references = await ctx.db
      .query("references")
      .withIndex("by_problem_created", (q) => q.eq("problemId", args.problemId))
      .collect();
    const gapCandidates = await ctx.db
      .query("gapCandidates")
      .withIndex("by_problem_created", (q) => q.eq("problemId", args.problemId))
      .collect();
    const usageLogs = await ctx.db
      .query("usageLogs")
      .withIndex("by_problem_created", (q) => q.eq("problemId", args.problemId))
      .collect();

    return {
      problem,
      agents,
      messages,
      references,
      gapCandidates,
      usageSummary: summarizeUsage(usageLogs),
    };
  },
});

export const usageTotals = internalQuery({
  args: { problemId: v.id("problems") },
  handler: async (ctx, args) => {
    const usageLogs = await ctx.db
      .query("usageLogs")
      .withIndex("by_problem_created", (q) => q.eq("problemId", args.problemId))
      .collect();
    return summarizeUsage(usageLogs);
  },
});

export const setStatus = internalMutation({
  args: {
    problemId: v.id("problems"),
    status: problemStatus,
    stage: workflowStage,
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.problemId, {
      status: args.status,
      stage: args.stage,
      error: args.error,
      updatedAt: Date.now(),
      completedAt: args.status === "completed" || args.status === "failed" ? Date.now() : undefined,
    });
  },
});

export const addMessage = internalMutation({
  args: {
    problemId: v.id("problems"),
    agentId: v.optional(v.id("agents")),
    speakerName: v.string(),
    role: messageRole,
    content: v.string(),
    stepType,
    round: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentMessages", {
      problemId: args.problemId,
      agentId: args.agentId,
      speakerName: args.speakerName,
      role: args.role,
      content: sanitizeText(args.content, 30000),
      stepType: args.stepType,
      round: args.round,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
  },
});

export const insertReferences = internalMutation({
  args: {
    problemId: v.id("problems"),
    references: v.array(referenceInput),
  },
  handler: async (ctx, args) => {
    const created: Id<"references">[] = [];

    for (const reference of args.references) {
      const existing =
        reference.sourceId &&
        (await ctx.db
          .query("references")
          .withIndex("by_problem_source", (q) =>
            q
              .eq("problemId", args.problemId)
              .eq("sourceType", reference.sourceType)
              .eq("sourceId", reference.sourceId),
          )
          .first());

      if (existing) {
        await ctx.db.patch(existing._id, {
          title: reference.title,
          authors: reference.authors,
          journal: reference.journal,
          year: reference.year,
          url: reference.url,
          abstract: reference.abstract,
          rawMetadata: reference.rawMetadata,
          tags: [...new Set([...existing.tags, ...reference.tags])],
          cluster: reference.cluster ?? existing.cluster,
        });
        created.push(existing._id);
        continue;
      }

      const referenceId = await ctx.db.insert("references", {
        problemId: args.problemId,
        sourceType: reference.sourceType,
        sourceId: reference.sourceId,
        title: sanitizeText(reference.title, 600),
        authors: reference.authors.slice(0, 20).map((author) => sanitizeText(author, 120)),
        journal: reference.journal ? sanitizeText(reference.journal, 220) : undefined,
        year: reference.year,
        url: reference.url,
        abstract: reference.abstract ? sanitizeText(reference.abstract, 5000) : undefined,
        rawMetadata: reference.rawMetadata,
        tags: reference.tags.slice(0, 12).map((tag) => sanitizeText(tag, 60)),
        cluster: reference.cluster ? sanitizeText(reference.cluster, 120) : undefined,
        createdAt: Date.now(),
      });
      created.push(referenceId);
    }

    return created;
  },
});

export const patchReferenceTags = internalMutation({
  args: { updates: v.array(referenceTagInput) },
  handler: async (ctx, args) => {
    for (const update of args.updates) {
      await ctx.db.patch(update.referenceId, {
        tags: update.tags.slice(0, 12).map((tag) => sanitizeText(tag, 60)),
        cluster: update.cluster ? sanitizeText(update.cluster, 120) : undefined,
      });
    }
  },
});

export const insertGapCandidate = internalMutation({
  args: gapInput,
  handler: async (ctx, args) => {
    return await ctx.db.insert("gapCandidates", {
      problemId: args.problemId,
      agentId: args.agentId,
      title: sanitizeText(args.title, 180),
      description: sanitizeText(args.description, 5000),
      evidenceFor: sanitizeText(args.evidenceFor, 3000),
      evidenceAgainst: sanitizeText(args.evidenceAgainst, 3000),
      priorityScore: args.priorityScore === undefined ? undefined : clampScore(args.priorityScore),
      implementationIdeas: args.implementationIdeas
        .slice(0, 8)
        .map((idea) => sanitizeText(idea, 800)),
      linkedReferenceIds: args.linkedReferenceIds,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const updateGapScores = internalMutation({
  args: { scores: v.array(gapScoreInput) },
  handler: async (ctx, args) => {
    for (const score of args.scores) {
      const patch: Partial<Doc<"gapCandidates">> = {
        priorityScore: clampScore(score.priorityScore),
        evidenceScarcity:
          score.evidenceScarcity === undefined ? undefined : clampScore(score.evidenceScarcity),
        potentialImpact:
          score.potentialImpact === undefined ? undefined : clampScore(score.potentialImpact),
        feasibility: score.feasibility === undefined ? undefined : clampScore(score.feasibility),
        novelty: score.novelty === undefined ? undefined : clampScore(score.novelty),
        updatedAt: Date.now(),
      };
      if (score.evidenceFor) {
        patch.evidenceFor = sanitizeText(score.evidenceFor, 3000);
      }
      if (score.evidenceAgainst) {
        patch.evidenceAgainst = sanitizeText(score.evidenceAgainst, 3000);
      }
      await ctx.db.patch(score.gapId, patch);
    }
  },
});

export const logUsage = internalMutation({
  args: {
    problemId: v.id("problems"),
    agentId: v.optional(v.id("agents")),
    model: v.string(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    costEstimate: v.optional(v.number()),
    providerMetadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("usageLogs", {
      problemId: args.problemId,
      agentId: args.agentId,
      model: args.model,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      totalTokens: args.totalTokens,
      costEstimate: args.costEstimate,
      providerMetadata: args.providerMetadata,
      createdAt: Date.now(),
    });
  },
});

function summarizeUsage(logs: Doc<"usageLogs">[]) {
  return {
    calls: logs.length,
    inputTokens: sumDefined(logs.map((log) => log.inputTokens)),
    outputTokens: sumDefined(logs.map((log) => log.outputTokens)),
    totalTokens: sumDefined(logs.map((log) => log.totalTokens)),
    costEstimate: sumDefined(logs.map((log) => log.costEstimate)),
  };
}

function sumDefined(values: (number | undefined)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function sanitizeText(value: string, maxLength: number): string {
  return value.replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, maxLength);
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value > 1) {
    return Math.max(0, Math.min(100, value));
  }
  return Math.max(0, Math.min(1, value)) * 100;
}
