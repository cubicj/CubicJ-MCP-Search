import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { buildMarkdownText, buildRawText, paginate } from "../fetch/content.js";
import { selectExtractor } from "../fetch/extractors/registry.js";
import { fetchDocument } from "../fetch/fetch.js";

export const fetchDescription =
  "Fetch one URL and return its readable content as markdown with a title and metadata. " +
  "Use it to read a page in full after web_search, or any URL the user gives: articles, docs, forums, news. " +
  "Site-specific extractors return post body plus comments for gall.dcinside.com, Clien, Ruliweb, and FMKorea; body only for blog.naver.com and namu.wiki; " +
  "threads with replies and profiles with recent posts for bsky.app; raw content or REST data for github.com files, repos, issues, pull requests, and gists. " +
  "Non-HTML text (JSON, XML, RSS, plain text) is returned as-is; PDFs as page-separated text with page_count; image-only PDFs return a notice; other binaries are errors. " +
  "raw=true skips extraction and returns the decoded response text. " +
  "Long content is paginated: content is sliced from start_index (default 0) for max_length characters (default 50000); " +
  "to continue, call again with start_index advanced by the previous max_length and stop when start_index + max_length >= total_length. " +
  "Bot-protection pages return an error; empty pages that need JavaScript or a login return a notice.";

export const fetchAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} satisfies ToolAnnotations;

export const fetchMeta = { "anthropic/maxResultSizeChars": 200000 } as const;

export const fetchInputSchema = {
  url: z.url().describe("URL to fetch"),
  max_length: z.number().int().positive().optional().default(50000).describe("Maximum number of characters to return"),
  start_index: z.number().int().min(0).optional().default(0).describe("Start content from this character index"),
  raw: z.boolean().optional().default(false).describe("Get raw content without markdown conversion"),
};

export const fetchOutputSchema = {
  url: z.url(),
  title: z.string(),
  mode: z.enum(["markdown", "raw"]),
  extractor: z.string().optional(),
  content: z.string(),
  start_index: z.number().int().min(0),
  max_length: z.number().int().positive(),
  total_length: z.number().int().min(0),
  metadata: z
    .object({
      author: z.string().optional(),
      published: z.string().optional(),
      description: z.string().optional(),
      domain: z.string().optional(),
      site: z.string().optional(),
      word_count: z.number().int().positive().optional(),
      page_count: z.number().int().positive().optional(),
      views: z.number().int().min(0).optional(),
      recommends: z.number().int().min(0).optional(),
      comment_count: z.number().int().min(0).optional(),
      status: z.number().int().min(0).optional(),
      final_url: z.string().optional(),
      content_type: z.string().optional(),
    })
    .optional(),
};

export interface FetchArgs {
  url: string;
  max_length: number;
  start_index: number;
  raw: boolean;
}

export async function runFetch({ url, max_length, start_index, raw }: FetchArgs): Promise<CallToolResult> {
  try {
    if (raw) {
      const document = await fetchDocument(url);
      const paged = paginate(document.text, start_index, max_length);
      return {
        content: [{ type: "text", text: buildRawText(paged) }],
        structuredContent: {
          url,
          title: "Untitled",
          mode: "raw",
          content: paged.content,
          start_index,
          max_length,
          total_length: paged.total_length,
        },
      };
    }

    const extractor = selectExtractor(url);
    const { title, markdown, metadata, extractor: resultExtractor } = await extractor.extract(url);
    const paged = paginate(markdown, start_index, max_length);
    return {
      content: [{ type: "text", text: buildMarkdownText(title, url, metadata, paged) }],
      structuredContent: {
        url,
        title,
        mode: "markdown",
        extractor: resultExtractor,
        content: paged.content,
        start_index,
        max_length,
        total_length: paged.total_length,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Error fetching ${url}: ${msg}` }], isError: true };
  }
}
