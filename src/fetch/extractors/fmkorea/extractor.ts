import { load } from "cheerio";
import { fetchDocument } from "../../fetch.js";
import { extractScopedMarkdown, renderComments } from "../community.js";
import type { Extractor, FetchMetadata } from "../types.js";
import { parseFmkoreaPost, parseFmkoreaUrl } from "./parse.js";

export { parseFmkoreaUrl } from "./parse.js";

export const fmkoreaExtractor: Extractor = {
  name: "fmkorea",
  matches: (url) => parseFmkoreaUrl(url) !== null,
  async extract(url) {
    const post = parseFmkoreaUrl(new URL(url));
    if (!post) throw new Error(`Not an FMKorea post URL: ${url}`);

    const canonicalUrl = `https://www.fmkorea.com/${post.id}`;
    const fetched = await fetchDocument(canonicalUrl);
    const parsed = parseFmkoreaPost(fetched.text);
    const $ = load(fetched.text);
    const bodySelector = $("article .xe_content").length > 0 ? "article .xe_content" : ".rd_body";
    const body = await extractScopedMarkdown(fetched.text, fetched.finalUrl, bodySelector);
    const commentCount = parsed.bestComments.length + parsed.comments.length;
    const metadata: FetchMetadata = {
      ...(parsed.author ? { author: parsed.author } : {}),
      ...(parsed.published ? { published: parsed.published } : {}),
      ...(parsed.views !== null ? { views: parsed.views } : {}),
      ...(parsed.recommends !== null ? { recommends: parsed.recommends } : {}),
      comment_count: commentCount,
      domain: "fmkorea.com",
      site: "에펨코리아",
      ...(body.wordCount > 0 ? { word_count: body.wordCount } : {}),
      status: fetched.status,
      ...(fetched.contentType ? { content_type: fetched.contentType } : {}),
      ...(fetched.finalUrl !== canonicalUrl ? { final_url: fetched.finalUrl } : {}),
    };
    const sections = [
      body.markdown,
      "---",
      renderComments(parsed.bestComments, "Best comments"),
      renderComments(parsed.comments, "Comments"),
    ].filter(Boolean);

    return {
      title: parsed.title || "Untitled",
      markdown: sections.join("\n\n"),
      metadata,
      extractor: "fmkorea",
    };
  },
};
