import type { Extractor, ExtractResult, FetchMetadata } from "../types.js";
import { fetchComments, fetchPage } from "./client.js";
import { URLS } from "./endpoints.js";
import { parseComments, parsePostDetail } from "./parse.js";
import type { ArticleDetail, Comment, User } from "./types.js";

interface ParsedDcUrl {
  galleryId: string;
  articleIndex: number;
  isMinor: boolean;
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseDcPostUrl(url: URL): ParsedDcUrl | null {
  if (url.hostname !== "gall.dcinside.com") return null;
  const pathname = url.pathname;

  const queryMatch = pathname.match(/^\/(mgallery\/)?board\/view\/?$/);
  if (queryMatch) {
    const galleryId = url.searchParams.get("id");
    const articleIndex = parsePositiveInteger(url.searchParams.get("no"));
    if (!galleryId || articleIndex === null) return null;
    return { galleryId, articleIndex, isMinor: Boolean(queryMatch[1]) };
  }

  const boardPathMatch = pathname.match(/^\/(mgallery\/)?board\/([^/]+)\/(\d+)$/);
  if (boardPathMatch) {
    const articleIndex = parsePositiveInteger(boardPathMatch[3]);
    if (articleIndex === null) return null;
    return { galleryId: boardPathMatch[2], articleIndex, isMinor: Boolean(boardPathMatch[1]) };
  }

  const shortPathMatch = pathname.match(/^\/([^/]+)\/(\d+)$/);
  if (shortPathMatch) {
    const articleIndex = parsePositiveInteger(shortPathMatch[2]);
    if (articleIndex === null) return null;
    return { galleryId: shortPathMatch[1], articleIndex, isMinor: false };
  }

  return null;
}

function stripBodyHtml(body: string): string {
  return body
    .replace(/<img\b[^>]*\/?>/gi, "\n[image]\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatAuthor(user: User): string {
  return user.ip ? `${user.name}(${user.ip})` : user.name;
}

function isoDate(time: Date): string | null {
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

export function renderDcPost(detail: ArticleDetail, comments: Comment[]): ExtractResult {
  const bodyText = stripBodyHtml(detail.body);
  const commentLines = comments.map((comment) => {
    const body = stripBodyHtml(comment.body).replace(/\s*\n\s*/g, " ");
    const date = isoDate(comment.time);
    return `- **${formatAuthor(comment.user)}**${date ? ` (${date})` : ""}: ${body}`;
  });
  const markdown =
    comments.length > 0 ? `${bodyText}\n\n## Comments (${comments.length})\n\n${commentLines.join("\n")}` : bodyText;

  const published = isoDate(detail.time);
  const metadata: FetchMetadata = {
    ...(detail.user.name ? { author: formatAuthor(detail.user) } : {}),
    ...(published ? { published } : {}),
    domain: "gall.dcinside.com",
    ...(detail.galleryName ? { site: detail.galleryName } : {}),
    views: detail.view,
    recommends: detail.recommend,
    comment_count: comments.length,
  };

  return { title: detail.title || "Untitled", markdown, metadata, extractor: "dcinside" };
}

export const dcinsideExtractor: Extractor = {
  name: "dcinside",
  matches: (url) => parseDcPostUrl(url) !== null,
  async extract(url) {
    const parsed = parseDcPostUrl(new URL(url));
    if (!parsed) throw new Error(`Not a DCInside post URL: ${url}`);

    const viewUrl = parsed.isMinor
      ? `${URLS.MINOR_POST_VIEW}?id=${parsed.galleryId}&no=${parsed.articleIndex}`
      : `${URLS.POST_VIEW}?id=${parsed.galleryId}&no=${parsed.articleIndex}`;

    const { html, session } = await fetchPage(viewUrl);
    const { detail, galleryType } = parsePostDetail(html, parsed.galleryId);
    detail.index = parsed.articleIndex;

    const commentPages: Comment[][] = [];
    let page = 1;
    while (true) {
      const rawComments = await fetchComments(parsed.galleryId, parsed.articleIndex, session, galleryType, page);
      const result = parseComments(rawComments);
      commentPages.push(result.comments);
      if (page >= result.totalPage || (rawComments.comments ?? []).length === 0) break;
      page++;
    }

    return renderDcPost(detail, commentPages.reverse().flat());
  },
};
