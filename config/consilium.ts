import type { AgentTemplate, WorkflowDefaults, WorkflowStage } from "../types/consilium";

export const MODEL_CONFIG = {
  defaultModel: "openai/gpt-4o-mini",
  evaluatorModel: "openai/gpt-4o-mini",
  temperature: 0.35,
  highPrecisionTemperature: 0.15,
  maxTokens: 1600,
} as const;

export const WORKFLOW_DEFAULTS: WorkflowDefaults = {
  maxDebateRounds: 2,
  maxReferencesPerQuery: 6,
  maxPubMedQueries: 4,
  maxWebQueries: 2,
  maxReferencesInPrompt: 12,
  recentMessageWindow: 10,
  perProblemMaxLlmCalls: 20,
  perProblemMaxTokens: 85000,
};

export const WORKFLOW_STAGES: { key: WorkflowStage; label: string }[] = [
  { key: "clarification", label: "Clarification" },
  { key: "literature", label: "Literature" },
  { key: "debate", label: "Debate" },
  { key: "ranking", label: "Ranking" },
  { key: "report", label: "Report" },
];

export const DEFAULT_AGENT_TEMPLATES: AgentTemplate[] = [
  {
    name: "Clinical Expert",
    specializationTags: ["patient outcomes", "safety", "clinical relevance"],
    model: MODEL_CONFIG.defaultModel,
    temperature: 0.32,
    roleDescription:
      "You are a clinical scientist. Focus on patient-important outcomes, inclusion criteria, adverse events, translational plausibility, and whether a gap would change clinical practice.",
  },
  {
    name: "Molecular Mechanist",
    specializationTags: ["mechanisms", "pathways", "biomarkers"],
    model: MODEL_CONFIG.defaultModel,
    temperature: 0.38,
    roleDescription:
      "You are a molecular and mechanistic biomedical researcher. Focus on biological pathways, preclinical evidence, biomarkers, mechanisms of action, and whether causal links are plausible.",
  },
  {
    name: "Biostatistician",
    specializationTags: ["study design", "bias", "power", "statistics"],
    model: MODEL_CONFIG.defaultModel,
    temperature: 0.22,
    roleDescription:
      "You are a biostatistician and trial methodologist. Focus on study design, confounding, statistical power, endpoints, bias, reproducibility, and whether proposed hypotheses are testable.",
  },
  {
    name: "Meta-Researcher",
    specializationTags: ["evidence synthesis", "publication bias", "reviews"],
    model: MODEL_CONFIG.defaultModel,
    temperature: 0.3,
    roleDescription:
      "You are a meta-researcher. Focus on systematic reviews, meta-analysis signals, publication bias, heterogeneity, missing populations, and gaps caused by weak evidence synthesis.",
  },
  {
    name: "Gap Seeker",
    specializationTags: ["research gaps", "novelty", "hypotheses"],
    model: MODEL_CONFIG.defaultModel,
    temperature: 0.42,
    roleDescription:
      "You are an expert at finding under-studied combinations, contradictions, negative space in the literature, and concrete testable hypotheses. Be skeptical about novelty claims.",
  },
];

export const SYSTEM_GUARDRAILS = [
  "This application supports biomedical research ideation and evidence mapping. It is not medical advice.",
  "Prefer precise uncertainty over overclaiming.",
  "Cite references by PMID or URL when using them.",
  "Separate what is known, unknown, weakly supported, and speculative.",
  "Avoid inventing papers, statistics, guidelines, or citations.",
].join("\n");

export const ROLE_PROMPTS = {
  analyst:
    "Internal role: Analyst. Summarize what the retrieved evidence directly supports, what it only indirectly suggests, and which claims are not supported. Keep intervention, population, comparator, and outcome boundaries explicit.",
  gapFinder:
    "Internal role: Gap Finder. Propose diverse, testable research gaps. Avoid near-duplicates and avoid vague gaps that merely say mechanisms are unclear. Each gap must have one primary gap type and a structured study proposal.",
  skeptic:
    "Internal role: Skeptic / Critic. Attack redundancy, unsupported extrapolation from animal or indirect studies, vague interventions, missing comparators, weak outcomes, and duplicated mechanism framing.",
  evidenceGrader:
    "Internal role: Evidence Grader. Classify directness and uncertainty. Explicitly label direct human CP adolescent evidence, broader CP evidence, indirect neurological evidence, preclinical evidence, and speculation.",
  finalJudge:
    "Internal role: Final Judge. Synthesize the debate into one conservative report with diverse, non-redundant top gaps and exact PICO/evidence-level structure.",
} as const;

export const DOMAIN_SPECIAL_RULES = [
  "For BDNF-related cerebral palsy questions, never treat 'BDNF modulation' as a single intervention.",
  "Separate rehabilitation-induced endogenous BDNF change, non-invasive brain stimulation effects, pharmacologic modulation, nutritional modulation, stem-cell/regenerative approaches, genetic moderators such as Val66Met, and biomarker association versus causal intervention.",
  "Do not imply clinical efficacy when evidence is associative, indirect, mechanistic, or preclinical.",
  "Explicitly call out when adolescent-specific cerebral palsy evidence is missing.",
].join("\n");

export const REPORT_STRUCTURE = [
  "## Reformulated Clinical/Research Question",
  "## PICO Extraction",
  "## Evidence Map",
  "## Top Research Gaps",
  "## Ranked Study Proposals",
  "## Limitations",
  "## Final Answer",
].join("\n");
