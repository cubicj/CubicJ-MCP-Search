export interface WebSearchResult {
  title: string;
  url: string;
  site?: string;
  age?: string;
  snippets: string[];
}

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function pickAge(source: JsonRecord | undefined): string | undefined {
  if (!source || !Array.isArray(source.age)) return undefined;
  return source.age.find((entry): entry is string => typeof entry === "string" && DATE_ONLY.test(entry));
}

function toResult(item: JsonRecord, sources: JsonRecord): WebSearchResult | undefined {
  const url = asString(item.url);
  if (!url) return undefined;
  const source = isRecord(sources[url]) ? sources[url] : undefined;
  const title = asString(item.title) ?? asString(source?.title) ?? url;
  const site = asString(source?.hostname);
  const age = pickAge(source);
  const snippets = Array.isArray(item.snippets) ? item.snippets.filter((s): s is string => typeof s === "string") : [];

  return {
    title,
    url,
    ...(site ? { site } : {}),
    ...(age ? { age } : {}),
    snippets,
  };
}

export function normalizeLlmContext(raw: unknown): WebSearchResult[] {
  if (!isRecord(raw) || !isRecord(raw.grounding) || !Array.isArray(raw.grounding.generic)) return [];
  const sources = isRecord(raw.sources) ? raw.sources : {};

  return raw.grounding.generic
    .filter(isRecord)
    .map((item) => toResult(item, sources))
    .filter((result): result is WebSearchResult => result !== undefined);
}
