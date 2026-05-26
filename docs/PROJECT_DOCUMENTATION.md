# AI Health Consilium - Detailed Project Documentation

This document explains what AI Health Consilium is, why it exists, how it works internally, how to configure it, and how to extend it safely.

## 1. Product Summary

AI Health Consilium is a full-stack TypeScript application for biomedical research-gap discovery. It lets a user submit a health science or biomedical research question and then runs a structured "council" of AI scientist agents.

The agents do not behave like one generic chatbot. They are configured with different roles and responsibilities:

- Clinical Expert
- Molecular Mechanist
- Biostatistician
- Meta-Researcher
- Gap Seeker

The system retrieves literature, maps evidence, proposes candidate gaps, critiques those gaps, ranks them, and produces a final report.

The application is designed for early research planning:

- thesis topic refinement
- grant ideation
- protocol brainstorming
- evidence-map preparation
- identifying unclear or under-studied biomedical questions
- turning broad scientific curiosity into testable study proposals

It is not designed for direct patient care.

## 2. Safety Boundary

AI Health Consilium is a research and education tool.

It must not be used as:

- a diagnostic tool
- a treatment recommendation system
- a triage tool
- a replacement for medical consultation
- a device for managing real patient care

Every generated answer should be interpreted as a hypothesis-generating research artifact. Users must verify claims against primary literature, guidelines, clinical experts, and local regulatory requirements.

The system tries to reduce unsafe output by:

- using research-focused system prompts
- requiring explicit uncertainty
- separating direct, indirect, preclinical, and speculative evidence
- avoiding clinical treatment instructions
- adding safety caveats
- logging limitations in the final report

However, LLM output remains fallible.

## 3. Intended Users

Primary users:

- biomedical researchers
- PhD and master students
- clinicians involved in research
- health science educators
- systematic review teams during topic scoping
- innovation teams exploring translational opportunities

Secondary users:

- grant writers
- research assistants
- data scientists working with biomedical teams
- people learning how to structure research questions

The app assumes the user can critically evaluate scientific output. It is not optimized for layperson medical advice.

## 4. Example Use Case

Input:

```text
Can BDNF modulation improve motor outcomes in adolescent cerebral palsy patients?
```

The system should not treat "BDNF modulation" as a single intervention. It separates it into possible research routes:

- rehabilitation-induced endogenous BDNF change
- non-invasive brain stimulation effects on BDNF
- pharmacologic modulation
- nutritional modulation
- stem-cell or regenerative approaches
- genetic moderators such as BDNF Val66Met
- biomarker association versus causal intervention

The final report should clarify:

- what is known in humans
- what is only indirect from other neurological populations
- what is preclinical or animal-only
- what is mechanistic speculation
- which gaps are distinct and testable
- which study designs could address the gaps

## 5. High-Level Architecture

```text
User browser
  |
  v
Next.js App Router frontend
  |
  v
Convex React client
  |
  v
Convex queries, mutations, and actions
  |
  +--> OpenRouter chat completions
  +--> PubMed E-utilities
  +--> Exa search API
  +--> Apify actor API
  |
  v
Convex database
```

The frontend is intentionally thin. The research workflow runs in Convex actions and persists intermediate state to Convex tables. This lets the UI show progress, messages, references, gap candidates, and final reports reactively.

## 6. Frontend Overview

The frontend uses Next.js App Router, React, TypeScript, and Tailwind CSS.

Main routes:

| Route | Purpose |
| --- | --- |
| `/` | Home dashboard with previous Consilium sessions. |
| `/new` | New Consilium creation form. |
| `/problems/[problemId]` | Main session screen with discussion, references, gaps, and report. |

Important UI concepts:

- Problem list sidebar for navigating sessions.
- Central discussion panel for agent messages.
- Right-side research panel for references and gap candidates.
- Final report renderer with markdown support.
- Progress stage indicator.
- Loading and error states.
- Dark and light theme support.

Important components:

| Component | Role |
| --- | --- |
| `ProblemShell.tsx` | Main layout for the problem detail screen. |
| `AgentMessage.tsx` | Displays agent or system messages. |
| `ReferenceList.tsx` | Displays PubMed and web references. |
| `GapCard.tsx` | Displays structured research gaps and scores. |
| `FinalReport.tsx` | Renders markdown final reports. |
| `ThemeToggle.tsx` | Switches between light and dark themes. |

## 7. Backend Overview

Convex is the primary backend and database. The app uses:

- Convex schema for type-safe collections.
- Queries for reading session state.
- Mutations for creating problems and writing records.
- Internal mutations for workflow writes.
- Internal actions for external API calls and orchestration.

Core backend files:

| File | Purpose |
| --- | --- |
| `convex/schema.ts` | Defines tables, indexes, and validators. |
| `convex/problems.ts` | Public queries/mutations and internal write helpers. |
| `convex/workflow.ts` | Main research pipeline and orchestration. |
| `convex/_generated/api.ts` | Generated Convex API bindings. |
| `convex/_generated/dataModel.ts` | Generated Convex data model types. |

If generated Convex files are missing, run:

```bash
npx convex dev
```

or:

```bash
npx convex codegen
```

## 8. Database Model

### `users`

Stores lightweight anonymous session users.

Fields:

- `sessionId`
- `displayName`
- `createdAt`

Indexes:

- `by_session`

### `problems`

Stores Consilium sessions.

Fields:

- `sessionId`
- `title`
- `description`
- `constraints`
- `status`
- `stage`
- `error`
- `picoExtraction`
- `evidenceMap`
- `createdAt`
- `updatedAt`
- `completedAt`

Indexes:

- `by_session_created`
- `by_session_updated`

### `agents`

Stores instantiated agents for each problem.

Fields:

- `problemId`
- `name`
- `roleDescription`
- `specializationTags`
- `model`
- `temperature`
- `createdAt`

Index:

- `by_problem`

### `agentMessages`

Stores the internal debate, clarification messages, summaries, errors, rankings, and final reports.

Fields:

- `problemId`
- `agentId`
- `speakerName`
- `role`
- `content`
- `stepType`
- `round`
- `metadata`
- `createdAt`

Indexes:

- `by_problem_created`
- `by_agent_created`

### `references`

Stores PubMed papers, web pages, scraped pages, and other evidence records.

Fields:

- `problemId`
- `sourceType`
- `sourceId`
- `title`
- `authors`
- `journal`
- `year`
- `url`
- `abstract`
- `rawMetadata`
- `tags`
- `cluster`
- `evidenceProfile`
- `createdAt`

Indexes:

- `by_problem_created`
- `by_problem_source`

### `gapCandidates`

Stores structured research gaps.

Fields:

- `problemId`
- `agentId`
- `title`
- `description`
- `primaryGapType`
- `secondaryGapType`
- `whyTrueGap`
- `whatKnown`
- `whatMissing`
- `evidenceLevel`
- `uncertaintyLevel`
- `evidenceFor`
- `evidenceAgainst`
- `priorityScore`
- `evidenceScarcity`
- `potentialImpact`
- `actionability`
- `clinicalRelevance`
- `mechanisticImportance`
- `feasibility`
- `novelty`
- `distinctiveness`
- `diversityRationale`
- `studyProposal`
- `mergedFromTitles`
- `implementationIdeas`
- `linkedReferenceIds`
- `createdAt`
- `updatedAt`

Indexes:

- `by_problem_created`
- `by_problem_priority`

### `usageLogs`

Stores OpenRouter usage metadata.

Fields:

- `problemId`
- `agentId`
- `model`
- `inputTokens`
- `outputTokens`
- `totalTokens`
- `costEstimate`
- `providerMetadata`
- `createdAt`

Indexes:

- `by_problem_created`
- `by_agent_created`

## 9. Domain Types

Shared TypeScript types live in `types/consilium.ts`.

Important types:

- `ProblemStatus`
- `WorkflowStage`
- `AgentStepType`
- `SourceType`
- `GapType`
- `EvidenceLevel`
- `UncertaintyLevel`
- `PicoExtraction`
- `EvidenceMap`
- `ReferenceEvidenceProfile`
- `StructuredStudyProposal`
- `SearchPlan`
- `GapProposal`
- `GapScore`
- `ReferenceClusterTag`

These types mirror the Convex schema and keep UI, backend, and helper libraries aligned.

## 10. Research Workflow In Detail

The main workflow function is `runConsilium` in `convex/workflow.ts`.

### 10.1 Problem Creation

When the user submits a new problem:

1. A `problems` record is created.
2. Default agents are instantiated from `config/consilium.ts`.
3. The workflow is scheduled to run.
4. The UI redirects to the problem detail screen.

### 10.2 Query Understanding

The system asks an evaluator model to extract PICO:

- population
- intervention
- comparator
- outcomes
- context
- mechanistic hypothesis
- ambiguous terms

Each field has a status:

- `explicit`: directly stated by the user
- `inferred`: implied by the question
- `unclear`: not specified

If the model fails, deterministic fallback extraction is used.

### 10.3 Clarification Round

Each agent writes:

- clarifying questions
- a refined research formulation
- a plan of attack
- concerns from its specialty

The goal is not to ask the user forever. The goal is to expose ambiguity before retrieval and debate.

### 10.4 Search Planning

The system generates:

- PubMed queries
- web queries
- a search rationale

Search planning is constrained by:

- `maxPubMedQueries`
- `maxWebQueries`
- domain-specific rules
- PICO extraction

### 10.5 PubMed Retrieval

The PubMed client in `lib/pubmed.ts` supports:

- `searchPubmed(query, maxResults)`
- `fetchPubmedSummaries(pmids)`

It uses:

- `esearch.fcgi` to retrieve PMIDs
- `esummary.fcgi` for metadata
- `efetch.fcgi` for abstracts and full PubMed XML records

The app normalizes results into:

- PMID
- title
- abstract
- authors
- journal
- year
- URL
- raw metadata

### 10.6 Exa Retrieval

The Exa client in `lib/exa.ts` supports semantic web search when `EXA_API_KEY` is present.

The project uses Exa for:

- guidelines
- reviews
- authoritative web pages
- scientific context that may not be captured by PubMed alone

Search results are normalized to web references and saved in Convex.

### 10.7 Apify Retrieval

The Apify client in `lib/apify.ts` can run configurable actors.

Required variables:

- `APIFY_TOKEN`
- `APIFY_ACTOR_ID`

Optional:

- `APIFY_ACTOR_INPUT_JSON`

`APIFY_ACTOR_ID` is the actor identifier from Apify. Examples:

```text
apify/website-content-crawler
apify/google-search-scraper
your-username/your-custom-actor
```

`APIFY_ACTOR_INPUT_JSON` is a template for actors that need a custom input body. The app can replace:

- `{{query}}`
- `{{maxItems}}`
- `{{startUrls}}`

For `apify/website-content-crawler`, it can be left empty.

### 10.8 Reference Tagging

References are tagged with:

- population tags
- intervention types
- evidence type
- outcome types
- species
- age relevance
- evidence level

This metadata helps the final report distinguish direct, indirect, preclinical, and speculative support.

### 10.9 Evidence Synthesis

The Analyst and Evidence Grader roles produce a structured evidence map:

- directly supported
- indirectly supported
- preclinical only
- speculative
- caveats

This evidence map is saved on the `problems` record.

### 10.10 Debate

Agents take turns in a controlled loop.

Each agent receives:

- problem description
- PICO extraction
- reference summaries
- evidence map
- recent debate messages
- current candidate gaps
- role-specific instructions

Each contribution can produce new gap candidates.

### 10.11 Adversarial Critique

The Skeptic / Critic and Evidence Grader roles challenge:

- duplicated gaps
- weak logic
- vague intervention definitions
- missing comparators
- weak outcomes
- overreliance on animal evidence
- claims that overstate causality
- claims that confuse biomarkers with clinical outcomes

Critique output can update candidate gap metadata and penalties.

### 10.12 Ranking

Gaps receive 0 to 100 scores for:

- novelty
- evidence scarcity
- actionability
- clinical relevance
- mechanistic importance
- feasibility
- distinctiveness

The code then applies deterministic diversification through `lib/researchQuality.ts`.

### 10.13 Final Report

The final report must include:

```text
## Reformulated Clinical/Research Question
## PICO Extraction
## Evidence Map
## Top Research Gaps
## Ranked Study Proposals
## Limitations
## Final Answer
```

If the final LLM call fails, the workflow writes a deterministic fallback report using persisted PICO, evidence map, references, and gap candidates.

## 11. Gap Quality System

The gap quality layer is designed to prevent low-value final outputs.

### 11.1 Gap Types

Allowed gap types:

- `mechanism`
- `intervention`
- `comparator`
- `population_subgroup`
- `biomarker_measurement`
- `study_design_methodology`
- `translational`
- `safety_feasibility`
- `long_term_outcome`

Each final gap should be more specific than "mechanism unclear".

### 11.2 Evidence Levels

Allowed evidence levels:

- `direct_human_cp_adolescents`
- `human_cp_broader_age`
- `indirect_human_other_neurological`
- `preclinical_animal`
- `mechanistic_speculation`

The point is to stop the system from presenting indirect or animal evidence as if it were direct clinical evidence.

### 11.3 Uncertainty Levels

Allowed uncertainty levels:

- `low`
- `moderate`
- `high`
- `very_high`

Biomedical gap finding will often produce high uncertainty. That is acceptable if the uncertainty is explicit.

### 11.4 Duplicate Detection

`lexicalSimilarity()` tokenizes titles and descriptions, removes stop words, and calculates an overlap score. If two gaps have high overlap and the same primary gap type, one is penalized as a near-duplicate.

This is a lightweight heuristic. It is fast and deterministic, but it is not a full semantic embedding system.

### 11.5 Diversified Ranking

`diversifyGapRankings()`:

1. Normalizes gap types.
2. Normalizes evidence levels.
3. Assigns default scores when missing.
4. Penalizes vague gaps.
5. Penalizes weaker evidence directness.
6. Penalizes near-duplicates.
7. Selects a diverse top set across primary gap types where possible.

The final score is not a claim of scientific truth. It is a prioritization heuristic for research planning.

## 12. External API Clients

### 12.1 OpenRouter

File:

```text
lib/openrouter.ts
```

Responsibilities:

- call OpenRouter chat completions
- pass model, messages, temperature, and max tokens
- parse assistant content
- capture token usage
- capture cost metadata if available
- retry simple transient failures
- fail with useful error messages

Convex server-side environment variable:

```text
OPENROUTER_API_KEY
```

### 12.2 PubMed

File:

```text
lib/pubmed.ts
```

Responsibilities:

- search PubMed IDs
- fetch metadata
- fetch abstracts
- normalize author, journal, year, URL, and raw metadata
- support optional NCBI API key and email

Environment variables:

```text
NCBI_API_KEY
NCBI_EMAIL
```

### 12.3 Exa

File:

```text
lib/exa.ts
```

Responsibilities:

- run semantic web searches
- request highlights or summaries where configured
- normalize results to web references

Environment variable:

```text
EXA_API_KEY
```

### 12.4 Apify

File:

```text
lib/apify.ts
```

Responsibilities:

- run an Apify actor through HTTP API
- support query-based actors
- support start URL based crawlers
- normalize dataset output

Environment variables:

```text
APIFY_TOKEN
APIFY_ACTOR_ID
APIFY_ACTOR_INPUT_JSON
```

## 13. Configuration

Primary configuration lives in `config/consilium.ts`.

### 13.1 Model Configuration

```ts
export const MODEL_CONFIG = {
  defaultModel: "openai/gpt-4o-mini",
  evaluatorModel: "openai/gpt-4o-mini",
  temperature: 0.35,
  highPrecisionTemperature: 0.15,
  maxTokens: 1600,
} as const;
```

Change `defaultModel` to alter normal agent calls.

Change `evaluatorModel` to alter query understanding, tagging, ranking, and final report synthesis.

### 13.2 Workflow Defaults

```ts
export const WORKFLOW_DEFAULTS = {
  maxDebateRounds: 2,
  maxReferencesPerQuery: 6,
  maxPubMedQueries: 4,
  maxWebQueries: 2,
  maxReferencesInPrompt: 12,
  recentMessageWindow: 10,
  perProblemMaxLlmCalls: 20,
  perProblemMaxTokens: 85000,
};
```

These defaults intentionally control cost. Increase them only when you understand the OpenRouter budget impact.

### 13.3 Agent Templates

`DEFAULT_AGENT_TEMPLATES` defines:

- name
- specialization tags
- model
- temperature
- role description

Each new problem instantiates these templates as actual `agents` rows.

### 13.4 Guardrails

`SYSTEM_GUARDRAILS` instructs the models to:

- stay in biomedical research support mode
- avoid medical advice
- avoid invented citations
- separate known, unknown, weakly supported, and speculative claims
- cite references by PMID or URL when available

### 13.5 Domain Special Rules

`DOMAIN_SPECIAL_RULES` currently includes BDNF-specific rules because this was a key example domain.

For BDNF and cerebral palsy questions, the system must separate:

- rehabilitation-induced endogenous BDNF changes
- non-invasive stimulation
- pharmacologic modulation
- nutritional modulation
- regenerative approaches
- Val66Met and other genetic moderators
- biomarker association versus causal intervention

## 14. Reusable Doctor Orchestrator

The file `lib/doctorOrchestrator.ts` implements a framework-agnostic medical research orchestration helper.

It exports:

```ts
runDoctorConsilium(caseInput: DoctorCaseInput): Promise<DoctorAnswer>
```

It also exports:

- `ProviderModelKey`
- `DoctorCaseInput`
- `SingleModelOpinion`
- `DoctorAnswer`
- `MODELS`
- `callOpenRouterChat`

Default model mapping:

```ts
const MODELS = {
  claude: "anthropic/claude-3.7-sonnet",
  gpt: "openai/gpt-4.1-mini",
  gemini: "google/gemini-2.5-pro",
  grok: "xai/grok-2-latest",
};
```

Workflow:

1. Run independent analyses in parallel.
2. Run cross-model critique in parallel.
3. Ask a final judge model to synthesize one answer.
4. Ensure the final answer includes a strong medical safety disclaimer.

It is not tied to Convex or Next.js and can be reused in scripts, server jobs, or future backend modules.

## 15. Environment Variables

### 15.1 Frontend

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Yes | Connects the Next.js frontend to Convex. |

### 15.2 Convex Server-Side Secrets

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Required for real LLM workflow | Calls OpenRouter chat completions. |
| `NCBI_API_KEY` | Optional | Raises PubMed rate limits. |
| `NCBI_EMAIL` | Recommended | Identifies the app to NCBI. |
| `EXA_API_KEY` | Optional | Enables Exa semantic web search. |
| `APIFY_TOKEN` | Optional | Enables Apify actors. |
| `APIFY_ACTOR_ID` | Optional | Selects the Apify actor. |
| `APIFY_ACTOR_INPUT_JSON` | Optional | Custom JSON template for actor input. |

Set Convex secrets with:

```bash
npx convex env set OPENROUTER_API_KEY "sk-or-..."
npx convex env set NCBI_API_KEY "..."
npx convex env set NCBI_EMAIL "you@example.com"
npx convex env set EXA_API_KEY "..."
npx convex env set APIFY_TOKEN "..."
npx convex env set APIFY_ACTOR_ID "apify/website-content-crawler"
```

Do not commit `.env.local`.

## 16. Local Setup

Install dependencies:

```bash
npm install
```

Start Convex:

```bash
npx convex dev
```

Start Next.js:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## 17. Validation

Run:

```bash
npm run lint
npm run typecheck
npm run build
```

These commands check:

- ESLint rules
- TypeScript type safety
- Next.js production build
- Convex-generated API imports during build

## 18. Common Troubleshooting

### Missing `convex/_generated/api.ts`

Symptom:

```text
Failed to read source code from convex/_generated/api.ts
The system cannot find the file specified.
```

Fix:

```bash
npx convex dev
```

or:

```bash
npx convex codegen
```

Then restart Next.js.

### OpenRouter calls fail

Check:

- `OPENROUTER_API_KEY` is set in Convex environment.
- The model IDs are valid OpenRouter model IDs.
- The OpenRouter account has credits.
- The model provider is currently available.

### PubMed returns no results

Check:

- Search terms are not too narrow.
- NCBI is reachable.
- Optional `NCBI_EMAIL` and `NCBI_API_KEY` are set.
- PubMed actually has records for the topic.

### Exa is not used

Check:

- `EXA_API_KEY` is set in Convex.
- The workflow has web queries.
- The Exa API key is active.

### Apify is not used

Check:

- `APIFY_TOKEN` is set.
- `APIFY_ACTOR_ID` is set.
- The actor input shape matches the selected actor.
- The actor can run with your account limits.

### Report is partial

Possible reasons:

- LLM soft limit was reached.
- OpenRouter failed.
- External retrieval failed.
- A model returned non-JSON where structured JSON was expected.

The system should still save a final or partial report with caveats.

## 19. Extending The Project

### 19.1 Add A New Agent Type

Edit `config/consilium.ts` and add to `DEFAULT_AGENT_TEMPLATES`.

Recommended fields:

- clear scientific role
- narrow responsibility
- specialization tags
- model
- temperature

Avoid adding vague agents that duplicate existing responsibilities.

### 19.2 Add A New LLM Model

Change `model` in one or more agent templates.

Example:

```ts
model: "google/gemini-2.5-flash"
```

The app routes through OpenRouter, so model IDs should match OpenRouter IDs.

### 19.3 Add A New Data Source

Steps:

1. Create `lib/newSource.ts`.
2. Return a normalized reference object.
3. Add a collection function in `convex/workflow.ts`.
4. Insert results through `internal.problems.insertReferences`.
5. Add source-specific tags and evidence profiles.
6. Update documentation.

### 19.4 Add A New Gap Type

Steps:

1. Add the literal to `GAP_TYPES` in `types/consilium.ts`.
2. Add the validator in `convex/schema.ts`.
3. Add a label in `lib/researchQuality.ts`.
4. Update normalization logic.
5. Update prompts in `config/consilium.ts`.
6. Update report rendering if needed.

Be careful: adding schema values can affect existing Convex data and validators.

### 19.5 Improve Duplicate Detection

Current duplicate detection is lexical. Future improvements could use:

- embeddings
- cluster-based semantic similarity
- model-based pairwise duplicate judgments
- source-grounded overlap checks

If embeddings are added, keep deterministic fallback behavior.

## 20. Security And Privacy

The app currently uses a simple session-based model rather than full authentication.

Important rules:

- Do not submit real protected health information.
- Treat all patient context as anonymized.
- Do not commit API keys.
- Keep OpenRouter, Exa, Apify, and NCBI keys server-side.
- Do not expose server-side keys in Next.js public variables.
- Review Convex logs and usage if testing sensitive research workflows.

Future production hardening should include:

- real authentication
- access controls per user
- deletion/export policies
- audit logging
- stricter PHI warnings
- rate limiting
- abuse prevention

## 21. Budget And Cost Control

Cost is controlled through:

- limited debate rounds
- max references per query
- max web queries
- max references inserted into prompts
- per-problem max LLM calls
- per-problem max token budget
- short prompt context windows

Usage is logged to `usageLogs`.

Prices are not hard-coded because OpenRouter prices can change and vary by model. If exact billing is needed, add a pricing table outside the core logic and calculate cost from token usage.

## 22. Why The App Uses Convex

Convex is useful here because the workflow is stateful:

- problems progress through stages
- agents produce messages over time
- references are added incrementally
- gap candidates evolve
- usage logs accumulate
- the UI should update reactively

Instead of manually wiring REST endpoints and polling, Convex gives typed data access and reactive subscriptions.

## 23. Why The App Uses OpenRouter

OpenRouter lets the app use multiple model providers through one chat completions interface.

Benefits:

- easy model swapping
- provider diversity
- one API style
- simplified experimentation
- budget control through model selection

The app still keeps model IDs configurable so users can choose cheaper, faster, or stronger models.

## 24. Why The App Uses PubMed, Exa, And Apify Together

The sources have different roles:

- PubMed is the primary biomedical literature source.
- Exa is useful for semantic web search, reviews, and guidelines.
- Apify is useful when a specific crawler or scraper is needed.

The app can run without Exa and Apify. PubMed plus LLM analysis is the core evidence path. Exa and Apify improve grounding when configured.

## 25. Current Limitations

Scientific limitations:

- LLM synthesis can be wrong.
- PubMed abstracts are not full evidence.
- Full-text access may be missing.
- Study quality is not fully assessed.
- Evidence grading is heuristic, not GRADE.
- The system can miss important papers.
- The system can over-prioritize plausible but impractical ideas.

Technical limitations:

- Duplicate detection is lexical.
- Retrieval is not a complete systematic-search strategy.
- No user authentication yet.
- No PDF export yet.
- No uploaded paper RAG yet.
- No public share links yet.
- No background notification system yet.

## 26. Roadmap

Near-term:

- public share links
- PDF export
- richer usage dashboard
- user authentication
- custom agent builder

Research quality:

- embedding-based gap deduplication
- source-level evidence quality scoring
- ClinicalTrials.gov integration
- Semantic Scholar integration
- trial registry search
- better systematic review query generation

Data and workflow:

- uploaded PDF support
- saved search strategies
- reproducible report exports
- citation tables
- versioned reports

Production hardening:

- access control
- rate limiting
- monitoring
- error dashboards
- PHI warnings
- audit logs

## 27. Maintainer Checklist

Before publishing changes:

```bash
npm run lint
npm run typecheck
npm run build
git status --short
```

Before changing Convex schema:

1. Read Convex generated AI guidelines if present.
2. Consider existing production data.
3. Add optional fields first when possible.
4. Backfill or migrate data.
5. Narrow validators only after data is compatible.

Before changing prompts:

1. Keep safety disclaimers.
2. Keep PICO extraction.
3. Keep evidence directness labels.
4. Keep the fixed report structure.
5. Test at least one difficult biomedical question.

Before changing model configuration:

1. Check OpenRouter model availability.
2. Check cost.
3. Check context length.
4. Check JSON reliability.
5. Update documentation.

## 28. Glossary

PICO:

Population, Intervention, Comparator, Outcomes. A standard structure for clinical and biomedical questions.

Research gap:

A specific missing, weak, inconsistent, under-tested, or poorly operationalized area in the current evidence.

Evidence map:

A structured summary of direct, indirect, preclinical, speculative, and caveat-heavy evidence.

Directness:

How closely evidence matches the target question's population, intervention, comparator, and outcomes.

Gap diversification:

The process of avoiding multiple top gaps that all say the same thing in different words.

Mechanistic speculation:

Reasoning based on plausible biology without direct evidence in the target population and outcome.

Soft budget limit:

A configurable limit that stops further LLM calls and produces a partial report instead of failing.

Consilium:

A council. In this app, it means a group of specialized AI scientist agents debating one biomedical research question.
