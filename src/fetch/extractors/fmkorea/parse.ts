import { load } from "cheerio";
import type { CommunityComment } from "../community.js";

export interface ParsedFmkoreaPost {
  title: string;
  author: string | null;
  published: string | null;
  views: number | null;
  recommends: number | null;
  bestComments: CommunityComment[];
  comments: CommunityComment[];
}

const FMKOREA_HOSTS = new Set(["www.fmkorea.com", "m.fmkorea.com", "fmkorea.com"]);

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

function parseCommentDepth(className: string, isReply: boolean): number {
  const depthClass = className
    .split(/\s+/)
    .map((name) => name.match(/^comment-(\d{1,2})$/)?.[1])
    .find((value) => value !== undefined);
  if (depthClass) return Math.max(0, Number(depthClass) - 1);
  return isReply ? 1 : 0;
}

export function parseFmkoreaUrl(url: URL): { id: string } | null {
  if (!FMKOREA_HOSTS.has(url.hostname)) return null;

  const pathMatch = url.pathname.match(/^\/(?:[^/]+\/)?(\d+)$/);
  if (pathMatch) return { id: pathMatch[1] };

  if (url.pathname !== "/index.php") return null;
  const id = url.searchParams.get("document_srl");
  return id && /^\d+$/.test(id) ? { id } : null;
}

export function parseFmkoreaPost(html: string): ParsedFmkoreaPost {
  const $ = load(html);
  const title = normalizeText($(".np_18px span").last().text()) || normalizeText($("h1").first().text());
  const author = normalizeText($(".rd_hd .member_plate").first().text()) || null;
  const published =
    $(".rd_hd .date")
      .toArray()
      .map((element) => normalizeText($(element).text()))
      .find((text) => /\d{4}\.\d{2}\.\d{2}/.test(text)) ?? null;
  const views = parseNumber($(".side.fr b").first().text());
  const recommends = parseNumber($(".btn_img.vote_up b").first().text());
  const parsedComments = $(".fdb_itm")
    .toArray()
    .map((element) => {
      const $row = $(element);
      const $content = $row.find(".comment-content").first().clone();
      $content.find("br").replaceWith("\n");
      const $mention = $content.find("a.findParent").first();
      if ($mention.length > 0) {
        const name = normalizeText($mention.text()).replace(/^@/, "");
        $mention.replaceWith(name ? `@${name} ` : "");
      }

      return {
        comment: {
          author: normalizeText($row.find(".member_plate").first().text()) || "Unknown",
          time: normalizeText($row.find(".date").first().text()),
          text: normalizeMultiline($content.text()),
          depth: parseCommentDepth($row.attr("class") ?? "", $row.hasClass("re")),
        },
        best: $row.hasClass("comment_best"),
      };
    });

  return {
    title,
    author,
    published,
    views,
    recommends,
    bestComments: parsedComments.filter(({ best }) => best).map(({ comment }) => comment),
    comments: parsedComments.filter(({ best }) => !best).map(({ comment }) => comment),
  };
}
