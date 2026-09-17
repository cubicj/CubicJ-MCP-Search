import type { CountryCode, SearchLanguage } from "./markets.js";

const DEFAULT_BASE_URL = "https://api.search.brave.com/res/v1";
const DEFAULT_TIMEOUT_MS = 30000;

export class BraveApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Brave API status ${status}`);
    this.name = "BraveApiError";
    this.status = status;
  }
}

export class BraveTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Brave API timed out after ${timeoutMs}ms`);
    this.name = "BraveTimeoutError";
  }
}

export class BraveRequestError extends Error {
  constructor(reason: string) {
    super(`Brave API request failed: ${reason}`);
    this.name = "BraveRequestError";
  }
}

export interface LlmContextParams {
  query: string;
  maximum_number_of_urls?: number;
  maximum_number_of_tokens?: number;
  maximum_number_of_tokens_per_url?: number;
  freshness?: string;
  country?: CountryCode;
  search_lang?: SearchLanguage;
}

export interface BraveClient {
  llmContext(params: LlmContextParams): Promise<unknown>;
}

export interface BraveClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function createBraveClient(options: BraveClientOptions): BraveClient {
  const fetchFn = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async llmContext(params) {
      const url = new URL(`${baseUrl}/llm/context`);
      url.searchParams.set("q", params.query);
      const optional: Array<[string, string | number | undefined]> = [
        ["maximum_number_of_urls", params.maximum_number_of_urls],
        ["maximum_number_of_tokens", params.maximum_number_of_tokens],
        ["maximum_number_of_tokens_per_url", params.maximum_number_of_tokens_per_url],
        ["freshness", params.freshness],
        ["country", params.country],
        ["search_lang", params.search_lang],
      ];
      for (const [key, value] of optional) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
      url.searchParams.set("context_threshold_mode", "lenient");
      url.searchParams.set("spellcheck", "false");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchFn(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": options.apiKey,
          },
          signal: controller.signal,
        });
        if (!response.ok) {
          controller.abort();
          throw new BraveApiError(response.status);
        }
        try {
          return (await response.json()) as unknown;
        } catch (error) {
          if (isAbortError(error)) throw error;
          throw new BraveRequestError("invalid JSON");
        }
      } catch (error) {
        if (error instanceof BraveApiError || error instanceof BraveRequestError) throw error;
        if (isAbortError(error)) throw new BraveTimeoutError(timeoutMs);
        throw new BraveRequestError(error instanceof Error ? error.name : "Error");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
