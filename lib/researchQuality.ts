import {
  EVIDENCE_LEVELS,
  GAP_TYPES,
  type EvidenceLevel,
  type GapType,
  type UncertaintyLevel,
} from "../types/consilium";

export const GAP_TYPE_LABELS: Record<GapType, string> = {
  mechanism: "Mechanism",
  intervention: "Intervention",
  comparator: "Comparator",
  population_subgroup: "Population / subgroup",
  biomarker_measurement: "Biomarker / measurement",
  study_design_methodology: "Study design / methodology",
  translational: "Translational",
  safety_feasibility: "Safety / feasibility",
  long_term_outcome: "Long-term outcome",
};

export const EVIDENCE_LEVEL_LABELS: Record<EvidenceLevel, string> = {
  direct_human_cp_adolescents: "Direct human evidence in cerebral palsy adolescents",
  human_cp_broader_age: "Human evidence in CP, broader age range",
  indirect_human_other_neurological: "Indirect human evidence from other neurological populations",
  preclinical_animal: "Preclinical / animal evidence",
  mechanistic_speculation: "Mechanistic speculation only",
};

export interface GapQualityInput {
  id: string;
  title: string;
  description: string;
  primaryGapType?: GapType;
  secondaryGapType?: GapType;
  evidenceLevel?: EvidenceLevel;
  uncertaintyLevel?: UncertaintyLevel;
  novelty?: number;
  evidenceScarcity?: number;
  actionability?: number;
  clinicalRelevance?: number;
  mechanisticImportance?: number;
  feasibility?: number;
  distinctiveness?: number;
  priorityScore?: number;
}

export interface DiversifiedGapScore {
  id: string;
  priorityScore: number;
  primaryGapType: GapType;
  secondaryGapType?: GapType;
  evidenceLevel: EvidenceLevel;
  uncertaintyLevel: UncertaintyLevel;
  novelty: number;
  evidenceScarcity: number;
  actionability: number;
  clinicalRelevance: number;
  mechanisticImportance: number;
  feasibility: number;
  distinctiveness: number;
  diversityRationale: string;
}

const VAGUE_TERMS = [
  "bdnf modulation",
  "mechanisms are unclear",
  "further research",
  "more studies",
  "longitudinal studies",
  "animal models",
  "unclear mechanism",
];

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "also",
  "among",
  "and",
  "are",
  "because",
  "between",
  "both",
  "but",
  "can",
  "could",
  "from",
  "has",
  "have",
  "into",
  "more",
  "only",
  "other",
  "over",
  "such",
  "than",
  "that",
  "the",
  "their",
  "these",
  "this",
  "through",
  "under",
  "what",
  "when",
  "where",
  "which",
  "with",
  "without",
]);

export function normalizeGapType(value: unknown, fallbackText = ""): GapType {
  if (typeof value === "string") {
    const normalized = value.toLowerCase().replace(/[^a-z]+/g, "_");
    const direct = GAP_TYPES.find((type) => type === normalized);
    if (direct) {
      return direct;
    }
    if (normalized.includes("population") || normalized.includes("subgroup")) {
      return "population_subgroup";
    }
    if (normalized.includes("biomarker") || normalized.includes("measurement") || normalized.includes("endpoint")) {
      return "biomarker_measurement";
    }
    if (normalized.includes("design") || normalized.includes("method")) {
      return "study_design_methodology";
    }
    if (normalized.includes("safety") || normalized.includes("feasibility")) {
      return "safety_feasibility";
    }
    if (normalized.includes("long")) {
      return "long_term_outcome";
    }
  }
  return inferGapType(fallbackText);
}

export function normalizeEvidenceLevel(value: unknown, fallbackText = ""): EvidenceLevel {
  if (typeof value === "string") {
    const normalized = value.toLowerCase().replace(/[^a-z]+/g, "_");
    const direct = EVIDENCE_LEVELS.find((level) => level === normalized);
    if (direct) {
      return direct;
    }
    if (normalized.includes("adolescent") && normalized.includes("cp")) {
      return "direct_human_cp_adolescents";
    }
    if (normalized.includes("human") && normalized.includes("cp")) {
      return "human_cp_broader_age";
    }
    if (normalized.includes("indirect") || normalized.includes("neurological")) {
      return "indirect_human_other_neurological";
    }
    if (normalized.includes("animal") || normalized.includes("preclinical")) {
      return "preclinical_animal";
    }
  }
  const text = fallbackText.toLowerCase();
  if (text.includes("adolescent") && text.includes("cerebral palsy")) {
    return "direct_human_cp_adolescents";
  }
  if (text.includes("cerebral palsy") && text.includes("human")) {
    return "human_cp_broader_age";
  }
  if (text.includes("animal") || text.includes("preclinical") || text.includes("rodent")) {
    return "preclinical_animal";
  }
  if (text.includes("stroke") || text.includes("parkinson") || text.includes("neurological")) {
    return "indirect_human_other_neurological";
  }
  return "mechanistic_speculation";
}

export function normalizeUncertainty(value: unknown, fallbackScore?: number): UncertaintyLevel {
  if (value === "low" || value === "moderate" || value === "high" || value === "very_high") {
    return value;
  }
  const score = fallbackScore ?? 50;
  if (score >= 78) {
    return "moderate";
  }
  if (score >= 58) {
    return "high";
  }
  return "very_high";
}

export function lexicalSimilarity(left: string, right: string): number {
  const leftTerms = tokenize(left);
  const rightTerms = tokenize(right);
  if (leftTerms.length === 0 || rightTerms.length === 0) {
    return 0;
  }
  const leftSet = new Set(leftTerms);
  const rightSet = new Set(rightTerms);
  const intersection = [...leftSet].filter((term) => rightSet.has(term)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  const containment = intersection / Math.min(leftSet.size, rightSet.size);
  const jaccard = intersection / union;
  return Math.max(jaccard, containment * 0.86);
}

export function diversifyGapRankings(gaps: GapQualityInput[]): DiversifiedGapScore[] {
  const normalized = gaps.map((gap) => {
    const text = `${gap.title} ${gap.description}`;
    const novelty = clampScore(gap.novelty ?? 62);
    const evidenceScarcity = clampScore(gap.evidenceScarcity ?? 68);
    const actionability = clampScore(gap.actionability ?? scoreActionability(text));
    const clinicalRelevance = clampScore(gap.clinicalRelevance ?? scoreClinicalRelevance(text));
    const mechanisticImportance = clampScore(gap.mechanisticImportance ?? scoreMechanisticImportance(text));
    const feasibility = clampScore(gap.feasibility ?? scoreFeasibility(text));
    const primaryGapType = normalizeGapType(gap.primaryGapType, text);
    const secondaryGapType = gap.secondaryGapType
      ? normalizeGapType(gap.secondaryGapType, text)
      : undefined;
    const evidenceLevel = normalizeEvidenceLevel(gap.evidenceLevel, text);
    const uncertaintyLevel = normalizeUncertainty(gap.uncertaintyLevel, gap.priorityScore);
    return {
      ...gap,
      primaryGapType,
      secondaryGapType: secondaryGapType === primaryGapType ? undefined : secondaryGapType,
      evidenceLevel,
      uncertaintyLevel,
      novelty,
      evidenceScarcity,
      actionability,
      clinicalRelevance,
      mechanisticImportance,
      feasibility,
      distinctiveness: clampScore(gap.distinctiveness ?? 76),
      duplicateOf: undefined as string | undefined,
      similarityPenalty: 0,
      diversityRationale: "Distinct enough to rank independently.",
    };
  });

  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex += 1) {
      const left = normalized[leftIndex];
      const right = normalized[rightIndex];
      const similarity = lexicalSimilarity(
        `${left.title} ${left.description}`,
        `${right.title} ${right.description}`,
      );
      if (similarity < 0.8 || left.primaryGapType !== right.primaryGapType) {
        continue;
      }
      const leftBase = computeWeightedScore(left);
      const rightBase = computeWeightedScore(right);
      const loser = leftBase >= rightBase ? right : left;
      const winner = leftBase >= rightBase ? left : right;
      loser.duplicateOf = winner.title;
      loser.similarityPenalty = Math.max(loser.similarityPenalty, 30);
      loser.distinctiveness = Math.min(loser.distinctiveness, 38);
      loser.diversityRationale = `Deprioritized as near-duplicate of "${winner.title}" within ${GAP_TYPE_LABELS[loser.primaryGapType]}.`;
    }
  }

  const ranked = [...normalized].sort((left, right) => {
    return computeWeightedScore(right) - computeWeightedScore(left);
  });
  const topByType = new Set<GapType>();
  const topIds = new Set<string>();

  for (const gap of ranked) {
    if (topIds.size >= 5) {
      break;
    }
    if (!gap.duplicateOf && !topByType.has(gap.primaryGapType)) {
      topByType.add(gap.primaryGapType);
      topIds.add(gap.id);
    }
  }
  for (const gap of ranked) {
    if (topIds.size >= 5) {
      break;
    }
    if (!gap.duplicateOf) {
      topIds.add(gap.id);
    }
  }

  return normalized
    .map((gap) => {
      const vaguePenalty = scoreVaguenessPenalty(`${gap.title} ${gap.description}`);
      const evidencePenalty = evidenceDirectnessPenalty(gap.evidenceLevel);
      const selectedBonus = topIds.has(gap.id) ? 6 : 0;
      const repeatedTypePenalty = topIds.has(gap.id) ? 0 : countHigherTypePeers(ranked, gap) * 7;
      const priorityScore = clampScore(
        computeWeightedScore(gap) -
          gap.similarityPenalty -
          vaguePenalty -
          evidencePenalty -
          repeatedTypePenalty +
          selectedBonus,
      );

      return {
        id: gap.id,
        priorityScore,
        primaryGapType: gap.primaryGapType,
        secondaryGapType: gap.secondaryGapType,
        evidenceLevel: gap.evidenceLevel,
        uncertaintyLevel: gap.uncertaintyLevel,
        novelty: gap.novelty,
        evidenceScarcity: gap.evidenceScarcity,
        actionability: gap.actionability,
        clinicalRelevance: gap.clinicalRelevance,
        mechanisticImportance: gap.mechanisticImportance,
        feasibility: gap.feasibility,
        distinctiveness: gap.distinctiveness,
        diversityRationale: gap.diversityRationale,
      };
    })
    .sort((left, right) => right.priorityScore - left.priorityScore);
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 1) {
    return Math.round(Math.max(0, Math.min(1, value)) * 100);
  }
  return Math.round(Math.max(0, Math.min(100, value)));
}

function inferGapType(text: string): GapType {
  const value = text.toLowerCase();
  if (value.includes("comparator") || value.includes("control group") || value.includes("usual care")) {
    return "comparator";
  }
  if (value.includes("adolescent") || value.includes("subgroup") || value.includes("phenotype")) {
    return "population_subgroup";
  }
  if (
    value.includes("biomarker") ||
    value.includes("bdnf level") ||
    value.includes("endpoint") ||
    value.includes("measure")
  ) {
    return "biomarker_measurement";
  }
  if (value.includes("trial") || value.includes("design") || value.includes("power") || value.includes("bias")) {
    return "study_design_methodology";
  }
  if (value.includes("safety") || value.includes("feasibility") || value.includes("adherence")) {
    return "safety_feasibility";
  }
  if (value.includes("long-term") || value.includes("long term") || value.includes("durability")) {
    return "long_term_outcome";
  }
  if (value.includes("intervention") || value.includes("stimulation") || value.includes("rehabilitation")) {
    return "intervention";
  }
  if (value.includes("translate") || value.includes("translational") || value.includes("animal to human")) {
    return "translational";
  }
  return "mechanism";
}

function computeWeightedScore(gap: {
  novelty: number;
  evidenceScarcity: number;
  actionability: number;
  clinicalRelevance: number;
  mechanisticImportance: number;
  feasibility: number;
  distinctiveness: number;
}) {
  return (
    gap.novelty * 0.13 +
    gap.evidenceScarcity * 0.15 +
    gap.actionability * 0.18 +
    gap.clinicalRelevance * 0.17 +
    gap.mechanisticImportance * 0.1 +
    gap.feasibility * 0.12 +
    gap.distinctiveness * 0.15
  );
}

function countHigherTypePeers(
  ranked: Array<GapQualityInput & { primaryGapType: GapType }>,
  gap: GapQualityInput & { primaryGapType: GapType },
) {
  const index = ranked.findIndex((candidate) => candidate.id === gap.id);
  if (index <= 0) {
    return 0;
  }
  return ranked.slice(0, index).filter((candidate) => candidate.primaryGapType === gap.primaryGapType).length;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term));
}

function scoreVaguenessPenalty(text: string): number {
  const value = text.toLowerCase();
  const termPenalty = VAGUE_TERMS.reduce((total, term) => total + (value.includes(term) ? 6 : 0), 0);
  const missingSpecificsPenalty =
    value.includes("modulation") &&
    !/(rehabilitation|stimulation|pharmacologic|nutrition|genetic|val66met|exercise|stem cell)/i.test(value)
      ? 12
      : 0;
  return Math.min(28, termPenalty + missingSpecificsPenalty);
}

function evidenceDirectnessPenalty(level: EvidenceLevel): number {
  if (level === "direct_human_cp_adolescents") {
    return 0;
  }
  if (level === "human_cp_broader_age") {
    return 3;
  }
  if (level === "indirect_human_other_neurological") {
    return 7;
  }
  if (level === "preclinical_animal") {
    return 10;
  }
  return 14;
}

function scoreActionability(text: string): number {
  const value = text.toLowerCase();
  let score = 56;
  if (/(trial|cohort|protocol|randomized|measure|comparator|outcome|biomarker)/i.test(value)) {
    score += 20;
  }
  if (/(vague|unclear|mechanism only|speculation)/i.test(value)) {
    score -= 12;
  }
  return score;
}

function scoreClinicalRelevance(text: string): number {
  const value = text.toLowerCase();
  let score = 58;
  if (/(motor|function|patient|adolescent|cerebral palsy|safety|quality of life)/i.test(value)) {
    score += 18;
  }
  if (value.includes("animal") && !value.includes("human")) {
    score -= 12;
  }
  return score;
}

function scoreMechanisticImportance(text: string): number {
  let score = 55;
  if (/(bdnf|neuroplasticity|biomarker|pathway|mechanism|val66met|corticospinal)/i.test(text)) {
    score += 20;
  }
  return score;
}

function scoreFeasibility(text: string): number {
  const value = text.toLowerCase();
  let score = 62;
  if (/(randomized|pilot|cohort|registry|rehabilitation|blood|saliva|serum|standardized)/i.test(value)) {
    score += 12;
  }
  if (/(rare|invasive|stem cell|gene therapy|long-term|multi-year)/i.test(value)) {
    score -= 10;
  }
  return score;
}
