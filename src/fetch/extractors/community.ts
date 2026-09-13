import { Defuddle } from "defuddle/node";
import { JSDOM, VirtualConsole } from "jsdom";
import { NO_CONTENT_NOTICE } from "./generic.js";

export interface CommunityComment {
  author: string;
  time: string;
  text: string;
  depth: number;
}

export function renderComments(comments: CommunityComment[], heading?: string): string {
  if (comments.length === 0) return "";

  const entries = comments.map((comment) => {
    const prefix = comment.depth > 0 ? `${">".repeat(comment.depth)} ` : "";
    return [
      `${prefix}**${comment.author}** · ${comment.time}`,
      ...comment.text.split("\n").map((line) => `${prefix}${line}`),
    ].join("\n");
  });

  return [`## ${heading ?? "Comments"} (${comments.length})`, ...entries].join("\n\n");
}

function createDom(html: string, url: string): JSDOM {
  return new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
}

export async function extractScopedMarkdown(
  html: string,
  url: string,
  selector: string,
): Promise<{ title: string; markdown: string; wordCount: number }> {
  const dom = createDom(html, url);
  const element = dom.window.document.querySelector(selector) ?? dom.window.document.documentElement;
  return extractScopedMarkdownFromElement(element, url);
}

export async function extractScopedMarkdownFromElement(
  element: Element,
  url: string,
): Promise<{ title: string; markdown: string; wordCount: number }> {
  const document = createDom(element.outerHTML, url).window.document;
  const result = await Defuddle(document, url, { debug: false, markdown: true });
  const hasContent = result.content.trim().length > 0;

  return {
    title: result.title,
    markdown: hasContent ? result.content : NO_CONTENT_NOTICE,
    wordCount: hasContent ? result.wordCount : 0,
  };
}
