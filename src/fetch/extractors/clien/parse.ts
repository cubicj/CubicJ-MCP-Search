import { load } from "cheerio";
import type { CommunityComment } from "../community.js";

export interface ParsedClienPost {
  title: string;
  author: string | null;
  published: string | null;
  views: number | null;
  recommends: number | null;
  comments: CommunityComment[];
}

const CLIEN_HOSTS = new Set(["www.clien.net", "m.clien.net", "clien.net"]);

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseNumber(value: string): number | null {
  const normalized = value.replace(/,/g, "").trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseClienUrl(url: URL): { board: string; id: string } | null {
  if (!CLIEN_HOSTS.has(url.hostname)) return null;
  const match = url.pathname.match(/^\/service\/board\/([^/]+)\/(\d+)$/);
  if (!match) return null;
  return { board: match[1], id: match[2] };
}

export function parseClienPost(html: string): ParsedClienPost {
  const $ = load(html);
  const subject = normalizeText($(".post_subject span:not(.post_category)").first().text());
  const fallbackTitle = normalizeText($("title").first().text()).replace(/\s*:\s*클리앙\s*$/, "");
  const $author = $(".post_author .nickname, .post_info .nickname").first();
  const author = normalizeText($author.text()) || $author.find("img[alt]").first().attr("alt")?.trim() || null;
  const publishedText = normalizeText($(".post_author .view_count.date").first().text());
  const fallbackPublished = $(".post_author .view_count")
    .toArray()
    .map((element) => normalizeText($(element).text()))
    .find((text) => /\d{4}-\d{2}-\d{2}/.test(text));
  const viewsText = $(".post_author .view_count")
    .toArray()
    .map((element) => normalizeText($(element).text()))
    .find((text) => /^[\d,]+$/.test(text));
  const recommendsText =
    $(".symph_count")
      .first()
      .text()
      .match(/[\d,]+/)?.[0] ?? "";
  const comments = $(".comment_row")
    .toArray()
    .map((element): CommunityComment => {
      const $row = $(element);
      const $nickname = $row.find(".nickname").first();
      const commentAuthor =
        normalizeText($nickname.text()) || $nickname.find("img[alt]").first().attr("alt")?.trim() || "Unknown";
      const $commentTime = $row.find(".comment_time").first();
      const timestamp = $commentTime.find(".timestamp").first().text().trim();
      const time = timestamp || $commentTime.text().trim();
      const $content = $row.find(".comment_content").first().clone();
      $content.find("br").replaceWith("\n");
      $content.find("img[alt]").each((_, image) => {
        $(image).replaceWith($(image).attr("alt") ?? "");
      });
      const text = $content
        .text()
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => normalizeText(line))
        .join("\n")
        .trim();

      return {
        author: commentAuthor,
        time,
        text,
        depth: $row.hasClass("re") ? 1 : 0,
      };
    });

  return {
    title: subject || fallbackTitle,
    author,
    published: publishedText || fallbackPublished || null,
    views: viewsText ? parseNumber(viewsText) : null,
    recommends: parseNumber(recommendsText),
    comments,
  };
}
