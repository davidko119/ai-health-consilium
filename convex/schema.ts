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

export const picoFieldStatus = v.union(
  v.literal("explicit"),
  v.literal("inferred"),
  v.literal("unclear"),
);

export const gapType = v.union(
  v.literal("mechanism"),
  v.literal("intervention"),
  v.literal("comparator"),
  v.literal("population_subgroup"),
  v.literal("biomarker_measurement"),
  v.literal("study_design_methodology"),
  v.literal("translational"),
  v.literal("safety_feasibility"),
  v.literal("long_term_outcome"),
);

export const evidenceLevel = v.union(
  v.literal("direct_human_cp_adolescents"),
  v.literal("human_cp_broader_age"),
  v.literal("indirect_human_other_neurological"),
  v.literal("preclinical_animal"),
  v.literal("mechanistic_speculation"),
);

export const uncertaintyLevel = v.union(
  v.literal("low"),
  v.literal("moderate"),
  v.literal("high"),
  v.literal("very_high"),
);

export const speciesType = v.union(
  v.literal("human"),
  v.literal("animal"),
  v.literal("mixed"),
  v.literal("unclear"),
);

export const ageRelevance = v.union(
  v.literal("adolescent_specific"),
  v.literal("pediatric"),
  v.literal("adult"),
  v.literal("mixed_or_unclear"),
);

const picoField = v.object({
  value: v.string(),
  status: picoFieldStatus,
  rationale: v.optional(v.string()),
});

export const picoExtraction = v.object({
  population: picoField,
  intervention: picoField,
  comparator: picoField,
  outcomes: picoField,
  context: picoField,
  mechanisticHypothesis: picoField,
  ambiguousTerms: v.array(v.string()),
});

export const evidenceMap = v.object({
  directlySupported: v.array(v.string()),
  indirectlySupported: v.array(v.string()),
  preclinicalOnly: v.array(v.string()),
  speculative: v.array(v.string()),
  caveats: v.array(v.string()),
});

export const referenceEvidenceProfile = v.object({
  populationTags: v.array(v.string()),
  interventionTypes: v.array(v.string()),
  evidenceType: v.string(),
  outcomeTypes: v.array(v.string()),
  species: speciesType,
  ageRelevance,
  evidenceLevel,
});

export const structuredStudyProposal = v.object({
  objective: v.string(),
  population: v.string(),
  interventionOrExposure: v.string(),
  comparator: v.string(),
  primaryOutcomes: v.array(v.string()),
  secondaryOutcomes: v.array(v.string()),
  biomarkers: v.array(v.string()),
  studyDesign: v.string(),
  feasibilityNotes: v.string(),
  whyThisDesignAddressesGap: v.string(),
});

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
    picoExtraction: v.optional(picoExtraction),
    evidenceMap: v.optional(evidenceMap),
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
    evidenceProfile: v.optional(referenceEvidenceProfile),
    createdAt: v.number(),
  })
    .index("by_problem_created", ["problemId", "createdAt"])
    .index("by_problem_source", ["problemId", "sourceType", "sourceId"]),

  gapCandidates: defineTable({
    problemId: v.id("problems"),
    agentId: v.optional(v.id("agents")),
    title: v.string(),
    description: v.string(),
    primaryGapType: v.optional(gapType),
    secondaryGapType: v.optional(gapType),
    whyTrueGap: v.optional(v.string()),
    whatKnown: v.optional(v.string()),
    whatMissing: v.optional(v.string()),
    evidenceLevel: v.optional(evidenceLevel),
    uncertaintyLevel: v.optional(uncertaintyLevel),
    evidenceFor: v.string(),
    evidenceAgainst: v.string(),
    priorityScore: v.optional(v.number()),
    evidenceScarcity: v.optional(v.number()),
    potentialImpact: v.optional(v.number()),
    actionability: v.optional(v.number()),
    clinicalRelevance: v.optional(v.number()),
    mechanisticImportance: v.optional(v.number()),
    feasibility: v.optional(v.number()),
    novelty: v.optional(v.number()),
    distinctiveness: v.optional(v.number()),
    diversityRationale: v.optional(v.string()),
    studyProposal: v.optional(structuredStudyProposal),
    mergedFromTitles: v.optional(v.array(v.string())),
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
