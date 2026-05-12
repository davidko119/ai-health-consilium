import { v } from "convex/values";
import { z } from "zod";
import {
  MODEL_CONFIG,
  SYSTEM_GUARDRAILS,
  WORKFLOW_DEFAULTS,
} from "../config/consilium";
import { scrapeWithApify } from "../lib/apify";
import { searchExa } from "../lib/exa";
import { callLLM, extractJsonObject } from "../lib/openrouter";
import { fetchPubmedSummaries, searchPubmed } from "../lib/pubmed";
import type { ChatMessage, GapProposal, SearchPlan } from "../types/consilium";
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

const ReferenceTagsSchema = z.object({
  references: z
    .array(
      z.object({
        sourceId: z.string(),
        tags: z.array(z.string()).default([]),
        cluster: z.string().default("Mapped evidence"),
      }),
    )
    .default([]),
});

const DebateSchema = z.object({
  contribution: z.string().default(""),
  gapCandidates: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        evidenceFor: z.string().default(""),
        evidenceAgainst: z.string().default(""),
        priorityScore: z.number().optional(),
        implementationIdeas: z.array(z.string()).default([]),
        linkedReferenceIds: z.array(z.string()).default([]),
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
        evidenceScarcity: z.number().optional(),
        potentialImpact: z.number().optional(),
        feasibility: z.number().optional(),
        novelty: z.number().optional(),
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
            content: `Research problem:\n${problemBrief(state.problem)}\n\nGenerate concise clarifying questions, a refined research formulation, and your plan of attack.`,
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
  const exaCount = await collectExaReferences(ctx, problem, queries);
  const token = process.env.APIFY_TOKEN;
  const actorId = process.env.APIFY_ACTOR_ID;
  const inputTemplateJson = process.env.APIFY_ACTOR_INPUT_JSON;

  if (!token || !actorId || queries.length === 0) {
    return exaCount;
  }

  let count = exaCount;
  for (const queryText of queries) {
    try {
      const outputs = await scrapeWithApify({
        token,
        actorId,
        inputTemplateJson,
        query: queryText,
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
): Promise<number> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey || queries.length === 0) {
    return 0;
  }

  let count = 0;
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
    } catch (error) {
      await addExternalError(ctx, problem._id, "Exa search", error);
    }
  }
  return count;
}

async function tagReferences(ctx: ActionCtx, state: WorkflowState, openRouterKey: string) {
  if (state.references.length === 0) {
    return;
  }

  const fallbackUpdates = state.references.map((reference) => ({
    referenceId: reference._id,
    tags: inferTags(`${state.problem.title} ${reference.title} ${reference.abstract ?? ""}`),
    cluster: reference.sourceType === "pubmed" ? "Biomedical literature" : "Web evidence",
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
            "Schema: {\"references\": [{\"sourceId\": string, \"tags\": string[], \"cluster\": string}]}",
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
      };
    })
    .filter((item): item is { referenceId: Id<"references">; tags: string[]; cluster: string } =>
      Boolean(item),
    );

  await ctx.runMutation(internal.problems.patchReferenceTags, {
    updates: updates.length > 0 ? updates : fallbackUpdates,
  });
}

async function runDebate(ctx: ActionCtx, initialState: WorkflowState, openRouterKey: string) {
  const discussionMemory = initialState.messages.map((message) => ({
    speakerName: message.speakerName,
    content: message.content,
  }));

  for (let round = 1; round <= WORKFLOW_DEFAULTS.maxDebateRounds; round += 1) {
    for (const agent of initialState.agents) {
      const fallback = fallbackDebate(agent, initialState.problem, round);
      const raw = await callOrFallback(
        ctx,
        {
          problemId: initialState.problem._id,
          agentId: agent._id,
          model: agent.model,
          temperature: agent.temperature,
          maxTokens: 1500,
          messages: [
            { role: "system", content: `${SYSTEM_GUARDRAILS}\n\n${agent.roleDescription}` },
            {
              role: "user",
              content: [
                `Round ${round}. Contribute to the expert debate as ${agent.name}.`,
                "Return JSON only with this schema:",
                "{\"contribution\": string, \"gapCandidates\": [{\"title\": string, \"description\": string, \"evidenceFor\": string, \"evidenceAgainst\": string, \"priorityScore\": number, \"implementationIdeas\": string[], \"linkedReferenceIds\": string[]}]}",
                "",
                problemBrief(initialState.problem),
                "",
                "Relevant references:",
                formatReferenceList(initialState.references, WORKFLOW_DEFAULTS.maxReferencesInPrompt),
                "",
                "Recent discussion:",
                formatDiscussion(discussionMemory, WORKFLOW_DEFAULTS.recentMessageWindow),
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
        agentId: agent._id,
        speakerName: agent.name,
        role: "agent",
        stepType: parsed.gapCandidates.length > 0 ? "gapCandidate" : "critique",
        round,
        content: messageContent,
      });

      discussionMemory.push({ speakerName: agent.name, content: messageContent });

      for (const gap of parsed.gapCandidates.slice(0, 2)) {
        await ctx.runMutation(internal.problems.insertGapCandidate, {
          problemId: initialState.problem._id,
          agentId: agent._id,
          title: gap.title,
          description: gap.description,
          evidenceFor: gap.evidenceFor,
          evidenceAgainst: gap.evidenceAgainst,
          priorityScore: gap.priorityScore,
          implementationIdeas: gap.implementationIdeas,
          linkedReferenceIds: resolveLinkedReferences(gap.linkedReferenceIds, initialState.references),
        });
      }
    }
  }
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
      evidenceFor: "No structured gap candidates were proposed during the debate.",
      evidenceAgainst: "The absence may reflect limited retrieval, missing API keys, or an overly broad question rather than a true lack of gaps.",
      priorityScore: 50,
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
    evidenceScarcity: 70,
    potentialImpact: 65,
    feasibility: 60,
    novelty: 62,
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
            "Score each research gap. Return JSON only.",
            "Use 0-100 scores for priorityScore, evidenceScarcity, potentialImpact, feasibility, and novelty.",
            "Schema: {\"scores\": [{\"title\": string, \"priorityScore\": number, \"evidenceScarcity\": number, \"potentialImpact\": number, \"feasibility\": number, \"novelty\": number, \"justification\": string}]}",
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
  const byTitle = new Map(gaps.map((gap) => [normalizeKey(gap.title), gap]));
  const scoreUpdates: {
    gapId: Id<"gapCandidates">;
    priorityScore: number;
    evidenceScarcity?: number;
    potentialImpact?: number;
    feasibility?: number;
    novelty?: number;
  }[] = [];

  for (const score of parsed.scores) {
    const gap = byTitle.get(normalizeKey(score.title));
    if (!gap) {
      continue;
    }
    const update: {
      gapId: Id<"gapCandidates">;
      priorityScore: number;
      evidenceScarcity?: number;
      potentialImpact?: number;
      feasibility?: number;
      novelty?: number;
    } = {
      gapId: gap._id,
      priorityScore: score.priorityScore,
    };
    if (score.evidenceScarcity !== undefined) {
      update.evidenceScarcity = score.evidenceScarcity;
    }
    if (score.potentialImpact !== undefined) {
      update.potentialImpact = score.potentialImpact;
    }
    if (score.feasibility !== undefined) {
      update.feasibility = score.feasibility;
    }
    if (score.novelty !== undefined) {
      update.novelty = score.novelty;
    }
    scoreUpdates.push(update);
  }

  await ctx.runMutation(internal.problems.updateGapScores, { scores: scoreUpdates });

  await ctx.runMutation(internal.problems.addMessage, {
    problemId: state.problem._id,
    speakerName: "Gap Evaluator",
    role: "assistant",
    stepType: "ranking",
    content: parsed.scores
      .map(
        (score) =>
          `- ${score.title}: ${Math.round(score.priorityScore)}/100. ${score.justification}`,
      )
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
        { role: "system", content: SYSTEM_GUARDRAILS },
        {
          role: "user",
          content: [
            "Write the final Consilium Report in markdown.",
            "Include reformulated questions, literature summary, top 3-5 gaps, study ideas, and limitations.",
            "Be explicit about weak evidence and missing full text access.",
            "",
            problemBrief(state.problem),
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
  agent: Doc<"agents">,
  problem: Doc<"problems">,
  round: number,
): z.infer<typeof DebateSchema> {
  const shortTopic = problem.title.replace(/[^\w\s-]/g, "").slice(0, 90);
  return {
    contribution: `${agent.name} round ${round}: The question should be narrowed with explicit population, intervention, comparator, and outcome boundaries. Evidence should be separated into clinical, mechanistic, and methods-quality layers before novelty is claimed.`,
    gapCandidates: [
      {
        title: `${agent.name}: under-specified evidence boundary for ${shortTopic}`,
        description:
          "The current literature map may not cleanly separate populations, intervention timing, outcome measures, and mechanistic biomarkers. That creates a gap around which subgroup and endpoint combinations are actually testable.",
        evidenceFor:
          "The problem statement is broad enough that retrieved studies may mix designs, populations, and endpoints.",
        evidenceAgainst:
          "A focused systematic review might already resolve this once strict inclusion criteria are applied.",
        priorityScore: 58,
        implementationIdeas: [
          "Run a scoping review stratified by population, intervention timing, and primary outcome.",
          "Design a pilot protocol with predefined feasibility and outcome measurement criteria.",
        ],
        linkedReferenceIds: [],
      },
    ],
  };
}

function deterministicReport(state: WorkflowState, partial: boolean): string {
  const topGaps = [...state.gapCandidates]
    .sort((left, right) => (right.priorityScore ?? 0) - (left.priorityScore ?? 0))
    .slice(0, 5);
  const references = state.references.slice(0, 8);

  return [
    `# Consilium Report: ${state.problem.title}`,
    "",
    partial
      ? "> This is a partial report because the configured LLM soft limit was reached."
      : "> This report was generated with fallback synthesis because an LLM was unavailable or returned an unusable response.",
    "",
    "## Reformulated Question",
    state.problem.description,
    state.problem.constraints ? `\nConstraints: ${state.problem.constraints}` : "",
    "",
    "## Literature Snapshot",
    `The workflow mapped ${state.references.length} references. ${
      references.length > 0
        ? "The most visible sources are listed below."
        : "No references were available, so evidence claims should be treated as provisional."
    }`,
    ...references.map((reference) => `- ${reference.title}${reference.sourceId ? ` (${reference.sourceId})` : ""}`),
    "",
    "## Highest Priority Gaps",
    ...(topGaps.length > 0
      ? topGaps.map(
          (gap, index) =>
            `${index + 1}. **${gap.title}** (${Math.round(gap.priorityScore ?? 0)}/100)\n\n${gap.description}\n\nStudy ideas: ${gap.implementationIdeas.join("; ")}`,
        )
      : ["No structured gaps were proposed. Narrow the research question and rerun the workflow."]),
    "",
    "## Caveats",
    "- PubMed records may not include full text.",
    "- Apify web evidence is optional and depends on actor configuration.",
    "- Scores are prioritization aids, not proof of novelty.",
  ].join("\n");
}

function renderDebateMessage(contribution: string, gaps: GapProposal[]): string {
  if (gaps.length === 0) {
    return contribution;
  }
  return [
    contribution,
    "",
    "Gap candidates:",
    ...gaps.map(
      (gap) =>
        `- ${gap.title}: ${gap.description} Priority ${Math.round(gap.priorityScore ?? 0)}/100.`,
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
      return `${index + 1}. key=${key}; title=${reference.title}; ${citation}; tags=${reference.tags.join(", ")}.${abstract}`;
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
        `Description: ${gap.description}`,
        `Evidence for: ${gap.evidenceFor}`,
        `Evidence against: ${gap.evidenceAgainst}`,
        `Ideas: ${gap.implementationIdeas.join("; ")}`,
      ].join("\n"),
    )
    .join("\n\n");
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
