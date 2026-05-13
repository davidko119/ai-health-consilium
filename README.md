# 🧬 AI Health Consilium

![AI Health Consilium banner](public/consili-banner.png)

**AI Health Consilium** is an open-source web application that simulates a panel of AI scientist agents collaborating to find **research gaps** in biomedical and health science. Submit a research problem, and a council of specialized agents debates the evidence, queries the literature, and surfaces testable hypotheses that current science has missed.

***

## ✨ Features

- 🧠 **Multi-agent debate** — 5 specialized AI scientists (Clinical Expert, Molecular Expert, Biostatistician, Meta-Researcher, Gap Seeker) argue and cross-examine each other
- 🔍 **Iterative Deep Research** — agents search PubMed, scrape the web with Apify/Exa, and ground the debate in retrieved evidence
- 📚 **PubMed integration** — queries NCBI E-utilities for peer-reviewed literature (`esearch`, `esummary`, `efetch`)
- 🌐 **Web search grounding** — real-time semantic web search via Exa and optional web scraping via Apify
- 📊 **Gap candidates** — structured research gap objects with evidence, priority score, and proposed study designs
- 📝 **Final Consilium Report** — formatted markdown report with reformulated research question, literature summary, top gaps, and caveats
- 💰 **Budget tracking** — per-session token and cost logging, soft limit enforcement
- 🌙 **Dark / Light mode** — full theme support

***

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router) + React + TypeScript |
| Styling | Tailwind CSS |
| Backend / DB | [Convex](https://convex.dev) |
| LLM gateway | [OpenRouter](https://openrouter.ai) |
| Literature | [PubMed E-utilities](https://eutils.ncbi.nlm.nih.gov) (free) |
| Web scraping | [Apify](https://apify.com) |
| Semantic search | [Exa](https://exa.ai) |

***

## 🚀 Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/davidko119/ai-health-consilium.git
cd ai-health-consilium
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env.local` file in the root:

```env
# Convex — run `npx convex dev` to get your deployment URL
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud

# OpenRouter — set server-side with `npx convex env set`
OPENROUTER_API_KEY=sk-or-...

# PubMed / NCBI — optional but recommended (higher rate limits)
NCBI_API_KEY=your_ncbi_key
NCBI_EMAIL=you@example.com

# Apify — optional
APIFY_TOKEN=apify_api_...
APIFY_ACTOR_ID=user/actor-name
APIFY_ACTOR_INPUT_JSON=

# Exa — optional semantic web search
EXA_API_KEY=your_exa_key
```

For production Convex functions, set server-side secrets with:

```bash
npx convex env set OPENROUTER_API_KEY "..."
npx convex env set NCBI_API_KEY "..."
npx convex env set NCBI_EMAIL "you@example.com"
npx convex env set APIFY_TOKEN "..."
npx convex env set APIFY_ACTOR_ID "user/actor-name"
npx convex env set APIFY_ACTOR_INPUT_JSON '{"query":"{{query}}","maxItems":{{maxItems}}}' # only for search-style actors
npx convex env set EXA_API_KEY "..."
```

### Apify actor settings

Apify is optional. If `EXA_API_KEY` is set, the app already has semantic web grounding through Exa. Use Apify only when you want a specific crawler/scraper actor.

- `APIFY_ACTOR_ID` is copied from the actor page in Apify Store or Console. If the actor URL contains `apify~website-content-crawler`, use `apify/website-content-crawler`. If it belongs to your account, use `your-username/your-actor-name`.
- `APIFY_ACTOR_INPUT_JSON` is optional. Leave it empty unless the chosen actor needs a custom input shape. The app can replace `{{query}}`, `{{maxItems}}`, and `{{startUrls}}` inside the JSON template.
- For `apify/website-content-crawler`, leave `APIFY_ACTOR_INPUT_JSON` empty. The app will crawl URLs found by Exa.
- Example template for a search-style actor:

```json
{"query":"{{query}}","maxItems":{{maxItems}}}
```

- Example template for a crawler-style actor where you provide URLs:

```json
{"startUrls":{{startUrls}},"maxCrawlPages":{{maxItems}},"proxyConfiguration":{"useApifyProxy":true}}
```

The exact input fields depend on the actor you choose; copy them from that actor's Input tab in Apify.

### 4. Set up Convex

```bash
npx convex dev
```

This will create your Convex backend and sync the schema automatically.

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

***

## 📁 Project Structure

```text
ai-health-consilium/
├── app/                         # Next.js App Router pages
│   ├── page.tsx                 # Home — problem list
│   ├── new/page.tsx             # New Consilium form
│   └── problems/[problemId]/    # Problem detail — main screen
├── components/                  # Reusable UI components
├── convex/                      # Convex backend
│   ├── schema.ts                # Database schema
│   ├── problems.ts              # Queries, mutations, internal DB helpers
│   └── workflow.ts              # Main research pipeline
├── lib/                         # External API clients
│   ├── openrouter.ts            # LLM calls via OpenRouter
│   ├── pubmed.ts                # PubMed E-utilities client
│   ├── apify.ts                 # Apify scraping client
│   └── exa.ts                   # Exa semantic search client
├── config/
│   ├── consilium.ts             # Runtime config
│   └── agents.ts                # Agent-role aliases and budget constants
├── types/                       # Shared TypeScript types
└── public/consili-banner.png    # Project banner image
```

***

## 🤖 Agent Roles

Each Consilium session instantiates 5 AI scientist agents. Their roles and system prompts are configured in `config/consilium.ts` and re-exported from `config/agents.ts`.

| Agent | Focus |
|---|---|
| **Clinical Expert** | Patient outcomes, clinical relevance, safety |
| **Molecular / Mechanistic Expert** | Biological mechanisms, pathways, biomarkers |
| **Biostatistician** | Study design, bias, statistical power, confounders |
| **Meta-Researcher** | Evidence synthesis, publication bias, systematic reviews |
| **Gap Seeker** | Under-researched combinations, contradictions, testable gaps |

### Adding a new agent role

1. Open `config/consilium.ts`
2. Add a new entry to the `DEFAULT_AGENT_TEMPLATES` array:

```typescript
{
  name: "Health Economist",
  roleDescription: "You are a health economist focused on cost-effectiveness, resource allocation, and implementation barriers for new interventions.",
  specializationTags: ["cost-effectiveness", "HTA", "implementation"],
  model: "google/gemini-2.5-flash",
  temperature: 0.25
}
```

3. Restart the dev server — the new agent will be included in all future sessions.

***

## 🔄 Research Pipeline

Each Consilium session runs a quality-gated pipeline designed to avoid redundant gaps:

```text
Stage 1: Query understanding
        └── Extracts PICO with explicit / inferred / unclear status
        └── Flags ambiguous phrases such as broad "BDNF modulation"

Stage 2: Literature Collection
        └── PubMed search + Exa/Apify web scraping
        └── Tags references by population, intervention, species, age relevance, and evidence level

Stage 3: Evidence synthesis
        └── Analyst separates direct, indirect, preclinical, and speculative support
        └── Evidence Grader creates a structured evidence map

Stage 4: Gap proposal
        └── Gap Finder proposes 8–12 candidate gaps with primary / secondary gap types
        └── Each candidate includes a structured study proposal

Stage 5: Adversarial critique
        └── Skeptic attacks overlap, vague interventions, missing comparators, weak outcomes, and overreach
        └── Evidence Grader checks directness and uncertainty

Stage 6: Reranking + diversification
        └── Scores novelty, scarcity, actionability, clinical relevance, mechanism, feasibility, and distinctiveness
        └── Penalizes near-duplicates and keeps top gaps diverse by type whenever possible

Stage 7: Final Report
        └── Fixed PICO / Evidence Map / Top Gaps / Study Proposals / Limitations / Final Answer structure
```

***

## 💰 Budget & Cost Estimation

The app tracks OpenRouter usage per session. Prices are intentionally not hard-coded; add your own pricing model if needed.

Configure the per-session soft limit in `config/consilium.ts`:

```typescript
export const WORKFLOW_DEFAULTS = {
  perProblemMaxLlmCalls: 20,
  perProblemMaxTokens: 85000
}
```

***

## 🔧 Configuration

Most key parameters live in `config/consilium.ts`:

```typescript
export const MODEL_CONFIG = {
  defaultModel: "openai/gpt-4o-mini",
  evaluatorModel: "openai/gpt-4o-mini"
}

export const WORKFLOW_DEFAULTS = {
  maxDebateRounds: 2,
  maxReferencesPerQuery: 6,
  maxPubMedQueries: 4,
  maxWebQueries: 2
}
```

***

## 🧪 Example Research Problems

Try these to get started:

- *"Can BDNF modulation improve motor outcomes in adolescent cerebral palsy patients?"*
- *"What is the role of gut microbiome in treatment-resistant depression?"*
- *"Are there untested combinations of photobiomodulation and cognitive training for Alzheimer's prevention?"*

***

## 🛣️ Roadmap

- [ ] User authentication (NextAuth)
- [ ] PDF export of final report
- [ ] Custom agent role builder in UI
- [ ] Support for uploading your own papers (RAG)
- [ ] Integration with Semantic Scholar API
- [ ] Slack / email notifications when session completes
- [ ] Public sharing of Consilium sessions

***

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repo
2. Create your feature branch: `git checkout -b feature/new-agent-role`
3. Commit your changes: `git commit -m 'Add health economist agent'`
4. Push to the branch: `git push origin feature/new-agent-role`
5. Open a Pull Request

***

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

***

## 🙏 Acknowledgements

- [OpenRouter](https://openrouter.ai) — unified LLM API gateway
- [Convex](https://convex.dev) — reactive backend and database
- [NCBI / PubMed](https://pubmed.ncbi.nlm.nih.gov) — free biomedical literature API
- [Exa](https://exa.ai) — semantic web search for AI agents
- [Apify](https://apify.com) — web scraping platform

***

> Built by [David Šarlák](https://github.com/davidko119) · Powered by AI Health Labs
