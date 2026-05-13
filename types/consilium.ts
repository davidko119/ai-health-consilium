export type ProblemStatus = "draft" | "running" | "completed" | "failed";

export type WorkflowStage =
  | "draft"
  | "clarification"
  | "literature"
  | "debate"
  | "ranking"
  | "report"
  | "completed"
  | "failed";

export type AgentMessageRole = "system" | "user" | "assistant" | "agent";

export type AgentStepType =
  | "clarification"
  | "proposal"
  | "critique"
  | "summary"
  | "gapCandidate"
  | "ranking"
  | "finalReport"
  | "system"
  | "error";

export type SourceType = "pubmed" | "web" | "other";

export type ChatRole = "system" | "user" | "assistant";

export const GAP_TYPES = [
  "mechanism",
  "intervention",
  "comparator",
  "population_subgroup",
  "biomarker_measurement",
  "study_design_methodology",
  "translational",
  "safety_feasibility",
  "long_term_outcome",
] as const;

export type GapType = (typeof GAP_TYPES)[number];

export const EVIDENCE_LEVELS = [
  "direct_human_cp_adolescents",
  "human_cp_broader_age",
  "indirect_human_other_neurological",
  "preclinical_animal",
  "mechanistic_speculation",
] as const;

export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const UNCERTAINTY_LEVELS = ["low", "moderate", "high", "very_high"] as const;

export type UncertaintyLevel = (typeof UNCERTAINTY_LEVELS)[number];

export type PicoFieldStatus = "explicit" | "inferred" | "unclear";

export interface PicoField {
  value: string;
  status: PicoFieldStatus;
  rationale?: string;
}

export interface PicoExtraction {
  population: PicoField;
  intervention: PicoField;
  comparator: PicoField;
  outcomes: PicoField;
  context: PicoField;
  mechanisticHypothesis: PicoField;
  ambiguousTerms: string[];
}

export interface EvidenceMap {
  directlySupported: string[];
  indirectlySupported: string[];
  preclinicalOnly: string[];
  speculative: string[];
  caveats: string[];
}

export interface ReferenceEvidenceProfile {
  populationTags: string[];
  interventionTypes: string[];
  evidenceType: string;
  outcomeTypes: string[];
  species: "human" | "animal" | "mixed" | "unclear";
  ageRelevance: "adolescent_specific" | "pediatric" | "adult" | "mixed_or_unclear";
  evidenceLevel: EvidenceLevel;
}

export interface StructuredStudyProposal {
  objective: string;
  population: string;
  interventionOrExposure: string;
  comparator: string;
  primaryOutcomes: string[];
  secondaryOutcomes: string[];
  biomarkers: string[];
  studyDesign: string;
  feasibilityNotes: string;
  whyThisDesignAddressesGap: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface AgentTemplate {
  name: string;
  roleDescription: string;
  specializationTags: string[];
  model: string;
  temperature: number;
}

export interface WorkflowDefaults {
  maxDebateRounds: number;
  maxReferencesPerQuery: number;
  maxPubMedQueries: number;
  maxWebQueries: number;
  maxReferencesInPrompt: number;
  recentMessageWindow: number;
  perProblemMaxLlmCalls: number;
  perProblemMaxTokens: number;
}

export interface LLMUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costEstimate: number | null;
  providerMetadata?: Record<string, unknown>;
}

export interface LLMResult {
  content: string;
  usage: LLMUsage;
  raw: Record<string, unknown>;
}

export interface PubMedReference {
  pmid: string;
  title: string;
  abstract?: string;
  authors: string[];
  journal?: string;
  year?: number;
  url: string;
  rawMetadata: Record<string, unknown>;
}

export interface WebReference {
  sourceId?: string;
  title: string;
  url?: string;
  snippet?: string;
  fullText?: string;
  rawMetadata: Record<string, unknown>;
}

export interface SearchPlan {
  pubmedQueries: string[];
  webQueries: string[];
  rationale: string;
}

export interface GapProposal {
  title: string;
  description: string;
  primaryGapType?: GapType;
  secondaryGapType?: GapType;
  whyTrueGap?: string;
  whatKnown?: string;
  whatMissing?: string;
  evidenceLevel?: EvidenceLevel;
  uncertaintyLevel?: UncertaintyLevel;
  evidenceFor: string;
  evidenceAgainst: string;
  priorityScore?: number;
  novelty?: number;
  evidenceScarcity?: number;
  actionability?: number;
  clinicalRelevance?: number;
  mechanisticImportance?: number;
  feasibility?: number;
  distinctiveness?: number;
  studyProposal?: StructuredStudyProposal;
  implementationIdeas: string[];
  linkedReferenceIds?: string[];
}

export interface GapScore {
  title: string;
  priorityScore: number;
  primaryGapType?: GapType;
  secondaryGapType?: GapType;
  evidenceLevel?: EvidenceLevel;
  uncertaintyLevel?: UncertaintyLevel;
  evidenceScarcity: number;
  actionability: number;
  clinicalRelevance: number;
  mechanisticImportance: number;
  feasibility: number;
  novelty: number;
  distinctiveness: number;
  potentialImpact?: number;
  justification: string;
}

export interface ReferenceClusterTag {
  sourceId: string;
  tags: string[];
  cluster: string;
  evidenceProfile?: ReferenceEvidenceProfile;
}
