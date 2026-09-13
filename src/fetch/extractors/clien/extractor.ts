import { fetchDocument } from "../../fetch.js";
import { extractScopedMarkdown, renderComments } from "../community.js";
import type { Extractor, FetchMetadata } from "../types.js";
import { parseClienPost, parseClienUrl } from "./parse.js";

export { parseClienUrl } from "./parse.js";

export const clienExtractor: Extractor = {
  name: "clien",
  matches: (url) => parseClienUrl(url) !== null,
  async extract(url) {
    if (!parseClienUrl(new URL(url))) throw new Error(`Not a Clien post URL: ${url}`);

    const fetched = await fetchDocument(url);
    const parsed = parseClienPost(fetched.text);
    const body = await extractScopedMarkdown(fetched.text, fetched.finalUrl, ".post_article");
    const metadata: FetchMetadata = {
      ...(parsed.author ? { author: parsed.author } : {}),
      ...(parsed.published ? { published: parsed.published } : {}),
      ...(parsed.views !== null ? { views: parsed.views } : {}),
      ...(parsed.recommends !== null ? { recommends: parsed.recommends } : {}),
      comment_count: parsed.comments.length,
      domain: "clien.net",
      site: "클리앙",
      ...(body.wordCount > 0 ? { word_count: body.wordCount } : {}),
      status: fetched.status,
      ...(fetched.contentType ? { content_type: fetched.contentType } : {}),
      ...(fetched.finalUrl !== url ? { final_url: fetched.finalUrl } : {}),
    };

    return {
      title: parsed.title || "Untitled",
      markdown: `${body.markdown}\n\n---\n\n${renderComments(parsed.comments)}`,
      metadata,
      extractor: "clien",
    };
  },
};
