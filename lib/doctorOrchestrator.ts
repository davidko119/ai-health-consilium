export type ProviderModelKey = "claude" | "gpt" | "gemini" | "grok";

export interface DoctorCaseInput {
  id?: string;
  userQuestion: string;
  patientContext?: string;
  language?: string;
}

export interface SingleModelOpinion {
  provider: ProviderModelKey;
  modelId: string;
  analysis: string;
  gaps: string;
  critique?: string;
}

export interface DoctorAnswer {
  finalAnswer: string;
  modelOpinions: SingleModelOpinion[];
  safetyDisclaimer: string;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface OpenRouterChatOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  apiKey?: string;
  referer?: string;
  title?: string;
}

export interface DoctorConsiliumLogger {
  info?: (message: string, metadata?: Record<string, unknown>) => void;
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
  error?: (message: string, metadata?: Record<string, unknown>) => void;
}

export interface DoctorConsiliumOptions {
  modelOverrides?: Partial<Record<ProviderModelKey, string>>;
  providers?: ProviderModelKey[];
  judgeModelId?: string;
  temperature?: number;
  analysisMaxTokens?: number;
  critiqueMaxTokens?: number;
  judgeMaxTokens?: number;
  timeoutMs?: number;
  logger?: DoctorConsiliumLogger;
  apiKey?: string;
}

export const MODELS: Record<ProviderModelKey, string> = {
  claude: "anthropic/claude-3.7-sonnet",
  gpt: "openai/gpt-4.1-mini",
  gemini: "google/gemini-2.5-pro",
  grok: "xai/grok-2-latest",
};

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 90000;
const DEFAULT_TEMPERATURE = 0.25;
const DEFAULT_ANALYSIS_MAX_TOKENS = 1400;
const DEFAULT_CRITIQUE_MAX_TOKENS = 1100;
const DEFAULT_JUDGE_MAX_TOKENS = 2200;

const SAFETY_DISCLAIMER =
  "This is not medical advice and is for research and education support only. It must not be used to diagnose, treat, prevent, or manage any health condition. Real clinical decisions must be made by qualified human physicians who can examine the patient, review the complete medical record, and apply local standards of care.";

const MEDICAL_RESEARCH_SYSTEM_PROMPT = [
  "You are a cautious medical research assistant, NOT a treating physician.",
  "You analyse research questions and clinical-style cases ONLY for educational and research support.",
  "You never give direct diagnostic or treatment instructions.",
  "You always mention that a real doctor must make clinical decisions.",
  "",
  "Focus on:",
  "- evidence from studies,",
  "- mechanisms and hypotheses,",
  "- research gaps and uncertainties.",
].join("\n");

const JUDGE_SYSTEM_PROMPT = [
  "You are the orchestrating virtual physician for a research support tool.",
  "You have opinions from multiple AI models from different providers that analysed the SAME research question.",
  "Your job is to synthesise their insights into ONE careful, conservative, research-oriented answer, not medical advice.",
].join("\n");

export async function callOpenRouterChat(
  modelId: string,
  messages: ChatMessage[],
  options: OpenRouterChatOptions = {},
): Promise<string> {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  const body = {
    model: modelId,
    messages,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
  };

  const headers: HeadersInit = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  if (options.referer) {
    headers["HTTP-Referer"] = options.referer;
  }
  if (options.title) {
    headers["X-OpenRouter-Title"] = options.title;
  }

  const response = await withTimeout(
    (signal) =>
      fetch(OPENROUTER_CHAT_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      }),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    `OpenRouter ${modelId}`,
  );

  const text = await response.text();
  const parsed = parseJsonRecord(text);

  if (!response.ok) {
    const detail = parsed ? JSON.stringify(parsed) : text;
    throw new Error(`OpenRouter ${modelId} failed (${response.status}): ${detail.slice(0, 700)}`);
  }

  if (!parsed) {
    throw new Error(`OpenRouter ${modelId} returned a non-JSON response.`);
  }

  const content = parseAssistantContent(parsed);
  if (!content) {
    throw new Error(`OpenRouter ${modelId} returned no assistant message content.`);
  }

  return content;
}

export async function runDoctorConsilium(
  caseInput: DoctorCaseInput,
  options: DoctorConsiliumOptions = {},
): Promise<DoctorAnswer> {
  validateCaseInput(caseInput);

  const logger = options.logger ?? {};
  const models = { ...MODELS, ...options.modelOverrides };
  const providers = options.providers ?? (Object.keys(models) as ProviderModelKey[]);
  const activeProviders = providers.filter((provider) => Boolean(models[provider]));

  logger.info?.("doctor-consilium.analysis.start", {
    caseId: caseInput.id,
    providers: activeProviders,
  });

  const opinions = await runIndependentAnalyses(caseInput, activeProviders, models, options);

  if (opinions.length === 0) {
    logger.error?.("doctor-consilium.analysis.no-models-responded", { caseId: caseInput.id });
    return {
      finalAnswer: [
        "No model provider returned a usable response, so the consilium could not produce a substantive synthesis.",
        "",
        "Safety disclaimer:",
        SAFETY_DISCLAIMER,
      ].join("\n"),
      modelOpinions: [],
      safetyDisclaimer: SAFETY_DISCLAIMER,
    };
  }

  let critiquedOpinions = opinions;
  if (opinions.length > 1) {
    logger.info?.("doctor-consilium.critique.start", {
      caseId: caseInput.id,
      providers: opinions.map((opinion) => opinion.provider),
    });
    critiquedOpinions = await runCrossCritiques(caseInput, opinions, models, options);
  } else {
    logger.warn?.("doctor-consilium.critique.skipped-limited-diversity", {
      caseId: caseInput.id,
      provider: opinions[0]?.provider,
    });
    critiquedOpinions = opinions.map((opinion) => ({
      ...opinion,
      critique:
        "Cross-model critique was skipped because only one provider returned a usable response. Consensus is based on limited internal diversity.",
    }));
  }

  const judgeModelId = options.judgeModelId ?? models.claude ?? models.gemini;

  logger.info?.("doctor-consilium.judge.start", {
    caseId: caseInput.id,
    judgeModelId,
    respondingProviders: critiquedOpinions.map((opinion) => opinion.provider),
  });

  const finalAnswer = await runFinalJudge(caseInput, critiquedOpinions, judgeModelId, options);
  const safeFinalAnswer = ensureSafetyDisclaimer(finalAnswer);

  return {
    finalAnswer: safeFinalAnswer,
    modelOpinions: critiquedOpinions,
    safetyDisclaimer: extractSafetyDisclaimer(safeFinalAnswer),
  };
}

async function runIndependentAnalyses(
  caseInput: DoctorCaseInput,
  providers: ProviderModelKey[],
  models: Record<ProviderModelKey, string>,
  options: DoctorConsiliumOptions,
): Promise<SingleModelOpinion[]> {
  const results = await Promise.all(
    providers.map(async (provider): Promise<SingleModelOpinion | null> => {
      const modelId = models[provider];
      try {
        const raw = await callOpenRouterChat(
          modelId,
          [
            { role: "system", content: MEDICAL_RESEARCH_SYSTEM_PROMPT },
            { role: "user", content: buildAnalysisPrompt(caseInput) },
          ],
          {
            apiKey: options.apiKey,
            temperature: options.temperature ?? DEFAULT_TEMPERATURE,
            maxTokens: options.analysisMaxTokens ?? DEFAULT_ANALYSIS_MAX_TOKENS,
            timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            title: "Doctor Consilium",
          },
        );

        const parsed = splitAnalysisAndGaps(raw);
        return {
          provider,
          modelId,
          analysis: parsed.analysis,
          gaps: parsed.gaps,
        };
      } catch (error) {
        options.logger?.error?.("doctor-consilium.analysis.provider-failed", {
          provider,
          modelId,
          error: errorToMessage(error),
        });
        return null;
      }
    }),
  );

  return results.filter((result): result is SingleModelOpinion => result !== null);
}

async function runCrossCritiques(
  caseInput: DoctorCaseInput,
  opinions: SingleModelOpinion[],
  models: Record<ProviderModelKey, string>,
  options: DoctorConsiliumOptions,
): Promise<SingleModelOpinion[]> {
  const opinionSummary = formatOpinionsForCritique(opinions);
  const critiqueResults = await Promise.all(
    opinions.map(async (opinion): Promise<SingleModelOpinion> => {
      const otherOpinions = opinions.filter((candidate) => candidate.provider !== opinion.provider);
      if (otherOpinions.length === 0) {
        return opinion;
      }

      try {
        const critique = await callOpenRouterChat(
          opinion.modelId,
          [
            { role: "system", content: MEDICAL_RESEARCH_SYSTEM_PROMPT },
            {
              role: "user",
              content: buildCritiquePrompt(caseInput, opinion.provider, opinionSummary),
            },
          ],
          {
            apiKey: options.apiKey,
            temperature: options.temperature ?? DEFAULT_TEMPERATURE,
            maxTokens: options.critiqueMaxTokens ?? DEFAULT_CRITIQUE_MAX_TOKENS,
            timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            title: "Doctor Consilium",
          },
        );

        return { ...opinion, critique };
      } catch (error) {
        options.logger?.error?.("doctor-consilium.critique.provider-failed", {
          provider: opinion.provider,
          modelId: models[opinion.provider],
          error: errorToMessage(error),
        });
        return {
          ...opinion,
          critique: `Critique unavailable because ${opinion.provider} failed during the critique phase.`,
        };
      }
    }),
  );

  return critiqueResults;
}

async function runFinalJudge(
  caseInput: DoctorCaseInput,
  opinions: SingleModelOpinion[],
  judgeModelId: string,
  options: DoctorConsiliumOptions,
): Promise<string> {
  try {
    return await callOpenRouterChat(
      judgeModelId,
      [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        { role: "user", content: buildJudgePrompt(caseInput, opinions) },
      ],
      {
        apiKey: options.apiKey,
        temperature: options.temperature ?? 0.18,
        maxTokens: options.judgeMaxTokens ?? DEFAULT_JUDGE_MAX_TOKENS,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        title: "Doctor Consilium",
      },
    );
  } catch (error) {
    options.logger?.error?.("doctor-consilium.judge.failed", {
      judgeModelId,
      error: errorToMessage(error),
    });
    return buildFallbackFinalAnswer(opinions);
  }
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildAnalysisPrompt(caseInput: DoctorCaseInput): string {
  return [
    `USER CASE (may be in any language):`,
    caseInput.userQuestion,
    "",
    "OPTIONAL CONTEXT:",
    caseInput.patientContext?.trim() || "None provided.",
    "",
    `TARGET LANGUAGE: ${caseInput.language?.trim() || "Use the user's language when practical."}`,
    "",
    "TASK:",
    "1) Provide a structured analysis of what is reasonably known.",
    "2) List potential RESEARCH GAPS: what is under-studied, unclear, or inconsistent.",
    "3) Do NOT give treatment instructions. Do NOT say what the user should personally do.",
    "4) Remain in the research/education domain.",
    "",
    "Return exactly these two headings:",
    "ANALYSIS",
    "RESEARCH GAPS",
  ].join("\n");
}

function buildCritiquePrompt(
  caseInput: DoctorCaseInput,
  provider: ProviderModelKey,
  opinionSummary: string,
): string {
  return [
    "Here are structured opinions from multiple AI models from different providers analysing the SAME medical research question.",
    "For each model, you see their analysis of what is known and their proposed research gaps.",
    "",
    `You are the ${provider} model in this critique round.`,
    "",
    "USER CASE:",
    caseInput.userQuestion,
    "",
    "MODEL OPINIONS:",
    opinionSummary,
    "",
    "Your job:",
    "- Identify where other models may be wrong, overconfident, incomplete, or missing important evidence.",
    "- Explicitly list critical comments about their reasoning.",
    "- Highlight any gaps that are especially plausible or implausible, and why.",
    "- Do NOT produce your own new standalone answer.",
    "- Only produce critical commentary about the OTHER models' reasoning.",
  ].join("\n");
}

function buildJudgePrompt(caseInput: DoctorCaseInput, opinions: SingleModelOpinion[]): string {
  const limitedDiversityNotice =
    opinions.length <= 1
      ? "Only one model provider returned a usable answer. Explicitly state that consensus is based on limited internal diversity."
      : "Multiple model providers returned usable answers. Compare consensus and disagreement.";

  return [
    "Here are the model opinions including analysis, gaps, and mutual critiques:",
    JSON.stringify(opinions, null, 2),
    "",
    "ORIGINAL USER CASE:",
    caseInput.userQuestion,
    "",
    "OPTIONAL CONTEXT:",
    caseInput.patientContext?.trim() || "None provided.",
    "",
    `TARGET LANGUAGE: ${caseInput.language?.trim() || "Use the user's language when practical."}`,
    limitedDiversityNotice,
    "",
    "TASK:",
    "1) Identify where there is strong consensus.",
    "2) Identify where the models disagree or where evidence is weak.",
    "3) Produce ONE final answer with this structure:",
    '   - "What seems reasonably well supported" (bullet points)',
    '   - "Key research gaps and uncertainties" (bullet points)',
    '   - "How a researcher could investigate these gaps" (study design ideas)',
    '   - "Explicit limitations" (why this might still be wrong)',
    '   - "Safety disclaimer" (clear statement that this is NOT medical advice and real clinical decisions must be made by human physicians).',
    "4) Your tone must be cautious, research-focused, and honest about uncertainty.",
  ].join("\n");
}

function splitAnalysisAndGaps(text: string): { analysis: string; gaps: string } {
  const normalized = text.trim();
  const gapHeading = normalized.search(/^#{0,4}\s*(research\s+gaps|gaps|key\s+research\s+gaps)\b.*$/im);

  if (gapHeading === -1) {
    return {
      analysis: stripKnownHeading(normalized, "analysis"),
      gaps: "No explicit research-gaps section was returned. Review the analysis text for implicit uncertainties.",
    };
  }

  const analysisPart = normalized.slice(0, gapHeading).trim();
  const gapsPart = normalized.slice(gapHeading).trim();

  return {
    analysis: stripKnownHeading(analysisPart || normalized, "analysis"),
    gaps: stripKnownHeading(gapsPart, "research gaps"),
  };
}

function stripKnownHeading(text: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`^#{0,4}\\s*${escaped}\\s*:?\\s*`, "i"), "").trim();
}

function formatOpinionsForCritique(opinions: SingleModelOpinion[]): string {
  return opinions
    .map((opinion) =>
      [
        `PROVIDER: ${opinion.provider}`,
        `MODEL: ${opinion.modelId}`,
        "ANALYSIS:",
        truncate(opinion.analysis, 3000),
        "",
        "RESEARCH GAPS:",
        truncate(opinion.gaps, 2200),
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}

function buildFallbackFinalAnswer(opinions: SingleModelOpinion[]): string {
  return [
    "## What seems reasonably well supported",
    ...opinions.map((opinion) => `- ${opinion.provider}: ${truncate(oneLine(opinion.analysis), 500)}`),
    "",
    "## Key research gaps and uncertainties",
    ...opinions.map((opinion) => `- ${opinion.provider}: ${truncate(oneLine(opinion.gaps), 500)}`),
    "",
    "## How a researcher could investigate these gaps",
    "- Use a structured literature review with explicit inclusion and exclusion criteria.",
    "- Separate clinical, mechanistic, and methodological evidence before ranking hypotheses.",
    "- Prefer prospective, pre-registered study designs when moving from hypothesis generation to testing.",
    "",
    "## Explicit limitations",
    "- The final judge model failed, so this fallback synthesis is a simple aggregation rather than a full adjudication.",
    "- The answer depends on model outputs and does not verify facts against a live medical database.",
    "- Internal consensus may be limited if one or more providers failed.",
    "",
    "## Safety disclaimer",
    SAFETY_DISCLAIMER,
  ].join("\n");
}

function ensureSafetyDisclaimer(finalAnswer: string): string {
  const lower = finalAnswer.toLowerCase();
  const hasDisclaimer =
    lower.includes("not medical advice") &&
    (lower.includes("physician") || lower.includes("doctor") || lower.includes("clinician"));

  if (hasDisclaimer) {
    return finalAnswer.trim();
  }

  return [finalAnswer.trim(), "", "## Safety disclaimer", SAFETY_DISCLAIMER].join("\n");
}

function extractSafetyDisclaimer(finalAnswer: string): string {
  const disclaimerHeading = finalAnswer.search(/^#{0,4}\s*safety\s+disclaimer\b.*$/im);
  if (disclaimerHeading === -1) {
    return SAFETY_DISCLAIMER;
  }

  const section = finalAnswer.slice(disclaimerHeading).trim();
  const nextHeading = section.slice(1).search(/\n#{1,4}\s+\S/);
  const disclaimerSection = nextHeading === -1 ? section : section.slice(0, nextHeading + 1);
  return disclaimerSection
    .replace(/^#{0,4}\s*safety\s+disclaimer\s*:?/i, "")
    .trim()
    .replace(/\s+/g, " ");
}

function parseAssistantContent(raw: Record<string, unknown>): string {
  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const firstChoice = choices.find(isRecord);
  const message = firstChoice && isRecord(firstChoice.message) ? firstChoice.message : null;
  const content = message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateCaseInput(caseInput: DoctorCaseInput): void {
  if (!caseInput.userQuestion || caseInput.userQuestion.trim().length < 8) {
    throw new Error("DoctorCaseInput.userQuestion must contain a substantive question or case.");
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
