import type { WebReference } from "../types/consilium";

const EXA_SEARCH_URL = "https://api.exa.ai/search";

export interface ExaSearchOptions {
  apiKey?: string;
  query: string;
  maxResults: number;
  timeoutMs?: number;
}

interface ExaResult {
  id?: string;
  title?: string;
  url?: string;
  text?: string;
  publishedDate?: string;
  author?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parseResult(value: unknown): ExaResult | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    id: typeof value.id === "string" ? value.id : undefined,
    title: typeof value.title === "string" ? value.title : undefined,
    url: typeof value.url === "string" ? value.url : undefined,
    text: typeof value.text === "string" ? value.text : undefined,
    publishedDate: typeof value.publishedDate === "string" ? value.publishedDate : undefined,
    author: typeof value.author === "string" ? value.author : undefined,
  };
}

export async function searchExa(options: ExaSearchOptions): Promise<WebReference[]> {
  if (!options.apiKey) {
    return [];
  }

  const response = await fetchWithTimeout(
    EXA_SEARCH_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": options.apiKey,
      },
      body: JSON.stringify({
        query: options.query,
        type: "neural",
        numResults: options.maxResults,
        contents: { text: { maxCharacters: 1800 } },
      }),
    },
    options.timeoutMs ?? 45000,
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Exa search failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const parsed: unknown = JSON.parse(text);
  const results = isRecord(parsed) && Array.isArray(parsed.results) ? parsed.results : [];

  return results
    .map(parseResult)
    .filter((result): result is ExaResult => Boolean(result))
    .map((result, index) => ({
      sourceId: result.id ?? result.url,
      title: result.title ?? result.url ?? `Exa result ${index + 1}`,
      url: result.url,
      snippet: result.text,
      fullText: result.text,
      rawMetadata: { ...result },
    }));
}
