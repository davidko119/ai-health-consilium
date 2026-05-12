export {
  DEFAULT_AGENT_TEMPLATES as AGENT_ROLES,
  MODEL_CONFIG,
  WORKFLOW_DEFAULTS,
} from "./consilium";

export const DEFAULT_MODEL = "openai/gpt-4o-mini";
export const DEBATE_ROUNDS = 2;
export const PUBMED_MAX_RESULTS = 6;
export const EXA_SEARCH_ENABLED = true;
export const APIFY_ENABLED = true;

export const BUDGET_CONFIG = {
  maxCallsPerSession: 20,
  maxTokensPerSession: 85000,
  warnAtPercent: 80,
};
