import type { ChatMessage, LLMResult, LLMUsage } from "../types/consilium";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterCallOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  referer?: string;
  title?: string;
  timeoutMs?: number;
  retries?: number;
}

interface OpenRouterPayload {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseUsage(raw: Record<string, unknown>): LLMUsage {
  const usage = isRecord(raw.usage) ? raw.usage : {};
  const promptTokens = numberOrNull(usage.prompt_tokens ?? usage.input_tokens);
  const completionTokens = numberOrNull(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = numberOrNull(usage.total_tokens);
  const rawCost = usage.cost ?? usage.total_cost ?? raw.cost;

  return {
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    totalTokens: totalTokens ?? sumNullable(promptTokens, completionTokens),
    costEstimate: numberOrNull(rawCost),
    providerMetadata: usage,
  };
}

function sumNullable(left: number | null, right: number | null): number | null {
  if (left === null && right === null) {
    return null;
  }
  return (left ?? 0) + (right ?? 0);
}

function parseAssistantText(raw: Record<string, unknown>): string {
  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const firstChoice = choices.find(isRecord);
  const message = firstChoice && isRecord(firstChoice.message) ? firstChoice.message : undefined;
  const content = message ? message.content : undefined;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (isRecord(part) ? stringOrEmpty(part.text) : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

export async function callLLM(options: OpenRouterCallOptions): Promise<LLMResult> {
  if (!options.apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  const payload: OpenRouterPayload = {
    model: options.model,
    messages: options.messages,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
  };

  const headers: HeadersInit = {
    Authorization: `Bearer ${options.apiKey}`,
    "Content-Type": "application/json",
  };

  if (options.referer) {
    headers["HTTP-Referer"] = options.referer;
  }

  if (options.title) {
    headers["X-OpenRouter-Title"] = options.title;
  }

  const retries = options.retries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        OPENROUTER_URL,
        {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        },
        options.timeoutMs ?? 45000,
      );

      const body = await response.text();
      const parsed = parseJsonRecord(body);

      if (!response.ok) {
        const message = parsed ? JSON.stringify(parsed) : body;
        throw new Error(`OpenRouter request failed (${response.status}): ${message.slice(0, 500)}`);
      }

      if (!parsed) {
        throw new Error("OpenRouter returned a non-JSON response.");
      }

      const content = parseAssistantText(parsed);
      if (!content) {
        throw new Error("OpenRouter response did not include assistant content.");
      }

      return {
        content,
        usage: parseUsage(parsed),
        raw: parsed,
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await wait(650 * (attempt + 1));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("OpenRouter request failed.");
}

export function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const direct = parseJsonRecord(text);
  if (direct) {
    return direct;
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = parseJsonRecord(fenced[1].trim());
    if (parsed) {
      return parsed;
    }
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return parseJsonRecord(text.slice(start, end + 1));
  }

  return null;
}
