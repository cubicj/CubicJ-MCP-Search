import { load } from "cheerio";
import type { ArticleDetail, Comment, CommentListResult } from "./types.js";

export interface RawCommentPage {
  total_cnt?: string | number;
  comments?: Array<{
    no?: string | number;
    memo?: string;
    name?: string;
    user_id?: string;
    ip?: string;
    reg_date?: string;
    del_yn?: string;
  }>;
}

function parseDcDate(value: string): Date {
  const text = value.trim();
  const short = text.match(/^(\d{2})\.(\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
  if (short) {
    return new Date(`${new Date().getFullYear()}-${short[1]}-${short[2]} ${short[3]}`);
  }
  return new Date(text);
}

export function parsePostDetail(html: string, galleryId: string): { detail: ArticleDetail; galleryType: string } {
  const $ = load(html);

  const $head = $(".gallview_head").first();
  const $writer = $("div.view_content_wrap .gall_writer, .gallview_head .gall_writer").first();
  const galleryType = html.match(/_GALLERY_TYPE_\s*=\s*['"]([^'"]+)['"]/)?.[1] || "G";
  const galleryName = $("title").text().split(" - ")[1]?.trim() || "";

  const viewCountText = $head.find(".gall_count").first().text();
  const recommendText = $head.find(".gall_reply_num").first().text();

  const detail: ArticleDetail = {
    galleryId,
    galleryName,
    index: parseInt(html.match(/no=(\d+)/)?.[1] || "0", 10),
    title: $(".title_subject").text().trim(),
    header: $(".title_headtext").text().trim() || null,
    time: parseDcDate($head.find(".gall_date").attr("title") || ""),
    user: {
      name: $writer.attr("data-nick") || "",
      userId: $writer.attr("data-uid") || null,
      ip: $writer.attr("data-ip") || null,
    },
    view: parseInt(viewCountText.replace(/[^0-9]/g, ""), 10) || 0,
    recommend: parseInt(recommendText.replace(/[^0-9]/g, ""), 10) || 0,
    body: $(".write_div").html()?.trim() || "",
    isMinor: galleryType === "M",
  };

  return { detail, galleryType };
}

export function parseComments(data: RawCommentPage): CommentListResult {
  const comments: Comment[] = (data.comments ?? [])
    .filter((c) => c.del_yn !== "Y" && parseInt(String(c.no ?? "0"), 10) > 0 && c.reg_date)
    .map((c) => ({
      index: parseInt(String(c.no), 10),
      body: c.memo || "",
      user: {
        name: c.name || "",
        userId: c.user_id || null,
        ip: c.ip || null,
      },
      time: parseDcDate(c.reg_date || ""),
    }));

  return {
    totalPage: Math.ceil((parseInt(String(data.total_cnt ?? "0"), 10) || 0) / 100),
    comments,
  };
}
