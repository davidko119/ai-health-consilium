import { XMLParser } from "fast-xml-parser";
import type { PubMedReference } from "../types/consilium";

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
const PUBMED_TOOL = "ai-health-consilium";

export interface PubMedClientOptions {
  apiKey?: string;
  email?: string;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (isRecord(value) && typeof value["#text"] === "string") {
    return value["#text"];
  }
  return undefined;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  return isRecord(value) ? [value] : [];
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildUrl(path: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(path, EUTILS_BASE);
  url.searchParams.set("tool", PUBMED_TOOL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function searchPubmed(
  query: string,
  maxResults: number,
  options: PubMedClientOptions = {},
): Promise<string[]> {
  const url = buildUrl("esearch.fcgi", {
    db: "pubmed",
    term: query,
    retmax: maxResults,
    retmode: "json",
    sort: "relevance",
    api_key: options.apiKey,
    email: options.email,
  });

  const response = await fetchWithTimeout(url, { method: "GET" }, options.timeoutMs ?? 30000);
  if (!response.ok) {
    throw new Error(`PubMed esearch failed (${response.status}).`);
  }

  const parsed: unknown = await response.json();
  if (!isRecord(parsed) || !isRecord(parsed.esearchresult)) {
    return [];
  }

  const ids = parsed.esearchresult.idlist;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

export async function fetchPubmedSummaries(
  pmids: string[],
  options: PubMedClientOptions = {},
): Promise<PubMedReference[]> {
  const uniquePmids = [...new Set(pmids)].filter(Boolean);
  if (uniquePmids.length === 0) {
    return [];
  }

  const [summaries, abstracts] = await Promise.all([
    fetchSummaryRecords(uniquePmids, options),
    fetchAbstractRecords(uniquePmids, options),
  ]);

  return uniquePmids.map((pmid) => {
    const summary = summaries.get(pmid) ?? {};
    const abstractRecord = abstracts.get(pmid);
    const title = asString(summary.title) ?? abstractRecord?.title ?? `PubMed ${pmid}`;
    const authors = parseSummaryAuthors(summary.authors);
    const journal = asString(summary.fulljournalname) ?? asString(summary.source) ?? abstractRecord?.journal;
    const pubdate = asString(summary.pubdate) ?? abstractRecord?.pubDate;

    return {
      pmid,
      title: normalizeWhitespace(title),
      abstract: abstractRecord?.abstract,
      authors: authors.length > 0 ? authors : abstractRecord?.authors ?? [],
      journal: journal ? normalizeWhitespace(journal) : undefined,
      year: parseYear(pubdate),
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      rawMetadata: {
        summary,
        abstract: abstractRecord?.raw ?? null,
      },
    };
  });
}

async function fetchSummaryRecords(
  pmids: string[],
  options: PubMedClientOptions,
): Promise<Map<string, Record<string, unknown>>> {
  await wait(120);
  const url = buildUrl("esummary.fcgi", {
    db: "pubmed",
    id: pmids.join(","),
    retmode: "json",
    api_key: options.apiKey,
    email: options.email,
  });

  const response = await fetchWithTimeout(url, { method: "GET" }, options.timeoutMs ?? 30000);
  if (!response.ok) {
    throw new Error(`PubMed esummary failed (${response.status}).`);
  }

  const parsed: unknown = await response.json();
  const result = isRecord(parsed) && isRecord(parsed.result) ? parsed.result : {};
  const map = new Map<string, Record<string, unknown>>();

  for (const pmid of pmids) {
    const record = result[pmid];
    if (isRecord(record)) {
      map.set(pmid, record);
    }
  }

  return map;
}

interface AbstractRecord {
  title?: string;
  abstract?: string;
  authors: string[];
  journal?: string;
  pubDate?: string;
  raw: Record<string, unknown>;
}

async function fetchAbstractRecords(
  pmids: string[],
  options: PubMedClientOptions,
): Promise<Map<string, AbstractRecord>> {
  await wait(120);
  const url = buildUrl("efetch.fcgi", {
    db: "pubmed",
    id: pmids.join(","),
    retmode: "xml",
    rettype: "abstract",
    api_key: options.apiKey,
    email: options.email,
  });

  const response = await fetchWithTimeout(url, { method: "GET" }, options.timeoutMs ?? 30000);
  if (!response.ok) {
    throw new Error(`PubMed efetch failed (${response.status}).`);
  }

  const xml = await response.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    textNodeName: "#text",
  });
  const parsed: unknown = parser.parse(xml);
  const articlesRoot = isRecord(parsed) && isRecord(parsed.PubmedArticleSet) ? parsed.PubmedArticleSet : {};
  const articles = asRecordArray(articlesRoot.PubmedArticle);
  const map = new Map<string, AbstractRecord>();

  for (const article of articles) {
    const citation = isRecord(article.MedlineCitation) ? article.MedlineCitation : {};
    const pmid = asString(citation.PMID);
    if (!pmid) {
      continue;
    }
    const articleNode = isRecord(citation.Article) ? citation.Article : {};
    const journalNode = isRecord(articleNode.Journal) ? articleNode.Journal : {};

    map.set(pmid, {
      title: asString(articleNode.ArticleTitle),
      abstract: parseAbstract(articleNode.Abstract),
      authors: parseArticleAuthors(articleNode.AuthorList),
      journal: asString(journalNode.Title) ?? asString(journalNode.ISOAbbreviation),
      pubDate: parseJournalDate(journalNode.JournalIssue),
      raw: article,
    });
  }

  return map;
}

function parseSummaryAuthors(value: unknown): string[] {
  return asRecordArray(value)
    .map((author) => asString(author.name))
    .filter((name): name is string => Boolean(name));
}

function parseArticleAuthors(value: unknown): string[] {
  const authorList = isRecord(value) ? value.Author : value;
  return asRecordArray(authorList)
    .map((author) => {
      const last = asString(author.LastName);
      const fore = asString(author.ForeName) ?? asString(author.Initials);
      return [fore, last].filter(Boolean).join(" ");
    })
    .filter(Boolean);
}

function parseAbstract(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const abstractText = value.AbstractText;
  if (typeof abstractText === "string") {
    return normalizeWhitespace(abstractText);
  }
  if (Array.isArray(abstractText)) {
    const parts = abstractText
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (!isRecord(part)) {
          return "";
        }
        const label = asString(part.Label);
        const text = asString(part["#text"]);
        return [label, text].filter(Boolean).join(": ");
      })
      .filter(Boolean);
    return parts.length > 0 ? normalizeWhitespace(parts.join(" ")) : undefined;
  }
  if (isRecord(abstractText)) {
    return normalizeWhitespace(asString(abstractText["#text"]) ?? "");
  }
  return undefined;
}

function parseJournalDate(value: unknown): string | undefined {
  const issue = isRecord(value) ? value : {};
  const pubDate = isRecord(issue.PubDate) ? issue.PubDate : {};
  return [asString(pubDate.Year), asString(pubDate.Month), asString(pubDate.Day)]
    .filter(Boolean)
    .join(" ");
}

function parseYear(value: string | undefined): number | undefined {
  const match = value?.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
