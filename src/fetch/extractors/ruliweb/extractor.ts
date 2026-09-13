import { fetchDocument } from "../../fetch.js";
import { extractScopedMarkdown, renderComments } from "../community.js";
import type { Extractor, FetchMetadata } from "../types.js";
import { parseRuliwebPost, parseRuliwebUrl } from "./parse.js";

export { parseRuliwebUrl } from "./parse.js";

export const ruliwebExtractor: Extractor = {
  name: "ruliweb",
  matches: (url) => parseRuliwebUrl(url) !== null,
  async extract(url) {
    if (!parseRuliwebUrl(new URL(url))) throw new Error(`Not a Ruliweb post URL: ${url}`);

    const fetched = await fetchDocument(url);
    const parsed = parseRuliwebPost(fetched.text);
    const body = await extractScopedMarkdown(fetched.text, fetched.finalUrl, ".view_content");
    const metadata: FetchMetadata = {
      ...(parsed.author ? { author: parsed.author } : {}),
      ...(parsed.published ? { published: parsed.published } : {}),
      ...(parsed.views !== null ? { views: parsed.views } : {}),
      ...(parsed.recommends !== null ? { recommends: parsed.recommends } : {}),
      comment_count: parsed.comments.length,
      domain: "ruliweb.com",
      site: "루리웹",
      ...(body.wordCount > 0 ? { word_count: body.wordCount } : {}),
      status: fetched.status,
      ...(fetched.contentType ? { content_type: fetched.contentType } : {}),
      ...(fetched.finalUrl !== url ? { final_url: fetched.finalUrl } : {}),
    };

    return {
      title: parsed.title || "Untitled",
      markdown: `${body.markdown}\n\n---\n\n${renderComments(parsed.comments)}`,
      metadata,
      extractor: "ruliweb",
    };
  },
};
