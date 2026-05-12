import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const problemStatus = v.union(
  v.literal("draft"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
);

export const workflowStage = v.union(
  v.literal("draft"),
  v.literal("clarification"),
  v.literal("literature"),
  v.literal("debate"),
  v.literal("ranking"),
  v.literal("report"),
  v.literal("completed"),
  v.literal("failed"),
);

export const messageRole = v.union(
  v.literal("system"),
  v.literal("user"),
  v.literal("assistant"),
  v.literal("agent"),
);

export const stepType = v.union(
  v.literal("clarification"),
  v.literal("proposal"),
  v.literal("critique"),
  v.literal("summary"),
  v.literal("gapCandidate"),
  v.literal("ranking"),
  v.literal("finalReport"),
  v.literal("system"),
  v.literal("error"),
);

export const sourceType = v.union(v.literal("pubmed"), v.literal("web"), v.literal("other"));

export default defineSchema({
  users: defineTable({
    sessionId: v.string(),
    displayName: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_session", ["sessionId"]),

  problems: defineTable({
    sessionId: v.string(),
    title: v.string(),
    description: v.string(),
    constraints: v.optional(v.string()),
    status: problemStatus,
    stage: workflowStage,
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_session_created", ["sessionId", "createdAt"])
    .index("by_session_updated", ["sessionId", "updatedAt"]),

  agents: defineTable({
    problemId: v.id("problems"),
    name: v.string(),
    roleDescription: v.string(),
    specializationTags: v.array(v.string()),
    model: v.string(),
    temperature: v.number(),
    createdAt: v.number(),
  }).index("by_problem", ["problemId"]),

  agentMessages: defineTable({
    problemId: v.id("problems"),
    agentId: v.optional(v.id("agents")),
    speakerName: v.string(),
    role: messageRole,
    content: v.string(),
    stepType,
    round: v.optional(v.number()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_problem_created", ["problemId", "createdAt"])
    .index("by_agent_created", ["agentId", "createdAt"]),

  references: defineTable({
    problemId: v.id("problems"),
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
    createdAt: v.number(),
  })
    .index("by_problem_created", ["problemId", "createdAt"])
    .index("by_problem_source", ["problemId", "sourceType", "sourceId"]),

  gapCandidates: defineTable({
    problemId: v.id("problems"),
    agentId: v.optional(v.id("agents")),
    title: v.string(),
    description: v.string(),
    evidenceFor: v.string(),
    evidenceAgainst: v.string(),
    priorityScore: v.optional(v.number()),
    evidenceScarcity: v.optional(v.number()),
    potentialImpact: v.optional(v.number()),
    feasibility: v.optional(v.number()),
    novelty: v.optional(v.number()),
    implementationIdeas: v.array(v.string()),
    linkedReferenceIds: v.array(v.id("references")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_problem_created", ["problemId", "createdAt"])
    .index("by_problem_priority", ["problemId", "priorityScore"]),

  usageLogs: defineTable({
    problemId: v.id("problems"),
    agentId: v.optional(v.id("agents")),
    model: v.string(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    costEstimate: v.optional(v.number()),
    providerMetadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_problem_created", ["problemId", "createdAt"])
    .index("by_agent_created", ["agentId", "createdAt"]),
});
