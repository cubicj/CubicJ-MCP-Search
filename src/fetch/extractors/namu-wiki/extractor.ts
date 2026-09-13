import { JSDOM, VirtualConsole } from "jsdom";
import { fetchDocument } from "../../fetch.js";
import { extractScopedMarkdownFromElement } from "../community.js";
import type { Extractor, FetchMetadata } from "../types.js";
import { findContentContainer, parseNamuWikiUrl } from "./parse.js";

const TITLE_ACTIONS = new Set(["편집", "역사", "토론"]);

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractTitle(document: Document): string | null {
  const heading = document.querySelector("h1")?.cloneNode(true) as Element | undefined;
  if (!heading) return null;

  while (heading.lastChild) {
    const node = heading.lastChild;
    if (node.nodeType === 3 && !node.textContent?.trim()) {
      node.remove();
      continue;
    }
    if (node.nodeType === 1 && (node as Element).tagName === "A") {
      const link = node as Element;
      if (TITLE_ACTIONS.has(normalizeText(link.textContent ?? ""))) {
        link.remove();
        continue;
      }
    }
    break;
  }

  return normalizeText(heading.textContent ?? "") || null;
}

export { parseNamuWikiUrl } from "./parse.js";

export const namuWikiExtractor: Extractor = {
  name: "namu-wiki",
  matches: (url) => parseNamuWikiUrl(url) !== null,
  async extract(url) {
    const parsed = parseNamuWikiUrl(new URL(url));
    if (!parsed) throw new Error(`Not a namu.wiki article URL: ${url}`);

    const fetched = await fetchDocument(url);
    const dom = new JSDOM(fetched.text, { url: fetched.finalUrl, virtualConsole: new VirtualConsole() });
    const document = dom.window.document;
    const container = findContentContainer(document) ?? document.documentElement;
    const body = await extractScopedMarkdownFromElement(container, fetched.finalUrl);
    const metadata: FetchMetadata = {
      domain: "namu.wiki",
      site: "나무위키",
      ...(body.wordCount > 0 ? { word_count: body.wordCount } : {}),
      status: fetched.status,
      ...(fetched.contentType ? { content_type: fetched.contentType } : {}),
      ...(fetched.finalUrl !== url ? { final_url: fetched.finalUrl } : {}),
    };

    return {
      title: extractTitle(document) ?? parsed.title,
      markdown: body.markdown,
      metadata,
      extractor: "namu-wiki",
    };
  },
};
