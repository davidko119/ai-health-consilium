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
  evidenceFor: string;
  evidenceAgainst: string;
  priorityScore?: number;
  implementationIdeas: string[];
  linkedReferenceIds?: string[];
}

export interface GapScore {
  title: string;
  priorityScore: number;
  evidenceScarcity: number;
  potentialImpact: number;
  feasibility: number;
  novelty: number;
  justification: string;
}

export interface ReferenceClusterTag {
  sourceId: string;
  tags: string[];
  cluster: string;
}
