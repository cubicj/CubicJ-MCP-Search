import { load } from "cheerio";
import type { CommunityComment } from "../community.js";

export interface ParsedRuliwebPost {
  title: string;
  author: string | null;
  published: string | null;
  views: number | null;
  recommends: number | null;
  comments: CommunityComment[];
}

const RULIWEB_HOSTS = new Set(["bbs.ruliweb.com", "m.ruliweb.com"]);

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeMultiline(value: string): string {
  return value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .join("\n");
}

function parseNumber(value: string): number | null {
  const normalized = value.replace(/,/g, "").trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseRuliwebUrl(url: URL): { section: string; board: string | null; id: string } | null {
  if (!RULIWEB_HOSTS.has(url.hostname)) return null;

  const boardMatch = url.pathname.match(/^\/([^/]+)\/board\/([^/]+)\/read\/(\d+)$/);
  if (boardMatch) return { section: boardMatch[1], board: boardMatch[2], id: boardMatch[3] };

  const sectionMatch = url.pathname.match(/^\/([^/]+)\/read\/(\d+)$/);
  if (sectionMatch) return { section: sectionMatch[1], board: null, id: sectionMatch[2] };

  return null;
}

export function parseRuliwebPost(html: string): ParsedRuliwebPost {
  const $ = load(html);
  const title = normalizeText($(".subject_inner_text").first().text());
  const author = normalizeText($(".user_view .nick").first().text()) || null;
  const info = $(".user_info p")
    .toArray()
    .map((element) => normalizeText($(element).text()));
  const publishedText = info.find((text) => text.includes("작성일"));
  const published = publishedText?.match(/작성일\s*(.+)$/)?.[1]?.trim() || null;
  const viewsText = info.find((text) => text.includes("조회"))?.match(/조회\s*([\d,]+)/)?.[1];
  const recommendsText = info.find((text) => text.includes("추천"))?.match(/추천\s*([\d,]+)/)?.[1];
  const commentElements = $(".comment_element").toArray();
  const commentIdCounts = new Map<string, number>();
  for (const element of commentElements) {
    const id = $(element).attr("id");
    if (id) commentIdCounts.set(id, (commentIdCounts.get(id) ?? 0) + 1);
  }
  const hasCommentIds = commentIdCounts.size > 0;
  const seenCommentIds = new Set<string>();
  const comments = commentElements
    .filter((element) => {
      const $row = $(element);
      const id = $row.attr("id");
      const isBest = $row.hasClass("best") || $row.parents(".comment_view.best").length > 0;

      if (!hasCommentIds) return !isBest;
      if (!id) return true;
      if ((commentIdCounts.get(id) ?? 0) > 1 && isBest) return false;
      if (seenCommentIds.has(id)) return false;
      seenCommentIds.add(id);
      return true;
    })
    .map((element): CommunityComment => {
      const $row = $(element);
      const author = normalizeText($row.find(".nick").first().text()) || "Unknown";
      const time = normalizeText($row.find(".time").first().text());
      const $wrapper = $row.find(".text_wrapper").first();
      const fragments: string[] = [];

      $wrapper.find(".text, img").each((_, content) => {
        const $content = $(content);
        if (content.tagName === "img") {
          if ($content.parents(".text").length === 0) fragments.push("[image]");
          return;
        }

        const $text = $content.clone();
        $text.find("br").replaceWith("\n");
        $text.find("img").replaceWith("\n[image]\n");
        const text = normalizeMultiline($text.text());
        if (text) fragments.push(text);
      });

      return {
        author,
        time,
        text: fragments.join("\n").trim(),
        depth: $row.hasClass("child") ? 1 : 0,
      };
    });

  return {
    title,
    author,
    published,
    views: viewsText ? parseNumber(viewsText) : null,
    recommends: recommendsText ? parseNumber(recommendsText) : null,
    comments,
  };
}
