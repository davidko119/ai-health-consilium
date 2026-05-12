import type { WebReference } from "../types/consilium";

export interface ApifyScrapeOptions {
  token?: string;
  actorId?: string;
  inputTemplateJson?: string;
  query: string;
  startUrls?: string[];
  maxItems: number;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringFromKeys(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function actorPath(actorId: string): string {
  return actorId.replace("/", "~");
}

function renderTemplate(template: string, options: ApifyScrapeOptions): Record<string, unknown> {
  const rendered = template
    .replaceAll("{{query}}", options.query)
    .replaceAll("{{maxItems}}", String(options.maxItems))
    .replaceAll("{{startUrls}}", JSON.stringify(options.startUrls ?? []));
  const parsed: unknown = JSON.parse(rendered);
  if (!isRecord(parsed)) {
    throw new Error("APIFY_ACTOR_INPUT_JSON must render to a JSON object.");
  }
  return parsed;
}

function defaultInput(options: ApifyScrapeOptions): Record<string, unknown> {
  const startUrls = (options.startUrls ?? []).map((url) => ({ url }));
  return {
    query: options.query,
    queries: [options.query],
    searchQueries: [options.query],
    startUrls,
    maxItems: options.maxItems,
    maxResults: options.maxItems,
    maxCrawlPages: options.maxItems,
    proxyConfiguration: { useApifyProxy: true },
  };
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

export async function scrapeWithApify(options: ApifyScrapeOptions): Promise<WebReference[]> {
  if (!options.token || !options.actorId) {
    return [];
  }

  const input = options.inputTemplateJson
    ? renderTemplate(options.inputTemplateJson, options)
    : defaultInput(options);
  const url = new URL(
    `https://api.apify.com/v2/acts/${actorPath(options.actorId)}/run-sync-get-dataset-items`,
  );
  url.searchParams.set("token", options.token);
  url.searchParams.set("clean", "true");
  url.searchParams.set("format", "json");

  const response = await fetchWithTimeout(
    url.toString(),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    options.timeoutMs ?? 60000,
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Apify actor failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const parsed: unknown = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed.filter(isRecord) : [];

  return items.slice(0, options.maxItems).map((item, index) => {
    const urlValue = stringFromKeys(item, ["url", "link", "sourceUrl", "pageUrl"]);
    const title =
      stringFromKeys(item, ["title", "name", "headline", "pageTitle"]) ??
      (urlValue ? new URL(urlValue).hostname : `Web source ${index + 1}`);
    const snippet = stringFromKeys(item, ["snippet", "description", "text", "markdown"]);
    const fullText = stringFromKeys(item, ["fullText", "content", "html", "markdown"]);

    return {
      sourceId: urlValue,
      title,
      url: urlValue,
      snippet,
      fullText,
      rawMetadata: item,
    };
  });
}
