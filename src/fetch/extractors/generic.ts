import { Defuddle } from "defuddle/node";
import { JSDOM, VirtualConsole } from "jsdom";
import { fetchDocument } from "../fetch.js";
import { extractPdf, isPdf } from "./pdf.js";
import type { Extractor, FetchMetadata } from "./types.js";

export const NO_CONTENT_NOTICE =
  "[No readable content was extracted. The page may require JavaScript rendering or a login. raw=true returns the same JavaScript shell; try a different URL.]";

const CHALLENGE_TITLES = [/^just a moment/i, /attention required!?\s*\|\s*cloudflare/i, /^access denied/i];

function isChallengePage(title: string, status: number): boolean {
  if (CHALLENGE_TITLES.some((pattern) => pattern.test(title.trim()))) return true;
  return status === 403;
}

function documentMetadata(
  requestedUrl: string,
  finalUrl: string,
  status: number,
  contentType: string | null,
): FetchMetadata {
  return {
    status,
    ...(finalUrl !== requestedUrl ? { final_url: finalUrl } : {}),
    ...(contentType ? { content_type: contentType } : {}),
  };
}

function isHtml(contentType: string | null): boolean {
  return contentType === null || contentType === "text/html" || contentType === "application/xhtml+xml";
}

function isPlainText(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/xml" ||
    contentType === "application/rss+xml" ||
    contentType === "application/atom+xml" ||
    contentType.endsWith("+json") ||
    contentType.endsWith("+xml")
  );
}

function plainTitle(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname.split("/").filter(Boolean).at(-1) ?? parsed.hostname;
}

export const genericExtractor: Extractor = {
  name: "generic",
  matches: () => true,
  async extract(url) {
    const document = await fetchDocument(url);
    const httpMetadata = documentMetadata(
      document.requestedUrl,
      document.finalUrl,
      document.status,
      document.contentType,
    );

    if (isPdf(document.contentType, document.bytes)) {
      return extractPdf(document);
    }

    if (isHtml(document.contentType)) {
      const virtualConsole = new VirtualConsole();
      const dom = new JSDOM(document.text, { url: document.finalUrl, virtualConsole });
      const result = await Defuddle(dom.window.document, document.finalUrl, { debug: false, markdown: true });
      const hasContent = result.content.trim().length > 0;
      const title = result.title || dom.window.document.title || "";
      if (!hasContent && isChallengePage(title, document.status)) {
        throw new Error(`Blocked by bot protection (status ${document.status}, title "${title.trim()}")`);
      }
      const metadata: FetchMetadata = {
        ...(result.author ? { author: result.author } : {}),
        ...(result.published ? { published: result.published } : {}),
        ...(result.description ? { description: result.description } : {}),
        ...(result.domain ? { domain: result.domain } : {}),
        ...(result.site ? { site: result.site } : {}),
        ...(result.wordCount > 0 ? { word_count: result.wordCount } : {}),
        ...httpMetadata,
      };
      const markdown = hasContent ? result.content : NO_CONTENT_NOTICE;
      return { title: result.title || "Untitled", markdown, metadata, extractor: "defuddle" };
    }

    if (document.contentType && isPlainText(document.contentType)) {
      return {
        title: plainTitle(document.finalUrl),
        markdown: document.text,
        metadata: httpMetadata,
        extractor: "plain",
      };
    }

    throw new Error(`Unsupported content type: ${document.contentType}`);
  },
};
