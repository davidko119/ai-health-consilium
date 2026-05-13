import { v } from "convex/values";
import { z } from "zod";
import {
  DOMAIN_SPECIAL_RULES,
  MODEL_CONFIG,
  REPORT_STRUCTURE,
  ROLE_PROMPTS,
  SYSTEM_GUARDRAILS,
  WORKFLOW_DEFAULTS,
} from "../config/consilium";
import { scrapeWithApify } from "../lib/apify";
import { searchExa } from "../lib/exa";
import { callLLM, extractJsonObject } from "../lib/openrouter";
import { fetchPubmedSummaries, searchPubmed } from "../lib/pubmed";
import {
  type ChatMessage,
  type EvidenceMap,
  type GapProposal,
  type PicoExtraction,
  type ReferenceEvidenceProfile,
  type SearchPlan,
} from "../types/consilium";
import {
  EVIDENCE_LEVEL_LABELS,
  GAP_TYPE_LABELS,
  diversifyGapRankings,
  normalizeEvidenceLevel,
  normalizeGapType,
  normalizeUncertainty,
} from "../lib/researchQuality";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";

interface UsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costEstimate: number;
}

interface WorkflowState {
  problem: Doc<"problems">;
  agents: Doc<"agents">[];
  messages: Doc<"agentMessages">[];
  references: Doc<"references">[];
  gapCandidates: Doc<"gapCandidates">[];
  usageSummary: UsageSummary;
}

interface LlmCallParams {
  problemId: Id<"problems">;
  agentId?: Id<"agents">;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

const SearchPlanSchema = z.object({
  pubmedQueries: z.array(z.string()).default([]),
  webQueries: z.array(z.string()).default([]),
  rationale: z.string().default(""),
});

const PicoFieldSchema = z.object({
  value: z.string().default("Unclear / not specified"),
  status: z.enum(["explicit", "inferred", "unclear"]).default("unclear"),
  rationale: z.string().optional(),
});

const PicoExtractionSchema = z.object({
  population: PicoFieldSchema,
  intervention: PicoFieldSchema,
  comparator: PicoFieldSchema,
  outcomes: PicoFieldSchema,
  context: PicoFieldSchema,
  mechanisticHypothesis: PicoFieldSchema,
  ambiguousTerms: z.array(z.string()).default([]),
});

const EvidenceMapSchema = z.object({
  directlySupported: z.array(z.string()).default([]),
  indirectlySupported: z.array(z.string()).default([]),
  preclinicalOnly: z.array(z.string()).default([]),
  speculative: z.array(z.string()).default([]),
  caveats: z.array(z.string()).default([]),
});

const ReferenceTagsSchema = z.object({
  references: z
    .array(
      z.object({
        sourceId: z.string(),
        tags: z.array(z.string()).default([]),
        cluster: z.string().default("Mapped evidence"),
        evidenceProfile: z
          .object({
            populationTags: z.array(z.string()).default([]),
            interventionTypes: z.array(z.string()).default([]),
            evidenceType: z.string().default("unclear"),
            outcomeTypes: z.array(z.string()).default([]),
            species: z.enum(["human", "animal", "mixed", "unclear"]).default("unclear"),
            ageRelevance: z
              .enum(["adolescent_specific", "pediatric", "adult", "mixed_or_unclear"])
              .default("mixed_or_unclear"),
            evidenceLevel: z.string().default("mechanistic_speculation"),
          })
          .optional(),
      }),
    )
    .default([]),
});

const StructuredStudyProposalSchema = z.object({
  objective: z.string().default(""),
  population: z.string().default(""),
  interventionOrExposure: z.string().default(""),
  comparator: z.string().default(""),
  primaryOutcomes: z.array(z.string()).default([]),
  secondaryOutcomes: z.array(z.string()).default([]),
  biomarkers: z.array(z.string()).default([]),
  studyDesign: z.string().default(""),
  feasibilityNotes: z.string().default(""),
  whyThisDesignAddressesGap: z.string().default(""),
});

const EnhancedGapCandidateSchema = z.object({
  title: z.string(),
  description: z.string(),
  primaryGapType: z.string().default("study_design_methodology"),
  secondaryGapType: z.string().optional(),
  whyTrueGap: z.string().default(""),
  whatKnown: z.string().default(""),
  whatMissing: z.string().default(""),
  evidenceLevel: z.string().default("mechanistic_speculation"),
  uncertaintyLevel: z.string().default("high"),
  evidenceFor: z.string().default(""),
  evidenceAgainst: z.string().default(""),
  priorityScore: z.number().optional(),
  novelty: z.number().optional(),
  evidenceScarcity: z.number().optional(),
  actionability: z.number().optional(),
  clinicalRelevance: z.number().optional(),
  mechanisticImportance: z.number().optional(),
  feasibility: z.number().optional(),
  distinctiveness: z.number().optional(),
  implementationIdeas: z.array(z.string()).default([]),
  studyProposal: StructuredStudyProposalSchema.optional(),
  linkedReferenceIds: z.array(z.string()).default([]),
});

const DebateSchema = z.object({
  contribution: z.string().default(""),
  gapCandidates: z.array(EnhancedGapCandidateSchema).default([]),
});

const GapCritiqueSchema = z.object({
  critique: z.string().default(""),
  gapUpdates: z
    .array(
      z.object({
        title: z.string(),
        critique: z.string().default(""),
        duplicateOf: z.string().optional(),
        primaryGapType: z.string().optional(),
        secondaryGapType: z.string().optional(),
        evidenceLevel: z.string().optional(),
        uncertaintyLevel: z.string().optional(),
        evidenceFor: z.string().optional(),
        evidenceAgainst: z.string().optional(),
        priorityPenalty: z.number().optional(),
      }),
    )
    .default([]),
});

const GapScoresSchema = z.object({
  scores: z
    .array(
      z.object({
        title: z.string(),
        priorityScore: z.number(),
        primaryGapType: z.string().optional(),
        secondaryGapType: z.string().optional(),
        evidenceLevel: z.string().optional(),
        uncertaintyLevel: z.string().optional(),
        evidenceScarcity: z.number().optional(),
        actionability: z.number().optional(),
        clinicalRelevance: z.number().optional(),
        mechanisticImportance: z.number().optional(),
        feasibility: z.number().optional(),
        novelty: z.number().optional(),
        distinctiveness: z.number().optional(),
        justification: z.string().default(""),
      }),
    )
    .default([]),
});

class BudgetLimitError extends Error {
  constructor() {
    super("The per-problem LLM soft limit was reached.");
  }
}

export const runConsilium = internalAction({
  args: { problemId: v.id("problems") },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(internal.problems.setStatus, {
        problemId: args.problemId,
        status: "running",
        stage: "clarification",
      });

      let state = await loadState(ctx, args.problemId);
      const openRouterKey = process.env.OPENROUTER_API_KEY ?? "";

      await runQueryUnderstanding(ctx, state, openRouterKey);
      state = await loadState(ctx, args.problemId);
      await runClarificationRound(ctx, state, openRouterKey);

      await ctx.runMutation(internal.problems.setStatus, {
        problemId: args.problemId,
        status: "running",
        stage: "literature",
      });

      state = await loadState(ctx, args.problemId);
      const searchPlan = await createSearchPlan(ctx, state, openRouterKey);
      await collectLiterature(ctx, state.problem, searchPlan);

      state = await loadState(ctx, args.problemId);
      await tagReferences(ctx, state, openRouterKey);
      state = await loadState(ctx, args.problemId);
      await runEvidenceSynthesis(ctx, state, openRouterKey);

      await ctx.runMutation(internal.problems.setStatus, {
        problemId: args.problemId,
        status: "running",
        stage: "debate",
      });

      state = await loadState(ctx, args.problemId);
      await runDebate(ctx, state, openRouterKey);

      await ctx.runMutation(internal.problems.setStatus, {
        problemId: args.problemId,
        status: "running",
        stage: "ranking",
      });

      state = await loadState(ctx, args.problemId);
      await rankGaps(ctx, state, openRouterKey);

      await ctx.runMutation(internal.problems.setStatus, {
        problemId: args.problemId,
        status: "running",
        stage: "report",
      });

      state = await loadState(ctx, args.problemId);
      await writeFinalReport(ctx, state, openRouterKey, false);

      await ctx.runMutation(internal.problems.setStatus, {
        problemId: args.problemId,
        status: "completed",
        stage: "completed",
      });
    } catch (error) {
      if (error instanceof BudgetLimitError) {
        const state = await loadState(ctx, args.problemId);
        await ctx.runMutation(internal.problems.addMessage, {
          problemId: args.problemId,
          speakerName: "System",
          role: "system",
          stepType: "summary",
          content:
            "The LLM soft limit for this problem was reached. The final report is based on the evidence and debate captured so far.",
        });
        await writeFinalReport(ctx, state, "", true);
        await ctx.runMutation(internal.problems.setStatus, {
          problemId: args.problemId,
          status: "completed",
          stage: "completed",
          error: "Soft budget limit reached; report is partial.",
        });
        return;
      }

      const message = error instanceof Error ? error.message : "Unknown workflow error.";
      await ctx.runMutation(internal.problems.addMessage, {
        problemId: args.problemId,
        speakerName: "System",
        role: "system",
        stepType: "error",
        content: `The workflow failed: ${message}`,
      });
      await ctx.runMutation(internal.problems.setStatus, {
        problemId: args.problemId,
        status: "failed",
        stage: "failed",
        error: message,
      });
    }
  },
});

async function runQueryUnderstanding(
  ctx: ActionCtx,
  state: WorkflowState,
  openRouterKey: string,
) {
  const fallback = fallbackPico(state.problem);
  const raw = await callOrFallback(
    ctx,
    {
      problemId: state.problem._id,
      model: MODEL_CONFIG.evaluatorModel,
      temperature: MODEL_CONFIG.highPrecisionTemperature,
      maxTokens: 900,
      messages: [
        { role: "system", content: `${SYSTEM_GUARDRAILS}\n\n${ROLE_PROMPTS.analyst}` },
        {
          role: "user",
          content: [
            "Stage 1: Query understanding. Extract PICO from the user's biomedical research question.",
            "Return JSON only with this schema:",
            "{\"population\":{\"value\":string,\"status\":\"explicit|inferred|unclear\",\"rationale\":string},\"intervention\":...,\"comparator\":...,\"outcomes\":...,\"context\":...,\"mechanisticHypothesis\":...,\"ambiguousTerms\":string[]}",
            "For each PICO field, mark whether it is explicit, inferred, or unclear.",
            "Identify ambiguous terms such as broad intervention phrases.",
            "",
            DOMAIN_SPECIAL_RULES,
            "",
            problemBrief(state.problem),
          ].join("\n"),
        },
      ],
    },
    JSON.stringify(fallback),
    openRouterKey,
  );

  const pico = parseStructured(PicoExtractionSchema, raw, fallback);
  await ctx.runMutation(internal.problems.updateProblemUnderstanding, {
    problemId: state.problem._id,
    picoExtraction: pico,
  });

  await ctx.runMutation(internal.problems.addMessage, {
    problemId: state.problem._id,
    speakerName: "Query Analyst",
    role: "assistant",
    stepType: "clarification",
    content: renderPicoMessage(pico),
  });
}

async function runClarificationRound(
  ctx: ActionCtx,
  state: WorkflowState,
  openRouterKey: string,
) {
  for (const agent of state.agents) {
    const fallback = [
      `Clarifying questions from ${agent.name}:`,
      "- Which population, intervention, comparator, and outcome boundaries matter most?",
      "- Are preclinical, pediatric, adult, or rehabilitation studies in scope?",
      "- What minimum evidence level should count as actionable?",
      "",
      "Initial plan: map PubMed evidence, separate clinical from mechanistic evidence, then test candidate gaps against feasibility and novelty.",
    ].join("\n");

    const content = await callOrFallback(
      ctx,
      {
        problemId: state.problem._id,
        agentId: agent._id,
        model: agent.model,
        temperature: agent.temperature,
        maxTokens: 850,
        messages: [
          { role: "system", content: `${SYSTEM_GUARDRAILS}\n\n${agent.roleDescription}` },
          {
            role: "user",
            content: [
              "Research problem:",
              problemBrief(state.problem),
              "",
              "Extracted PICO:",
              formatPico(state.problem.picoExtraction),
              "",
              DOMAIN_SPECIAL_RULES,
              "",
              "Generate concise clarifying questions, a refined research formulation, and your plan of attack. Explicitly flag unclear population, intervention, comparator, outcome, and evidence-level boundaries.",
            ].join("\n"),
          },
        ],
      },
      fallback,
      openRouterKey,
    );

    await ctx.runMutation(internal.problems.addMessage, {
      problemId: state.problem._id,
      agentId: agent._id,
      speakerName: agent.name,
      role: "agent",
      stepType: "clarification",
      content,
    });
  }
}

async function createSearchPlan(
  ctx: ActionCtx,
  state: WorkflowState,
  openRouterKey: string,
): Promise<SearchPlan> {
  const fallback = fallbackSearchPlan(state.problem);
  const raw = await callOrFallback(
    ctx,
    {
      problemId: state.problem._id,
      model: MODEL_CONFIG.evaluatorModel,
      temperature: MODEL_CONFIG.highPrecisionTemperature,
      maxTokens: 900,
      messages: [
        { role: "system", content: SYSTEM_GUARDRAILS },
        {
          role: "user",
          content: [
            "Create a biomedical evidence search plan as JSON only.",
            "Schema: {\"pubmedQueries\": string[], \"webQueries\": string[], \"rationale\": string}",
            `Limit PubMed queries to ${WORKFLOW_DEFAULTS.maxPubMedQueries}.`,
            `Limit web queries to ${WORKFLOW_DEFAULTS.maxWebQueries}.`,
            "Queries must cover distinct intervention interpretations and evidence levels, not only broad mechanism terms.",
            "",
            "PICO:",
            formatPico(state.problem.picoExtraction),
            "",
            DOMAIN_SPECIAL_RULES,
            "",
            problemBrief(state.problem),
          ].join("\n"),
        },
      ],
    },
    JSON.stringify(fallback),
    openRouterKey,
  );

  const parsed = parseStructured(SearchPlanSchema, raw, fallback);
  const plan = {
    pubmedQueries: compactStrings(parsed.pubmedQueries).slice(0, WORKFLOW_DEFAULTS.maxPubMedQueries),
    webQueries: compactStrings(parsed.webQueries).slice(0, WORKFLOW_DEFAULTS.maxWebQueries),
    rationale: parsed.rationale || fallback.rationale,
  };

  await ctx.runMutation(internal.problems.addMessage, {
    problemId: state.problem._id,
    speakerName: "Search Planner",
    role: "assistant",
    stepType: "summary",
    content: [
      "Search plan",
      "",
      `PubMed queries:\n${plan.pubmedQueries.map((query) => `- ${query}`).join("\n")}`,
      plan.webQueries.length > 0
        ? `Web queries:\n${plan.webQueries.map((query) => `- ${query}`).join("\n")}`
        : "Web queries: none configured",
      "",
      plan.rationale,
    ].join("\n"),
  });

  return plan;
}

async function collectLiterature(ctx: ActionCtx, problem: Doc<"problems">, plan: SearchPlan) {
  const pubmedReferences = await collectPubMedReferences(ctx, problem, plan.pubmedQueries);
  const webReferences = await collectWebReferences(ctx, problem, plan.webQueries);
  const total = pubmedReferences + webReferences;

  await ctx.runMutation(internal.problems.addMessage, {
    problemId: problem._id,
    speakerName: "Evidence Harvester",
    role: "assistant",
    stepType: "summary",
    content:
      total > 0
        ? `Collected ${pubmedReferences} PubMed references and ${webReferences} web references.`
        : "No external references were collected. The debate will proceed with a clear caveat that evidence retrieval was empty or unavailable.",
  });
}

async function collectPubMedReferences(
  ctx: ActionCtx,
  problem: Doc<"problems">,
  queries: string[],
): Promise<number> {
  const apiKey = process.env.NCBI_API_KEY;
  const email = process.env.NCBI_EMAIL;
  const pmidSet = new Set<string>();

  for (const queryText of queries) {
    try {
      const ids = await searchPubmed(queryText, WORKFLOW_DEFAULTS.maxReferencesPerQuery, {
        apiKey,
        email,
      });
      ids.forEach((id) => pmidSet.add(id));
      await wait(350);
    } catch (error) {
      await addExternalError(ctx, problem._id, "PubMed search", error);
    }
  }

  const pmids = [...pmidSet].slice(
    0,
    WORKFLOW_DEFAULTS.maxPubMedQueries * WORKFLOW_DEFAULTS.maxReferencesPerQuery,
  );
  if (pmids.length === 0) {
    return 0;
  }

  try {
    const summaries = await fetchPubmedSummaries(pmids, { apiKey, email });
    await ctx.runMutation(internal.problems.insertReferences, {
      problemId: problem._id,
      references: summaries.map((reference) => ({
        sourceType: "pubmed" as const,
        sourceId: reference.pmid,
        title: reference.title,
        authors: reference.authors,
        journal: reference.journal,
        year: reference.year,
        url: reference.url,
        abstract: reference.abstract,
        rawMetadata: reference.rawMetadata,
        tags: [] as string[],
        cluster: undefined,
      })),
    });
    return summaries.length;
  } catch (error) {
    await addExternalError(ctx, problem._id, "PubMed summary fetch", error);
    return 0;
  }
}

async function collectWebReferences(
  ctx: ActionCtx,
  problem: Doc<"problems">,
  queries: string[],
): Promise<number> {
  const exaResult = await collectExaReferences(ctx, problem, queries);
  const token = process.env.APIFY_TOKEN;
  const actorId = process.env.APIFY_ACTOR_ID;
  const inputTemplateJson = process.env.APIFY_ACTOR_INPUT_JSON;

  if (!token || !actorId || queries.length === 0) {
    return exaResult.count;
  }

  let count = exaResult.count;
  for (const queryText of queries) {
    try {
      const startUrls = actorId.includes("website-content-crawler")
        ? exaResult.urls.slice(0, 3)
        : undefined;
      if (actorId.includes("website-content-crawler") && (!startUrls || startUrls.length === 0)) {
        continue;
      }
      const outputs = await scrapeWithApify({
        token,
        actorId,
        inputTemplateJson: actorId.includes("website-content-crawler")
          ? undefined
          : inputTemplateJson,
        query: queryText,
        startUrls,
        maxItems: 4,
      });
      await ctx.runMutation(internal.problems.insertReferences, {
        problemId: problem._id,
        references: outputs.map((reference) => ({
          sourceType: "web" as const,
          sourceId: reference.sourceId ?? reference.url,
          title: reference.title,
          authors: [] as string[],
          journal: undefined,
          year: undefined,
          url: reference.url,
          abstract: reference.snippet ?? reference.fullText?.slice(0, 1600),
          rawMetadata: reference.rawMetadata,
          tags: [] as string[],
          cluster: "Web evidence",
        })),
      });
      count += outputs.length;
    } catch (error) {
      await addExternalError(ctx, problem._id, "Apify scrape", error);
    }
  }
  return count;
}

async function collectExaReferences(
  ctx: ActionCtx,
  problem: Doc<"problems">,
  queries: string[],
): Promise<{ count: number; urls: string[] }> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey || queries.length === 0) {
    return { count: 0, urls: [] };
  }

  let count = 0;
  const urls: string[] = [];
  for (const queryText of queries) {
    try {
      const outputs = await searchExa({
        apiKey,
        query: queryText,
        maxResults: 4,
      });
      await ctx.runMutation(internal.problems.insertReferences, {
        problemId: problem._id,
        references: outputs.map((reference) => ({
          sourceType: "web" as const,
          sourceId: reference.sourceId ?? reference.url,
          title: reference.title,
          authors: [] as string[],
          journal: "Exa",
          year: undefined,
          url: reference.url,
          abstract: reference.snippet ?? reference.fullText?.slice(0, 1600),
          rawMetadata: reference.rawMetadata,
          tags: [] as string[],
          cluster: "Semantic web evidence",
        })),
      });
      count += outputs.length;
      urls.push(...outputs.map((output) => output.url).filter((url): url is string => Boolean(url)));
    } catch (error) {
      await addExternalError(ctx, problem._id, "Exa search", error);
    }
  }
  return { count, urls: [...new Set(urls)] };
}

async function tagReferences(ctx: ActionCtx, state: WorkflowState, openRouterKey: string) {
  if (state.references.length === 0) {
    return;
  }

  const fallbackUpdates = state.references.map((reference) => ({
    referenceId: reference._id,
    tags: inferTags(`${state.problem.title} ${reference.title} ${reference.abstract ?? ""}`),
    cluster: reference.sourceType === "pubmed" ? "Biomedical literature" : "Web evidence",
    evidenceProfile: fallbackEvidenceProfile(reference),
  }));

  const raw = await callOrFallback(
    ctx,
    {
      problemId: state.problem._id,
      model: MODEL_CONFIG.evaluatorModel,
      temperature: MODEL_CONFIG.highPrecisionTemperature,
      maxTokens: 1300,
      messages: [
        { role: "system", content: SYSTEM_GUARDRAILS },
        {
          role: "user",
          content: [
            "Tag each reference and place it into a compact evidence cluster. Return JSON only.",
            "Schema: {\"references\": [{\"sourceId\": string, \"tags\": string[], \"cluster\": string, \"evidenceProfile\": {\"populationTags\": string[], \"interventionTypes\": string[], \"evidenceType\": string, \"outcomeTypes\": string[], \"species\": \"human|animal|mixed|unclear\", \"ageRelevance\": \"adolescent_specific|pediatric|adult|mixed_or_unclear\", \"evidenceLevel\": \"direct_human_cp_adolescents|human_cp_broader_age|indirect_human_other_neurological|preclinical_animal|mechanistic_speculation\"}}]}",
            "Classify species, adolescent relevance, intervention type, and evidence directness. Do not mark evidence as direct unless the title/abstract clearly supports it.",
            "",
            "PICO:",
            formatPico(state.problem.picoExtraction),
            "",
            DOMAIN_SPECIAL_RULES,
            "",
            formatReferenceList(state.references, WORKFLOW_DEFAULTS.maxReferencesInPrompt),
          ].join("\n"),
        },
      ],
    },
    JSON.stringify({
      references: fallbackUpdates.map((update) => ({
        sourceId: update.referenceId,
        tags: update.tags,
        cluster: update.cluster,
        evidenceProfile: update.evidenceProfile,
      })),
    }),
    openRouterKey,
  );

  const parsed = parseStructured(ReferenceTagsSchema, raw, { references: [] });
  const byKey = referenceKeyMap(state.references);
  const updates = parsed.references
    .map((item) => {
      const reference = byKey.get(item.sourceId);
      if (!reference) {
        return null;
      }
      return {
        referenceId: reference._id,
        tags: compactStrings(item.tags).slice(0, 8),
        cluster: item.cluster,
        evidenceProfile: normalizeReferenceEvidenceProfile(item.evidenceProfile, reference),
      };
    })
    .filter(
      (
        item,
      ): item is {
        referenceId: Id<"references">;
        tags: string[];
        cluster: string;
        evidenceProfile: ReferenceEvidenceProfile;
      } => Boolean(item),
    );

  await ctx.runMutation(internal.problems.patchReferenceTags, {
    updates: updates.length > 0 ? updates : fallbackUpdates,
  });
}

async function runEvidenceSynthesis(
  ctx: ActionCtx,
  state: WorkflowState,
  openRouterKey: string,
) {
  const analystFallback = deterministicEvidenceSummary(state);
  const analyst = await callOrFallback(
    ctx,
    {
      problemId: state.problem._id,
      model: MODEL_CONFIG.evaluatorModel,
      temperature: MODEL_CONFIG.highPrecisionTemperature,
      maxTokens: 1400,
      messages: [
        { role: "system", content: `${SYSTEM_GUARDRAILS}\n\n${ROLE_PROMPTS.analyst}` },
        {
          role: "user",
          content: [
            "Stage 3: Evidence synthesis. Summarize the retrieved evidence without proposing final gaps yet.",
            "Separate direct human evidence, indirect human evidence, preclinical evidence, and speculation.",
            "Do not overstate causality when evidence is associative.",
            "",
            "PICO:",
            formatPico(state.problem.picoExtraction),
            "",
            "Tagged references:",
            formatReferenceList(state.references, WORKFLOW_DEFAULTS.maxReferencesInPrompt),
          ].join("\n"),
        },
      ],
    },
    analystFallback,
    openRouterKey,
  );

  await ctx.runMutation(internal.problems.addMessage, {
    problemId: state.problem._id,
    speakerName: "Analyst",
    role: "assistant",
    stepType: "summary",
    content: analyst,
  });

  const mapFallback = fallbackEvidenceMap(state);
  const graderRaw = await callOrFallback(
    ctx,
    {
      problemId: state.problem._id,
      model: MODEL_CONFIG.evaluatorModel,
      temperature: MODEL_CONFIG.highPrecisionTemperature,
      maxTokens: 1200,
      messages: [
        { role: "system", content: `${SYSTEM_GUARDRAILS}\n\n${ROLE_PROMPTS.evidenceGrader}` },
        {
          role: "user",
          content: [
            "Stage 3: Evidence grading. Return JSON only.",
            "Schema: {\"directlySupported\": string[], \"indirectlySupported\": string[], \"preclinicalOnly\": string[], \"speculative\": string[], \"caveats\": string[]}",
            "Every entry must be concise and say why its evidence level applies.",
            "",
            "PICO:",
            formatPico(state.problem.picoExtraction),
            "",
            "Analyst synthesis:",
            analyst,
            "",
            "References:",
            formatReferenceList(state.references, WORKFLOW_DEFAULTS.maxReferencesInPrompt),
          ].join("\n"),
        },
      ],
    },
    JSON.stringify(mapFallback),
    openRouterKey,
  );

  const evidenceMap = parseStructured(EvidenceMapSchema, graderRaw, mapFallback);
  await ctx.runMutation(internal.problems.updateProblemUnderstanding, {
    problemId: state.problem._id,
    evidenceMap,
  });
  await ctx.runMutation(internal.problems.addMessage, {
    problemId: state.problem._id,
    speakerName: "Evidence Grader",
    role: "assistant",
    stepType: "summary",
    content: renderEvidenceMap(evidenceMap),
  });
}

async function runDebate(ctx: ActionCtx, initialState: WorkflowState, openRouterKey: string) {
  const gapAgent = findAgent(initialState, "Gap Seeker") ?? initialState.agents[0];
  const skepticAgent = findAgent(initialState, "Biostatistician") ?? initialState.agents[0];
  const graderAgent = findAgent(initialState, "Meta-Researcher") ?? initialState.agents[0];
  const fallback = fallbackDebate(gapAgent, initialState.problem, 1);
  const raw = await callOrFallback(
    ctx,
    {
      problemId: initialState.problem._id,
      agentId: gapAgent?._id,
      model: gapAgent?.model ?? MODEL_CONFIG.evaluatorModel,
      temperature: gapAgent?.temperature ?? MODEL_CONFIG.temperature,
      maxTokens: 2800,
      messages: [
        { role: "system", content: `${SYSTEM_GUARDRAILS}\n\n${ROLE_PROMPTS.gapFinder}` },
        {
          role: "user",
          content: [
            "Stage 4: Gap proposal. Propose 8-12 diverse candidate gaps as JSON only.",
            "Each candidate must have exactly one primary gap type and at most one secondary gap type.",
            "Allowed gap types:",
            Object.entries(GAP_TYPE_LABELS)
              .map(([key, label]) => `- ${key}: ${label}`)
              .join("\n"),
            "",
            "Return this JSON schema:",
            "{\"contribution\": string, \"gapCandidates\": [{\"title\": string, \"description\": string, \"primaryGapType\": string, \"secondaryGapType\": string, \"whyTrueGap\": string, \"whatKnown\": string, \"whatMissing\": string, \"evidenceLevel\": string, \"uncertaintyLevel\": \"low|moderate|high|very_high\", \"evidenceFor\": string, \"evidenceAgainst\": string, \"priorityScore\": number, \"novelty\": number, \"evidenceScarcity\": number, \"actionability\": number, \"clinicalRelevance\": number, \"mechanisticImportance\": number, \"feasibility\": number, \"distinctiveness\": number, \"implementationIdeas\": string[], \"studyProposal\": {\"objective\": string, \"population\": string, \"interventionOrExposure\": string, \"comparator\": string, \"primaryOutcomes\": string[], \"secondaryOutcomes\": string[], \"biomarkers\": string[], \"studyDesign\": string, \"feasibilityNotes\": string, \"whyThisDesignAddressesGap\": string}, \"linkedReferenceIds\": string[]}]}",
            "",
            "Study proposals must be specific, not generic. Avoid suggestions like only 'animal models' or 'longitudinal studies' unless the design is operationalized.",
            "",
            DOMAIN_SPECIAL_RULES,
            "",
            "PICO:",
            formatPico(initialState.problem.picoExtraction),
            "",
            "Evidence map:",
            renderEvidenceMap(initialState.problem.evidenceMap ?? fallbackEvidenceMap(initialState)),
            "",
            "Relevant references:",
            formatReferenceList(initialState.references, WORKFLOW_DEFAULTS.maxReferencesInPrompt),
            "",
            "Recent discussion:",
            formatDiscussion(
              initialState.messages.map((message) => ({
                speakerName: message.speakerName,
                content: message.content,
              })),
              WORKFLOW_DEFAULTS.recentMessageWindow,
            ),
          ].join("\n"),
        },
      ],
    },
    JSON.stringify(fallback),
    openRouterKey,
  );

  const parsed = parseStructured(DebateSchema, raw, fallback);
  const messageContent = renderDebateMessage(parsed.contribution, parsed.gapCandidates);

  await ctx.runMutation(internal.problems.addMessage, {
    problemId: initialState.problem._id,
    agentId: gapAgent?._id,
    speakerName: "Gap Finder",
    role: "agent",
    stepType: "gapCandidate",
    round: 1,
    content: messageContent,
  });

  for (const gap of parsed.gapCandidates.slice(0, 12)) {
    const gapText = `${gap.title} ${gap.description}`;
    await ctx.runMutation(internal.problems.insertGapCandidate, {
      problemId: initialState.problem._id,
      agentId: gapAgent?._id,
      title: gap.title,
      description: gap.description,
      primaryGapType: normalizeGapType(gap.primaryGapType, gapText),
      secondaryGapType: gap.secondaryGapType ? normalizeGapType(gap.secondaryGapType, gapText) : undefined,
      whyTrueGap: gap.whyTrueGap,
      whatKnown: gap.whatKnown,
      whatMissing: gap.whatMissing,
      evidenceLevel: normalizeEvidenceLevel(gap.evidenceLevel, gapText),
      uncertaintyLevel: normalizeUncertainty(gap.uncertaintyLevel, gap.priorityScore),
      evidenceFor: gap.evidenceFor,
      evidenceAgainst: gap.evidenceAgainst,
      priorityScore: gap.priorityScore,
      evidenceScarcity: gap.evidenceScarcity,
      actionability: gap.actionability,
      clinicalRelevance: gap.clinicalRelevance,
      mechanisticImportance: gap.mechanisticImportance,
      feasibility: gap.feasibility,
      novelty: gap.novelty,
      distinctiveness: gap.distinctiveness,
      studyProposal: gap.studyProposal,
      implementationIdeas: gap.implementationIdeas,
      linkedReferenceIds: resolveLinkedReferences(gap.linkedReferenceIds, initialState.references),
    });
  }

  const stateWithGaps = await loadState(ctx, initialState.problem._id);
  await runAdversarialCritique(ctx, stateWithGaps, skepticAgent, openRouterKey);
  const stateAfterSkeptic = await loadState(ctx, initialState.problem._id);
  await runGapEvidenceGrading(ctx, stateAfterSkeptic, graderAgent, openRouterKey);
}

async function runAdversarialCritique(
  ctx: ActionCtx,
  state: WorkflowState,
  agent: Doc<"agents"> | undefined,
  openRouterKey: string,
) {
  const fallback = fallbackCritique(state, "Skeptic detected possible overlap and vague intervention framing.");
  const raw = await callOrFallback(
    ctx,
    {
      problemId: state.problem._id,
      agentId: agent?._id,
      model: agent?.model ?? MODEL_CONFIG.evaluatorModel,
      temperature: MODEL_CONFIG.highPrecisionTemperature,
      maxTokens: 1800,
      messages: [
        { role: "system", content: `${SYSTEM_GUARDRAILS}\n\n${ROLE_PROMPTS.skeptic}` },
        {
          role: "user",
          content: [
            "Stage 5: Adversarial critique. Return JSON only.",
            "Schema: {\"critique\": string, \"gapUpdates\": [{\"title\": string, \"critique\": string, \"duplicateOf\": string, \"primaryGapType\": string, \"secondaryGapType\": string, \"evidenceLevel\": string, \"uncertaintyLevel\": string, \"evidenceFor\": string, \"evidenceAgainst\": string, \"priorityPenalty\": number}]}",
            "Explicitly challenge redundancy, animal-to-human extrapolation, vague interventions, missing comparators, weak outcomes, and duplicated mechanism framing.",
            "Do not introduce brand-new standalone gaps here; critique the proposed candidates.",
            "",
            "PICO:",
            formatPico(state.problem.picoExtraction),
            "",
            "Gap candidates:",
            formatGaps(state.gapCandidates),
          ].join("\n"),
        },
      ],
    },
    JSON.stringify(fallback),
    openRouterKey,
  );

  const parsed = parseStructured(GapCritiqueSchema, raw, fallback);
  await applyGapCritique(ctx, state, parsed, "Skeptic / Critic");
}

async function runGapEvidenceGrading(
  ctx: ActionCtx,
  state: WorkflowState,
  agent: Doc<"agents"> | undefined,
  openRouterKey: string,
) {
  const fallback = fallbackCritique(
    state,
    "Evidence grading fallback: directness and uncertainty were inferred from available titles and abstracts.",
  );
  const raw = await callOrFallback(
    ctx,
    {
      problemId: state.problem._id,
      agentId: agent?._id,
      model: agent?.model ?? MODEL_CONFIG.evaluatorModel,
      temperature: MODEL_CONFIG.highPrecisionTemperature,
      maxTokens: 1800,
      messages: [
        { role: "system", content: `${SYSTEM_GUARDRAILS}\n\n${ROLE_PROMPTS.evidenceGrader}` },
        {
          role: "user",
          content: [
            "Stage 5: Evidence grading of candidate gaps. Return JSON only.",
            "For each gap, label directness and uncertainty. Say whether the gap is truly unanswered or just poorly operationalized.",
            "Schema: {\"critique\": string, \"gapUpdates\": [{\"title\": string, \"critique\": string, \"evidenceLevel\": string, \"uncertaintyLevel\": string, \"evidenceFor\": string, \"evidenceAgainst\": string, \"priorityPenalty\": number}]}",
            "",
            "Evidence levels:",
            Object.entries(EVIDENCE_LEVEL_LABELS)
              .map(([key, label]) => `- ${key}: ${label}`)
              .join("\n"),
            "",
            "PICO:",
            formatPico(state.problem.picoExtraction),
            "",
            "Evidence map:",
            renderEvidenceMap(state.problem.evidenceMap ?? fallbackEvidenceMap(state)),
            "",
            "Gap candidates:",
            formatGaps(state.gapCandidates),
          ].join("\n"),
        },
      ],
    },
    JSON.stringify(fallback),
    openRouterKey,
  );

  const parsed = parseStructured(GapCritiqueSchema, raw, fallback);
  await applyGapCritique(ctx, state, parsed, "Evidence Grader");
}

async function applyGapCritique(
  ctx: ActionCtx,
  state: WorkflowState,
  critique: z.infer<typeof GapCritiqueSchema>,
  speakerName: string,
) {
  const byTitle = new Map(state.gapCandidates.map((gap) => [normalizeKey(gap.title), gap]));
  const updates = critique.gapUpdates
    .map((update) => {
      const gap = byTitle.get(normalizeKey(update.title));
      if (!gap) {
        return null;
      }
      const penalty = update.priorityPenalty ?? 0;
      const priorityScore =
        gap.priorityScore === undefined ? Math.max(35, 65 - penalty) : Math.max(10, gap.priorityScore - penalty);
      const evidenceAgainst = [
        gap.evidenceAgainst,
        update.critique ? `${speakerName}: ${update.critique}` : "",
        update.duplicateOf ? `Potential duplicate of: ${update.duplicateOf}` : "",
        update.evidenceAgainst ? `Evidence grader note: ${update.evidenceAgainst}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const gapText = `${gap.title} ${gap.description}`;
      return {
        gapId: gap._id,
        priorityScore,
        primaryGapType: update.primaryGapType ? normalizeGapType(update.primaryGapType, gapText) : gap.primaryGapType,
        secondaryGapType: update.secondaryGapType
          ? normalizeGapType(update.secondaryGapType, gapText)
          : gap.secondaryGapType,
        evidenceLevel: update.evidenceLevel ? normalizeEvidenceLevel(update.evidenceLevel, gapText) : gap.evidenceLevel,
        uncertaintyLevel: update.uncertaintyLevel
          ? normalizeUncertainty(update.uncertaintyLevel, gap.priorityScore)
          : gap.uncertaintyLevel,
        evidenceFor: update.evidenceFor ?? gap.evidenceFor,
        evidenceAgainst,
        mergedFromTitles: update.duplicateOf ? [update.duplicateOf] : gap.mergedFromTitles,
      };
    })
    .filter((update) => update !== null);

  if (updates.length > 0) {
    await ctx.runMutation(internal.problems.updateGapScores, { scores: updates });
  }
  await ctx.runMutation(internal.problems.addMessage, {
    problemId: state.problem._id,
    speakerName,
    role: "assistant",
    stepType: "critique",
    round: 1,
    content: critique.critique,
  });
}

async function rankGaps(ctx: ActionCtx, state: WorkflowState, openRouterKey: string) {
  let gaps = state.gapCandidates;
  if (gaps.length === 0) {
    await ctx.runMutation(internal.problems.insertGapCandidate, {
      problemId: state.problem._id,
      agentId: undefined,
      title: "Insufficient mapped evidence for the submitted question",
      description:
        "The available retrieval and debate did not surface a confident, highly specific gap. This itself suggests the question needs narrower population, intervention, comparator, or outcome boundaries before ranking gaps.",
      primaryGapType: "study_design_methodology",
      secondaryGapType: "comparator",
      whyTrueGap: "The submitted question cannot be ranked rigorously without explicit PICO boundaries and directness criteria.",
      whatKnown: "The workflow has a problem statement and any references retrieved so far.",
      whatMissing: "A precise population, intervention/exposure, comparator, and outcome definition for testable gap ranking.",
      evidenceLevel: "mechanistic_speculation",
      uncertaintyLevel: "very_high",
      evidenceFor: "No structured gap candidates were proposed during the debate.",
      evidenceAgainst: "The absence may reflect limited retrieval, missing API keys, or an overly broad question rather than a true lack of gaps.",
      priorityScore: 50,
      evidenceScarcity: 70,
      actionability: 55,
      clinicalRelevance: 50,
      mechanisticImportance: 35,
      feasibility: 80,
      novelty: 35,
      distinctiveness: 90,
      studyProposal: fallbackStudyProposal(state.problem, "Run a focused scoping review before hypothesis ranking."),
      implementationIdeas: [
        "Run a focused scoping review with explicit PICO boundaries.",
        "Repeat the search with narrower synonyms and inclusion criteria.",
      ],
      linkedReferenceIds: [],
    });
    const refreshed = await loadState(ctx, state.problem._id);
    gaps = refreshed.gapCandidates;
  }

  const fallbackScores = gaps.map((gap, index) => ({
    title: gap.title,
    priorityScore: Math.max(45, 86 - index * 7),
    primaryGapType: normalizeGapType(gap.primaryGapType, `${gap.title} ${gap.description}`),
    secondaryGapType: gap.secondaryGapType,
    evidenceLevel: normalizeEvidenceLevel(gap.evidenceLevel, `${gap.title} ${gap.description}`),
    uncertaintyLevel: normalizeUncertainty(gap.uncertaintyLevel, gap.priorityScore),
    evidenceScarcity: 70,
    actionability: 65,
    clinicalRelevance: 65,
    mechanisticImportance: 60,
    feasibility: 60,
    novelty: 62,
    distinctiveness: 76,
    justification: "Heuristic score based on available discussion and reference coverage.",
  }));

  const raw = await callOrFallback(
    ctx,
    {
      problemId: state.problem._id,
      model: MODEL_CONFIG.evaluatorModel,
      temperature: MODEL_CONFIG.highPrecisionTemperature,
      maxTokens: 1300,
      messages: [
        { role: "system", content: SYSTEM_GUARDRAILS },
        {
          role: "user",
          content: [
            "Stage 6: Gap reranking before deterministic diversification. Return JSON only.",
            "Score each gap from 0-100 for novelty, evidenceScarcity, actionability, clinicalRelevance, mechanisticImportance, feasibility, and distinctiveness.",
            "Penalize vague gaps, duplicated mechanism framing, missing comparators, weak outcome definitions, and unsupported animal-to-human leaps.",
            "Schema: {\"scores\": [{\"title\": string, \"priorityScore\": number, \"primaryGapType\": string, \"secondaryGapType\": string, \"evidenceLevel\": string, \"uncertaintyLevel\": string, \"evidenceScarcity\": number, \"actionability\": number, \"clinicalRelevance\": number, \"mechanisticImportance\": number, \"feasibility\": number, \"novelty\": number, \"distinctiveness\": number, \"justification\": string}]}",
            "",
            "Allowed gap types:",
            Object.entries(GAP_TYPE_LABELS)
              .map(([key, label]) => `- ${key}: ${label}`)
              .join("\n"),
            "",
            "Evidence levels:",
            Object.entries(EVIDENCE_LEVEL_LABELS)
              .map(([key, label]) => `- ${key}: ${label}`)
              .join("\n"),
            "",
            formatGaps(gaps),
          ].join("\n"),
        },
      ],
    },
    JSON.stringify({ scores: fallbackScores }),
    openRouterKey,
  );

  const parsed = parseStructured(GapScoresSchema, raw, { scores: fallbackScores });
  const llmScores = new Map(parsed.scores.map((score) => [normalizeKey(score.title), score]));
  const diversified = diversifyGapRankings(
    gaps.map((gap) => {
      const score = llmScores.get(normalizeKey(gap.title));
      return {
        id: gap._id,
        title: gap.title,
        description: gap.description,
        primaryGapType: score?.primaryGapType
          ? normalizeGapType(score.primaryGapType, `${gap.title} ${gap.description}`)
          : gap.primaryGapType,
        secondaryGapType: score?.secondaryGapType
          ? normalizeGapType(score.secondaryGapType, `${gap.title} ${gap.description}`)
          : gap.secondaryGapType,
        evidenceLevel: score?.evidenceLevel
          ? normalizeEvidenceLevel(score.evidenceLevel, `${gap.title} ${gap.description}`)
          : gap.evidenceLevel,
        uncertaintyLevel: score?.uncertaintyLevel
          ? normalizeUncertainty(score.uncertaintyLevel, gap.priorityScore)
          : gap.uncertaintyLevel,
        novelty: score?.novelty ?? gap.novelty,
        evidenceScarcity: score?.evidenceScarcity ?? gap.evidenceScarcity,
        actionability: score?.actionability ?? gap.actionability,
        clinicalRelevance: score?.clinicalRelevance ?? gap.clinicalRelevance,
        mechanisticImportance: score?.mechanisticImportance ?? gap.mechanisticImportance,
        feasibility: score?.feasibility ?? gap.feasibility,
        distinctiveness: score?.distinctiveness ?? gap.distinctiveness,
        priorityScore: score?.priorityScore ?? gap.priorityScore,
      };
    }),
  );
  const scoreUpdates: {
    gapId: Id<"gapCandidates">;
    priorityScore: number;
    primaryGapType?: GapProposal["primaryGapType"];
    secondaryGapType?: GapProposal["secondaryGapType"];
    evidenceLevel?: GapProposal["evidenceLevel"];
    uncertaintyLevel?: GapProposal["uncertaintyLevel"];
    evidenceScarcity?: number;
    actionability?: number;
    clinicalRelevance?: number;
    mechanisticImportance?: number;
    feasibility?: number;
    novelty?: number;
    distinctiveness?: number;
    diversityRationale?: string;
  }[] = [];

  for (const score of diversified) {
    const gap = gaps.find((candidate) => candidate._id === score.id);
    if (!gap) {
      continue;
    }
    scoreUpdates.push({
      gapId: gap._id,
      priorityScore: score.priorityScore,
      primaryGapType: score.primaryGapType,
      secondaryGapType: score.secondaryGapType,
      evidenceLevel: score.evidenceLevel,
      uncertaintyLevel: score.uncertaintyLevel,
      evidenceScarcity: score.evidenceScarcity,
      actionability: score.actionability,
      clinicalRelevance: score.clinicalRelevance,
      mechanisticImportance: score.mechanisticImportance,
      feasibility: score.feasibility,
      novelty: score.novelty,
      distinctiveness: score.distinctiveness,
      diversityRationale: score.diversityRationale,
    });
  }

  await ctx.runMutation(internal.problems.updateGapScores, { scores: scoreUpdates });

  await ctx.runMutation(internal.problems.addMessage, {
    problemId: state.problem._id,
    speakerName: "Gap Evaluator",
    role: "assistant",
    stepType: "ranking",
    content: diversified
      .slice(0, 8)
      .map((score) => {
        const gap = gaps.find((candidate) => candidate._id === score.id);
        return `- ${gap?.title ?? score.id}: ${Math.round(score.priorityScore)}/100; type=${score.primaryGapType}; evidence=${score.evidenceLevel}. ${score.diversityRationale}`;
      })
      .join("\n"),
  });
}

async function writeFinalReport(
  ctx: ActionCtx,
  state: WorkflowState,
  openRouterKey: string,
  partial: boolean,
) {
  const fallback = deterministicReport(state, partial);
  const raw = await callOrFallback(
    ctx,
    {
      problemId: state.problem._id,
      model: MODEL_CONFIG.evaluatorModel,
      temperature: MODEL_CONFIG.highPrecisionTemperature,
      maxTokens: 2200,
      messages: [
        { role: "system", content: `${SYSTEM_GUARDRAILS}\n\n${ROLE_PROMPTS.finalJudge}` },
        {
          role: "user",
          content: [
            "Stage 7: Final judge synthesis. Write the final Consilium Report in markdown.",
            "Use this section structure exactly and in this order:",
            REPORT_STRUCTURE,
            "",
            "Requirements:",
            "- Top Research Gaps must contain 3-5 non-redundant gaps from different primary gap types whenever possible.",
            "- Each gap must include Title, Primary gap type, Secondary gap type if any, Why this is a true gap, What is already known, What is missing, Evidence level, Uncertainty level, and Why this matters clinically or scientifically.",
            "- Ranked Study Proposals must include Objective, Population, Intervention/exposure, Comparator, Primary outcomes, Secondary outcomes, Biomarkers, Study design, and Feasibility notes for each final gap.",
            "- Final Answer must directly answer the user's original question while avoiding clinical advice.",
            "- Explicitly distinguish directly supported human evidence, indirect evidence, preclinical evidence, and speculation.",
            "",
            problemBrief(state.problem),
            "",
            "PICO:",
            formatPico(state.problem.picoExtraction),
            "",
            "Evidence map:",
            renderEvidenceMap(state.problem.evidenceMap ?? fallbackEvidenceMap(state)),
            "",
            "Top gap candidates:",
            formatGaps(
              [...state.gapCandidates].sort(
                (left, right) => (right.priorityScore ?? 0) - (left.priorityScore ?? 0),
              ),
            ),
            "",
            "References:",
            formatReferenceList(state.references, WORKFLOW_DEFAULTS.maxReferencesInPrompt),
          ].join("\n"),
        },
      ],
    },
    fallback,
    openRouterKey,
  );

  await ctx.runMutation(internal.problems.addMessage, {
    problemId: state.problem._id,
    speakerName: "Consilium Report",
    role: "assistant",
    stepType: "finalReport",
    content: raw,
  });
}

async function callOrFallback(
  ctx: ActionCtx,
  params: LlmCallParams,
  fallback: string,
  openRouterKey: string,
): Promise<string> {
  if (!openRouterKey) {
    return fallback;
  }

  try {
    await assertBudget(ctx, params.problemId);
    const result = await callLLM({
      apiKey: openRouterKey,
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? MODEL_CONFIG.temperature,
      maxTokens: params.maxTokens ?? MODEL_CONFIG.maxTokens,
      title: "AI Health Consilium",
      referer: process.env.OPENROUTER_HTTP_REFERER,
      retries: 1,
    });
    await ctx.runMutation(internal.problems.logUsage, {
      problemId: params.problemId,
      agentId: params.agentId,
      model: params.model,
      inputTokens: result.usage.inputTokens ?? undefined,
      outputTokens: result.usage.outputTokens ?? undefined,
      totalTokens: result.usage.totalTokens ?? undefined,
      costEstimate: result.usage.costEstimate ?? undefined,
      providerMetadata: result.usage.providerMetadata,
    });
    return result.content;
  } catch (error) {
    if (error instanceof BudgetLimitError) {
      throw error;
    }
    await addExternalError(ctx, params.problemId, "OpenRouter", error);
    return fallback;
  }
}

async function assertBudget(ctx: ActionCtx, problemId: Id<"problems">) {
  const usage = (await ctx.runQuery(internal.problems.usageTotals, {
    problemId,
  })) as UsageSummary;
  if (
    usage.calls >= WORKFLOW_DEFAULTS.perProblemMaxLlmCalls ||
    usage.totalTokens >= WORKFLOW_DEFAULTS.perProblemMaxTokens
  ) {
    throw new BudgetLimitError();
  }
}

async function loadState(ctx: ActionCtx, problemId: Id<"problems">): Promise<WorkflowState> {
  const state = (await ctx.runQuery(internal.problems.loadForWorkflow, {
    problemId,
  })) as WorkflowState | null;
  if (!state) {
    throw new Error("Problem not found.");
  }
  return state;
}

async function addExternalError(
  ctx: ActionCtx,
  problemId: Id<"problems">,
  source: string,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : "Unknown error";
  await ctx.runMutation(internal.problems.addMessage, {
    problemId,
    speakerName: "System",
    role: "system",
    stepType: "error",
    content: `${source} issue: ${message}`,
  });
}

function parseStructured<T>(schema: z.ZodType<T>, text: string, fallback: T): T {
  const record = extractJsonObject(text);
  if (!record) {
    return fallback;
  }
  const parsed = schema.safeParse(record);
  return parsed.success ? parsed.data : fallback;
}

function problemBrief(problem: Doc<"problems">): string {
  return [
    `Title: ${problem.title}`,
    `Description: ${problem.description}`,
    problem.constraints ? `Constraints: ${problem.constraints}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function fallbackPico(problem: Doc<"problems">): PicoExtraction {
  const combined = `${problem.title} ${problem.description} ${problem.constraints ?? ""}`;
  const lower = combined.toLowerCase();
  return {
    population: {
      value: lower.includes("adolescent")
        ? "Adolescent cerebral palsy patients"
        : lower.includes("cerebral palsy")
          ? "People with cerebral palsy; age range unclear"
          : "Unclear / not specified",
      status: lower.includes("cerebral palsy") ? "explicit" : "unclear",
    },
    intervention: {
      value: lower.includes("bdnf")
        ? "BDNF modulation; exact modality unclear and should be split by rehabilitation, stimulation, pharmacologic, nutritional, regenerative, and genetic routes"
        : "Unclear / not specified",
      status: lower.includes("bdnf") ? "explicit" : "unclear",
    },
    comparator: {
      value: "Not specified; could be usual care, sham stimulation, standard rehabilitation, placebo, or no exposure depending on intervention",
      status: "unclear",
    },
    outcomes: {
      value: lower.includes("motor") ? "Motor outcomes" : "Unclear / not specified",
      status: lower.includes("motor") ? "explicit" : "unclear",
    },
    context: {
      value: problem.constraints ?? "Clinical and translational biomedical research setting",
      status: problem.constraints ? "explicit" : "inferred",
    },
    mechanisticHypothesis: {
      value: lower.includes("bdnf")
        ? "BDNF-linked neuroplasticity may mediate motor improvement, but causality and modality are uncertain"
        : "Unclear / not specified",
      status: lower.includes("bdnf") ? "inferred" : "unclear",
    },
    ambiguousTerms: lower.includes("bdnf")
      ? ["BDNF modulation", "motor outcomes", "adolescent-specific evidence", "comparator"]
      : ["population", "intervention", "comparator", "outcomes"],
  };
}

function formatPico(pico: PicoExtraction | undefined): string {
  const value = pico ?? fallbackPicoFromUnknown();
  return [
    `- Population: ${value.population.value} (${value.population.status})`,
    `- Intervention: ${value.intervention.value} (${value.intervention.status})`,
    `- Comparator: ${value.comparator.value} (${value.comparator.status})`,
    `- Outcomes: ${value.outcomes.value} (${value.outcomes.status})`,
    `- Context: ${value.context.value} (${value.context.status})`,
    `- Mechanistic hypothesis: ${value.mechanisticHypothesis.value} (${value.mechanisticHypothesis.status})`,
    value.ambiguousTerms.length > 0
      ? `- Ambiguous terms: ${value.ambiguousTerms.join(", ")}`
      : "- Ambiguous terms: none flagged",
  ].join("\n");
}

function renderPicoMessage(pico: PicoExtraction): string {
  return ["PICO extraction", "", formatPico(pico)].join("\n");
}

function fallbackPicoFromUnknown(): PicoExtraction {
  return {
    population: { value: "Unclear / not specified", status: "unclear" },
    intervention: { value: "Unclear / not specified", status: "unclear" },
    comparator: { value: "Unclear / not specified", status: "unclear" },
    outcomes: { value: "Unclear / not specified", status: "unclear" },
    context: { value: "Unclear / not specified", status: "unclear" },
    mechanisticHypothesis: { value: "Unclear / not specified", status: "unclear" },
    ambiguousTerms: [],
  };
}

function fallbackEvidenceProfile(reference: Doc<"references">): ReferenceEvidenceProfile {
  const text = `${reference.title} ${reference.abstract ?? ""}`.toLowerCase();
  const evidenceLevel = normalizeEvidenceLevel(undefined, text);
  const species = text.includes("mouse") || text.includes("rat") || text.includes("animal")
    ? "animal"
    : text.includes("human") || reference.sourceType === "pubmed"
      ? "human"
      : "unclear";
  return {
    populationTags: inferTags(text).filter((tag) => ["cerebral", "palsy", "adolescent", "pediatric"].includes(tag)),
    interventionTypes: inferInterventionTypes(text),
    evidenceType: text.includes("systematic") ? "review" : text.includes("trial") ? "trial" : "observational_or_unclear",
    outcomeTypes: text.includes("motor") ? ["motor outcomes"] : [],
    species,
    ageRelevance: text.includes("adolescent") ? "adolescent_specific" : text.includes("pediatric") || text.includes("children") ? "pediatric" : "mixed_or_unclear",
    evidenceLevel,
  };
}

function normalizeReferenceEvidenceProfile(
  profile: z.infer<typeof ReferenceTagsSchema>["references"][number]["evidenceProfile"],
  reference: Doc<"references">,
): ReferenceEvidenceProfile {
  const fallback = fallbackEvidenceProfile(reference);
  if (!profile) {
    return fallback;
  }
  return {
    populationTags: compactStrings(profile.populationTags).slice(0, 8),
    interventionTypes: compactStrings(profile.interventionTypes).slice(0, 8),
    evidenceType: profile.evidenceType || fallback.evidenceType,
    outcomeTypes: compactStrings(profile.outcomeTypes).slice(0, 8),
    species: profile.species,
    ageRelevance: profile.ageRelevance,
    evidenceLevel: normalizeEvidenceLevel(profile.evidenceLevel, `${reference.title} ${reference.abstract ?? ""}`),
  };
}

function deterministicEvidenceSummary(state: WorkflowState): string {
  const map = fallbackEvidenceMap(state);
  return renderEvidenceMap(map);
}

function fallbackEvidenceMap(state: WorkflowState): EvidenceMap {
  const direct = state.references
    .filter((reference) => reference.evidenceProfile?.evidenceLevel === "direct_human_cp_adolescents")
    .slice(0, 4)
    .map((reference) => `${reference.title} (${reference.sourceId ?? reference.url ?? "reference"})`);
  const indirect = state.references
    .filter((reference) =>
      ["human_cp_broader_age", "indirect_human_other_neurological"].includes(
        reference.evidenceProfile?.evidenceLevel ?? "",
      ),
    )
    .slice(0, 4)
    .map((reference) => `${reference.title} (${reference.sourceId ?? reference.url ?? "reference"})`);
  const preclinical = state.references
    .filter((reference) => reference.evidenceProfile?.evidenceLevel === "preclinical_animal")
    .slice(0, 4)
    .map((reference) => `${reference.title} (${reference.sourceId ?? reference.url ?? "reference"})`);
  return {
    directlySupported: direct.length > 0 ? direct : ["No clearly direct adolescent CP human evidence was identified in the retrieved set."],
    indirectlySupported: indirect.length > 0 ? indirect : ["Any human support appears indirect, broader than adolescents, or not clearly CP-specific."],
    preclinicalOnly: preclinical.length > 0 ? preclinical : ["Preclinical-only support was not clearly separable from retrieved metadata."],
    speculative: ["Causal translation from BDNF biomarker change to motor improvement remains uncertain unless tested in a defined intervention and comparator."],
    caveats: [
      "PubMed abstracts may omit full-text methods and negative findings.",
      "Evidence classification is conservative and should be verified in a full systematic review.",
    ],
  };
}

function renderEvidenceMap(map: EvidenceMap): string {
  return [
    "Directly supported:",
    ...map.directlySupported.map((item) => `- ${item}`),
    "Indirectly supported:",
    ...map.indirectlySupported.map((item) => `- ${item}`),
    "Preclinical only:",
    ...map.preclinicalOnly.map((item) => `- ${item}`),
    "Speculative:",
    ...map.speculative.map((item) => `- ${item}`),
    "Caveats:",
    ...map.caveats.map((item) => `- ${item}`),
  ].join("\n");
}

function fallbackCritique(
  state: WorkflowState,
  critique: string,
): z.infer<typeof GapCritiqueSchema> {
  return {
    critique,
    gapUpdates: state.gapCandidates.slice(0, 12).map((gap) => ({
      title: gap.title,
      critique:
        "Check whether this gap duplicates another candidate, specifies intervention/comparator/outcomes, and avoids overclaiming from indirect evidence.",
      primaryGapType: normalizeGapType(gap.primaryGapType, `${gap.title} ${gap.description}`),
      evidenceLevel: normalizeEvidenceLevel(gap.evidenceLevel, `${gap.title} ${gap.description}`),
      uncertaintyLevel: normalizeUncertainty(gap.uncertaintyLevel, gap.priorityScore),
      priorityPenalty: 0,
    })),
  };
}

function fallbackStudyProposal(problem: Doc<"problems">, objective: string) {
  const pico = problem.picoExtraction ?? fallbackPico(problem);
  return {
    objective,
    population: pico.population.value,
    interventionOrExposure: pico.intervention.value,
    comparator: pico.comparator.value,
    primaryOutcomes: [pico.outcomes.value],
    secondaryOutcomes: ["Feasibility", "adverse events", "functional participation"],
    biomarkers: pico.mechanisticHypothesis.value.toLowerCase().includes("bdnf") ? ["serum/plasma BDNF"] : [],
    studyDesign: "Prospective scoping review or pilot protocol with prespecified PICO and evidence-level strata",
    feasibilityNotes: "Feasible as a low-risk design step before committing to an interventional trial.",
    whyThisDesignAddressesGap:
      "It forces population, intervention, comparator, and outcome boundaries before claiming novelty or causality.",
  };
}

function fallbackSearchPlan(problem: Doc<"problems">): SearchPlan {
  const query = compactTerms(`${problem.title} ${problem.description}`).slice(0, 9).join(" ");
  const safeQuery = query || problem.title;
  return {
    pubmedQueries: [
      safeQuery,
      `${safeQuery} clinical trial`,
      `${safeQuery} systematic review`,
      `${safeQuery} mechanism biomarker`,
    ],
    webQueries: [`${safeQuery} clinical guideline review`],
    rationale:
      "Fallback search plan generated from the problem statement because structured LLM planning was unavailable.",
  };
}

function fallbackDebate(
  agent: Doc<"agents"> | undefined,
  problem: Doc<"problems">,
  round: number,
): z.infer<typeof DebateSchema> {
  const shortTopic = problem.title.replace(/[^\w\s-]/g, "").slice(0, 90);
  const agentName = agent?.name ?? "Gap Finder";
  const pico = problem.picoExtraction ?? fallbackPico(problem);
  const baseKnown =
    "BDNF is biologically plausible for neuroplasticity, and retrieved evidence may include CP nutrition/activity associations or indirect neurological rehabilitation evidence.";
  return {
    contribution: `${agentName} round ${round}: The question should be narrowed with explicit population, intervention, comparator, and outcome boundaries. Evidence should be separated into clinical, mechanistic, and methods-quality layers before novelty is claimed.`,
    gapCandidates: [
      {
        title: `Intervention-specific BDNF routes are not separated for ${shortTopic}`,
        description:
          "BDNF modulation is too broad unless rehabilitation-induced, stimulation-induced, pharmacologic, nutritional, regenerative, and genetic routes are analyzed as distinct exposures.",
        primaryGapType: "intervention",
        secondaryGapType: "translational",
        whyTrueGap:
          "A single pooled 'BDNF modulation' label can hide very different mechanisms, risk profiles, comparators, and outcome windows.",
        whatKnown: baseKnown,
        whatMissing:
          "Side-by-side evidence mapping and protocol-ready definitions for each BDNF-modulating route in adolescent CP.",
        evidenceLevel: "human_cp_broader_age",
        uncertaintyLevel: "high",
        evidenceFor:
          "The question itself names a broad intervention class, while evidence retrieval mixes nutrition, activity, rehabilitation, and genetics.",
        evidenceAgainst:
          "Some individual routes may already have partial evidence in broader pediatric CP or other neurological populations.",
        priorityScore: 82,
        novelty: 72,
        evidenceScarcity: 76,
        actionability: 84,
        clinicalRelevance: 82,
        mechanisticImportance: 70,
        feasibility: 76,
        distinctiveness: 90,
        implementationIdeas: [
          "Run a route-stratified scoping review before selecting one intervention for trial design.",
          "Build separate PICO tables for rehabilitation, stimulation, nutrition, pharmacology, regenerative approaches, and genetics.",
        ],
        studyProposal: {
          ...fallbackStudyProposal(problem, "Separate BDNF-modulating routes into protocol-ready intervention classes."),
          interventionOrExposure:
            "Route-stratified exposure classes: rehabilitation, non-invasive stimulation, nutrition, pharmacologic, regenerative, and genetic moderators",
          comparator: "Usual care, sham/placebo, or route-specific standard comparator",
          studyDesign: "Route-stratified scoping review with evidence-gap matrix",
          whyThisDesignAddressesGap:
            "It prevents a broad mechanistic umbrella from producing redundant, non-testable gap claims.",
        },
        linkedReferenceIds: [],
      },
      {
        title: `Adolescent-specific CP evidence is missing for BDNF-linked motor outcomes`,
        description:
          "Evidence from children, adults, or mixed neurological populations may not apply to adolescents with CP because neurodevelopment, rehabilitation exposure, and motor goals differ.",
        primaryGapType: "population_subgroup",
        secondaryGapType: "long_term_outcome",
        whyTrueGap:
          "The PICO population is adolescent CP, but retrieved evidence often uses broader children-with-CP or non-CP neurological populations.",
        whatKnown: baseKnown,
        whatMissing:
          "Studies powered or stratified specifically for adolescent CP motor outcomes and maturational stage.",
        evidenceLevel: "human_cp_broader_age",
        uncertaintyLevel: "high",
        evidenceFor: "Adolescent-specific evidence is explicitly ambiguous in the query and commonly absent from abstracts.",
        evidenceAgainst: "Broader pediatric CP findings may still be informative if age-stratified data are available in full text.",
        priorityScore: 80,
        novelty: 68,
        evidenceScarcity: 82,
        actionability: 78,
        clinicalRelevance: 88,
        mechanisticImportance: 62,
        feasibility: 72,
        distinctiveness: 88,
        implementationIdeas: [
          "Design an adolescent CP cohort or nested subgroup analysis with prespecified age strata.",
          "Use validated motor measures relevant to adolescent participation and mobility goals.",
        ],
        studyProposal: {
          ...fallbackStudyProposal(problem, "Estimate whether adolescent CP differs from younger pediatric CP in BDNF-linked motor response."),
          population: pico.population.value,
          comparator: "Younger pediatric CP subgroup or usual-care adolescent CP cohort",
          primaryOutcomes: ["GMFM-D/E or equivalent gross motor function", "functional mobility test"],
          studyDesign: "Prospective cohort or age-stratified secondary analysis",
          whyThisDesignAddressesGap:
            "It tests whether the target adolescent population is being inappropriately inferred from broader CP evidence.",
        },
        linkedReferenceIds: [],
      },
      {
        title: "Comparator choices are under-specified for BDNF-modulating interventions",
        description:
          "The same BDNF hypothesis implies different valid controls depending on whether the intervention is rehabilitation, stimulation, nutrition, medication, or regenerative therapy.",
        primaryGapType: "comparator",
        secondaryGapType: "study_design_methodology",
        whyTrueGap:
          "Without route-specific comparators, a positive association cannot distinguish BDNF effects from attention, activity dose, usual care, placebo, or natural development.",
        whatKnown: "Usual care, sham stimulation, placebo, and dose-matched rehabilitation are plausible but not interchangeable.",
        whatMissing:
          "Comparator standards for each intervention route and outcome window in adolescent CP.",
        evidenceLevel: "mechanistic_speculation",
        uncertaintyLevel: "very_high",
        evidenceFor: "The extracted PICO marks comparator as unclear.",
        evidenceAgainst: "Some route-specific trials outside CP may already define acceptable comparators.",
        priorityScore: 77,
        novelty: 62,
        evidenceScarcity: 78,
        actionability: 86,
        clinicalRelevance: 74,
        mechanisticImportance: 50,
        feasibility: 84,
        distinctiveness: 88,
        implementationIdeas: [
          "Create a comparator decision table by intervention route.",
          "Pilot one route with a matched-intensity comparator before causal claims.",
        ],
        studyProposal: {
          ...fallbackStudyProposal(problem, "Define route-specific comparator standards for BDNF intervention studies."),
          comparator: "Matched-intensity usual care, sham stimulation, placebo, or non-BDNF-targeted active control",
          primaryOutcomes: ["Feasibility of comparator delivery", "between-group motor outcome difference"],
          studyDesign: "Methodology study plus pilot randomized protocol",
          whyThisDesignAddressesGap:
            "It operationalizes the missing C in PICO and reduces false attribution to BDNF.",
        },
        linkedReferenceIds: [],
      },
      {
        title: "BDNF biomarker change is not validated as a causal mediator of motor improvement",
        description:
          "BDNF levels may be a correlate of nutrition, activity, severity, or rehabilitation dose rather than a mediator that causes motor improvement.",
        primaryGapType: "biomarker_measurement",
        secondaryGapType: "mechanism",
        whyTrueGap:
          "A biomarker association cannot support intervention efficacy unless timing, assay, confounding, and mediation are specified.",
        whatKnown: baseKnown,
        whatMissing:
          "Longitudinal biomarker sampling linked to prespecified motor outcomes and mediation analysis.",
        evidenceLevel: "human_cp_broader_age",
        uncertaintyLevel: "high",
        evidenceFor: "Retrieved evidence may associate BDNF with nutrition or physical activity in CP.",
        evidenceAgainst: "Peripheral BDNF may not reflect central neuroplasticity or causal motor mechanisms.",
        priorityScore: 79,
        novelty: 70,
        evidenceScarcity: 74,
        actionability: 80,
        clinicalRelevance: 76,
        mechanisticImportance: 88,
        feasibility: 68,
        distinctiveness: 86,
        implementationIdeas: [
          "Measure BDNF at baseline, post-intervention, and follow-up with predefined motor endpoints.",
          "Model mediation and confounding by activity, nutrition, severity, and rehabilitation dose.",
        ],
        studyProposal: {
          ...fallbackStudyProposal(problem, "Test whether BDNF change mediates motor outcome change rather than merely correlating with it."),
          interventionOrExposure: "Defined rehabilitation or activity exposure with serial BDNF sampling",
          primaryOutcomes: ["Change in validated motor score", "change in BDNF concentration"],
          secondaryOutcomes: ["activity dose", "nutrition status", "CP severity strata"],
          biomarkers: ["serum or plasma BDNF", "optional inflammatory or metabolic covariates"],
          studyDesign: "Prospective longitudinal mediation study",
          whyThisDesignAddressesGap:
            "It distinguishes biomarker association from a plausible causal pathway.",
        },
        linkedReferenceIds: [],
      },
      {
        title: "Genetic moderators such as BDNF Val66Met are not tested in adolescent CP rehabilitation response",
        description:
          "BDNF genotype may modify response to motor learning or rehabilitation, but CP-specific adolescent data are likely sparse and often inferred from stroke or adult neurorehabilitation.",
        primaryGapType: "translational",
        secondaryGapType: "population_subgroup",
        whyTrueGap:
          "A genetic moderator could explain heterogeneous rehabilitation response, but extrapolation from other populations is uncertain.",
        whatKnown: "Val66Met is biologically relevant to BDNF secretion and motor learning in some neurological settings.",
        whatMissing: "CP adolescent genotype-stratified rehabilitation outcomes.",
        evidenceLevel: "indirect_human_other_neurological",
        uncertaintyLevel: "very_high",
        evidenceFor: "Indirect neurorehabilitation literature supports plausibility.",
        evidenceAgainst: "CP pathophysiology and adolescent development may make direct transfer invalid.",
        priorityScore: 74,
        novelty: 76,
        evidenceScarcity: 84,
        actionability: 66,
        clinicalRelevance: 70,
        mechanisticImportance: 82,
        feasibility: 58,
        distinctiveness: 84,
        implementationIdeas: [
          "Add optional genotyping to a rehabilitation cohort.",
          "Predefine genotype-by-intervention interaction rather than post-hoc subgroup claims.",
        ],
        studyProposal: {
          ...fallbackStudyProposal(problem, "Evaluate whether BDNF Val66Met modifies motor response to rehabilitation in adolescent CP."),
          interventionOrExposure: "Standardized rehabilitation dose plus BDNF Val66Met genotype",
          comparator: "Val/Val versus Met-carrier strata within the same rehabilitation protocol",
          primaryOutcomes: ["change in gait or gross motor function"],
          biomarkers: ["BDNF Val66Met genotype", "optional BDNF concentration"],
          studyDesign: "Prospective genotype-stratified cohort",
          whyThisDesignAddressesGap:
            "It tests a mechanistically plausible source of heterogeneous response without assuming efficacy.",
        },
        linkedReferenceIds: [],
      },
      {
        title: "Safety and feasibility are unclear for pharmacologic or regenerative BDNF modulation in adolescent CP",
        description:
          "Pharmacologic, stem-cell, or regenerative strategies may carry higher risk and weaker evidence than rehabilitation or nutrition routes.",
        primaryGapType: "safety_feasibility",
        secondaryGapType: "intervention",
        whyTrueGap:
          "A biologically attractive BDNF target is not clinically useful if the route is unsafe, infeasible, or ethically hard to test in adolescents.",
        whatKnown: "Non-invasive and lifestyle-linked routes are more feasible; pharmacologic/regenerative routes need stricter safety framing.",
        whatMissing: "Adolescent CP-specific safety, feasibility, ethics, and stopping-rule evidence by route.",
        evidenceLevel: "mechanistic_speculation",
        uncertaintyLevel: "very_high",
        evidenceFor: "The broad intervention phrase includes high-risk categories.",
        evidenceAgainst: "The final research question may exclude high-risk routes after clarification.",
        priorityScore: 71,
        novelty: 64,
        evidenceScarcity: 82,
        actionability: 70,
        clinicalRelevance: 84,
        mechanisticImportance: 56,
        feasibility: 52,
        distinctiveness: 82,
        implementationIdeas: [
          "Separate low-risk activity/nutrition/rehab routes from high-risk pharmacologic/regenerative routes.",
          "Run feasibility and ethics review before efficacy study planning.",
        ],
        studyProposal: {
          ...fallbackStudyProposal(problem, "Map safety and feasibility constraints by BDNF-modulating route."),
          primaryOutcomes: ["adverse event profile", "recruitment feasibility", "protocol acceptability"],
          studyDesign: "Feasibility and ethics scoping study",
          whyThisDesignAddressesGap:
            "It prevents speculative high-risk routes from being ranked as clinically ready gaps.",
        },
        linkedReferenceIds: [],
      },
      {
        title: "Durability of motor gains and BDNF changes is not established",
        description:
          "Short-term biomarker or motor changes may not persist, and durable functional gains matter more clinically than transient BDNF shifts.",
        primaryGapType: "long_term_outcome",
        secondaryGapType: "biomarker_measurement",
        whyTrueGap:
          "A motor intervention can look promising immediately after training while failing to change durable mobility or participation.",
        whatKnown: "BDNF may change with activity or rehabilitation, but durability in adolescent CP is uncertain.",
        whatMissing: "Follow-up linking BDNF trajectories with sustained motor and participation outcomes.",
        evidenceLevel: "human_cp_broader_age",
        uncertaintyLevel: "high",
        evidenceFor: "The outcome PICO is motor improvement, not only biomarker movement.",
        evidenceAgainst: "Some rehabilitation studies may already include follow-up but not BDNF mediation.",
        priorityScore: 73,
        novelty: 66,
        evidenceScarcity: 78,
        actionability: 74,
        clinicalRelevance: 86,
        mechanisticImportance: 66,
        feasibility: 64,
        distinctiveness: 84,
        implementationIdeas: [
          "Use 3- to 12-month follow-up after a defined intervention.",
          "Track both motor function and BDNF trajectory to avoid short-term surrogate endpoints.",
        ],
        studyProposal: {
          ...fallbackStudyProposal(problem, "Test durability of motor and BDNF changes after a defined intervention."),
          primaryOutcomes: ["motor function at 6 months", "functional mobility or participation"],
          secondaryOutcomes: ["BDNF trajectory", "adherence", "rehabilitation dose"],
          studyDesign: "Prospective follow-up cohort nested in an intervention study",
          whyThisDesignAddressesGap:
            "It tests whether mechanistic or short-term signals survive into clinically meaningful outcomes.",
        },
        linkedReferenceIds: [],
      },
      {
        title: "Combined non-invasive stimulation plus rehabilitation lacks BDNF-grounded CP adolescent trials",
        description:
          "Stimulation may prime plasticity and rehabilitation may drive task-specific motor learning, but adolescent CP evidence with BDNF measurement is uncertain.",
        primaryGapType: "intervention",
        secondaryGapType: "biomarker_measurement",
        whyTrueGap:
          "This is a testable route-specific hypothesis rather than a generic mechanism claim.",
        whatKnown:
          "Non-invasive stimulation and rehabilitation have plausible links to neuroplasticity in other populations.",
        whatMissing:
          "Adolescent CP trials that combine stimulation, standardized rehabilitation, motor endpoints, and BDNF measurement.",
        evidenceLevel: "indirect_human_other_neurological",
        uncertaintyLevel: "high",
        evidenceFor:
          "The route is biologically plausible and operationalizable.",
        evidenceAgainst:
          "Evidence may be indirect, and sham-controlled adolescent CP designs can be difficult.",
        priorityScore: 76,
        novelty: 74,
        evidenceScarcity: 80,
        actionability: 76,
        clinicalRelevance: 78,
        mechanisticImportance: 78,
        feasibility: 62,
        distinctiveness: 82,
        implementationIdeas: [
          "Pilot sham-controlled stimulation plus standardized task-specific rehabilitation.",
          "Measure BDNF and motor outcomes at matched time points.",
        ],
        studyProposal: {
          ...fallbackStudyProposal(problem, "Test whether stimulation plus rehabilitation changes BDNF and motor outcomes."),
          interventionOrExposure: "Non-invasive brain stimulation paired with standardized rehabilitation",
          comparator: "Sham stimulation plus identical rehabilitation dose",
          primaryOutcomes: ["GMFM or gait function", "safety and tolerability"],
          secondaryOutcomes: ["BDNF concentration", "corticospinal excitability if available"],
          studyDesign: "Pilot randomized sham-controlled trial",
          whyThisDesignAddressesGap:
            "It isolates a specific BDNF-modulating route with an interpretable comparator and endpoint set.",
        },
        linkedReferenceIds: [],
      },
    ],
  };
}

function deterministicReport(state: WorkflowState, partial: boolean): string {
  const topGaps = [...state.gapCandidates]
    .sort((left, right) => (right.priorityScore ?? 0) - (left.priorityScore ?? 0))
    .slice(0, 5);
  const evidenceMap = state.problem.evidenceMap ?? fallbackEvidenceMap(state);

  return [
    `# Consilium Report: ${state.problem.title}`,
    "",
    partial
      ? "> This is a partial report because the configured LLM soft limit was reached."
      : "> This report was generated with fallback synthesis because an LLM was unavailable or returned an unusable response.",
    "",
    "## Reformulated Clinical/Research Question",
    state.problem.description,
    state.problem.constraints ? `\nConstraints: ${state.problem.constraints}` : "",
    "",
    "## PICO Extraction",
    formatPico(state.problem.picoExtraction),
    "",
    "## Evidence Map",
    renderEvidenceMap(evidenceMap),
    "",
    "## Top Research Gaps",
    ...(topGaps.length > 0
      ? topGaps.map(
          (gap, index) =>
            [
              `${index + 1}. **${gap.title}** (${Math.round(gap.priorityScore ?? 0)}/100)`,
              `- Primary gap type: ${gap.primaryGapType ?? "unclear"}`,
              `- Secondary gap type: ${gap.secondaryGapType ?? "none"}`,
              `- Why this is a true gap: ${gap.whyTrueGap ?? gap.description}`,
              `- What is already known: ${gap.whatKnown ?? gap.evidenceFor}`,
              `- What is missing: ${gap.whatMissing ?? gap.description}`,
              `- Evidence level: ${gap.evidenceLevel ?? "mechanistic_speculation"}`,
              `- Uncertainty level: ${gap.uncertaintyLevel ?? "very_high"}`,
              `- Why this matters: ${gap.description}`,
            ].join("\n"),
        )
      : ["No structured gaps were proposed. Narrow the research question and rerun the workflow."]),
    "",
    "## Ranked Study Proposals",
    ...(topGaps.length > 0
      ? topGaps.map((gap, index) => renderStudyProposal(gap, index + 1))
      : ["No study proposals are available."]),
    "",
    "## Limitations",
    "- PubMed records may not include full text.",
    "- Evidence may be indirect across CP age groups, other neurological populations, or preclinical models.",
    "- CP populations are heterogeneous by age, motor phenotype, severity, comorbidities, and rehabilitation exposure.",
    "- Biomarker changes such as BDNF shifts may not translate causally into motor outcomes.",
    "- Apify web evidence is optional and depends on actor configuration.",
    "",
    "## Final Answer",
    "The question remains plausible as a research hypothesis, but the current evidence should not be read as clinical proof. The strongest next step is to separate the broad intervention phrase into specific BDNF-modulating routes and test each against explicit comparators and motor endpoints.",
  ].join("\n");
}

function renderDebateMessage(
  contribution: string,
  gaps: z.infer<typeof EnhancedGapCandidateSchema>[],
): string {
  if (gaps.length === 0) {
    return contribution;
  }
  return [
    contribution,
    "",
    "Gap candidates:",
    ...gaps.map(
      (gap) =>
        `- ${gap.title}: ${gap.description} Type ${gap.primaryGapType ?? "unclear"}; evidence ${gap.evidenceLevel ?? "unclear"}; priority ${Math.round(gap.priorityScore ?? 0)}/100.`,
    ),
  ].join("\n");
}

function formatReferenceList(references: Doc<"references">[], max: number): string {
  return references
    .slice(0, max)
    .map((reference, index) => {
      const key = reference.sourceId ?? reference.url ?? reference._id;
      const abstract = reference.abstract ? ` Abstract: ${truncate(reference.abstract, 650)}` : "";
      const citation = [reference.journal, reference.year].filter(Boolean).join(", ");
      const profile = reference.evidenceProfile
        ? ` evidenceLevel=${reference.evidenceProfile.evidenceLevel}; species=${reference.evidenceProfile.species}; age=${reference.evidenceProfile.ageRelevance}; interventions=${reference.evidenceProfile.interventionTypes.join(", ")}; outcomes=${reference.evidenceProfile.outcomeTypes.join(", ")}.`
        : "";
      return `${index + 1}. key=${key}; title=${reference.title}; ${citation}; tags=${reference.tags.join(", ")};${profile}${abstract}`;
    })
    .join("\n");
}

function formatDiscussion(
  messages: { speakerName: string; content: string }[],
  max: number,
): string {
  return messages
    .slice(-max)
    .map((message) => `${message.speakerName}: ${truncate(message.content, 700)}`)
    .join("\n\n");
}

function formatGaps(gaps: Doc<"gapCandidates">[]): string {
  return gaps
    .map((gap, index) =>
      [
        `${index + 1}. ${gap.title}`,
        `Priority: ${gap.priorityScore ?? "unscored"}`,
        `Primary gap type: ${gap.primaryGapType ?? "unclear"}`,
        `Secondary gap type: ${gap.secondaryGapType ?? "none"}`,
        `Evidence level: ${gap.evidenceLevel ?? "unclear"}`,
        `Uncertainty: ${gap.uncertaintyLevel ?? "unclear"}`,
        `Description: ${gap.description}`,
        `Why true gap: ${gap.whyTrueGap ?? ""}`,
        `What known: ${gap.whatKnown ?? ""}`,
        `What missing: ${gap.whatMissing ?? ""}`,
        `Evidence for: ${gap.evidenceFor}`,
        `Evidence against: ${gap.evidenceAgainst}`,
        `Scores: novelty=${gap.novelty ?? "n/a"}; scarcity=${gap.evidenceScarcity ?? "n/a"}; actionability=${gap.actionability ?? "n/a"}; clinical=${gap.clinicalRelevance ?? "n/a"}; mechanistic=${gap.mechanisticImportance ?? "n/a"}; feasibility=${gap.feasibility ?? "n/a"}; distinctiveness=${gap.distinctiveness ?? "n/a"}`,
        `Study proposal: ${gap.studyProposal ? renderStudyProposal(gap, index + 1) : "not specified"}`,
        `Ideas: ${gap.implementationIdeas.join("; ")}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function renderStudyProposal(gap: Doc<"gapCandidates">, index: number): string {
  const proposal = gap.studyProposal;
  if (!proposal) {
    return `${index}. **${gap.title}**\n- Objective: ${gap.description}\n- Population: Not specified\n- Intervention/exposure: Not specified\n- Comparator: Not specified\n- Primary outcomes: Not specified\n- Secondary outcomes: Not specified\n- Biomarkers: Not specified\n- Study design: Protocol-ready design not specified\n- Feasibility notes: Requires explicit PICO refinement.`;
  }
  return [
    `${index}. **${gap.title}**`,
    `- Objective: ${proposal.objective}`,
    `- Population: ${proposal.population}`,
    `- Intervention/exposure: ${proposal.interventionOrExposure}`,
    `- Comparator: ${proposal.comparator}`,
    `- Primary outcomes: ${proposal.primaryOutcomes.join("; ") || "Not specified"}`,
    `- Secondary outcomes: ${proposal.secondaryOutcomes.join("; ") || "Not specified"}`,
    `- Biomarkers: ${proposal.biomarkers.join("; ") || "None specified"}`,
    `- Study design: ${proposal.studyDesign}`,
    `- Feasibility notes: ${proposal.feasibilityNotes}`,
    `- Why this design addresses the gap: ${proposal.whyThisDesignAddressesGap}`,
  ].join("\n");
}

function resolveLinkedReferences(
  keys: string[],
  references: Doc<"references">[],
): Id<"references">[] {
  const byKey = referenceKeyMap(references);
  const resolved = keys
    .map((key) => byKey.get(key)?._id)
    .filter((id): id is Id<"references"> => Boolean(id));
  return [...new Set(resolved)].slice(0, 8);
}

function referenceKeyMap(references: Doc<"references">[]): Map<string, Doc<"references">> {
  const map = new Map<string, Doc<"references">>();
  for (const reference of references) {
    map.set(reference._id, reference);
    if (reference.sourceId) {
      map.set(reference.sourceId, reference);
    }
    if (reference.url) {
      map.set(reference.url, reference);
    }
  }
  return map;
}

function inferTags(text: string): string[] {
  return compactTerms(text).slice(0, 6);
}

function inferInterventionTypes(text: string): string[] {
  const values = [
    ["rehabilitation", /rehabilitation|exercise|training|therapy/i],
    ["non-invasive brain stimulation", /tms|tdcs|stimulation|neuromodulation/i],
    ["pharmacologic", /drug|pharmacologic|medication|agonist|inhibitor/i],
    ["nutritional", /nutrition|diet|supplement|omega|vitamin/i],
    ["regenerative", /stem cell|regenerative|cell therapy/i],
    ["genetic moderator", /val66met|polymorphism|genetic|genotype/i],
    ["biomarker association", /bdnf|biomarker|serum|plasma/i],
  ] as const;
  const found = values.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  return found.length > 0 ? found : ["unclear"];
}

function findAgent(state: WorkflowState, namePart: string): Doc<"agents"> | undefined {
  const normalized = namePart.toLowerCase();
  return state.agents.find((agent) => agent.name.toLowerCase().includes(normalized));
}

function compactTerms(text: string): string[] {
  const stopWords = new Set([
    "about",
    "after",
    "and",
    "are",
    "can",
    "for",
    "from",
    "has",
    "have",
    "health",
    "into",
    "the",
    "this",
    "that",
    "with",
  ]);
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((term) => term.length > 3 && !stopWords.has(term)),
    ),
  ];
}

function compactStrings(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
