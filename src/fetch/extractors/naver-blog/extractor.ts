import { JSDOM, VirtualConsole } from "jsdom";
import { fetchDocument } from "../../fetch.js";
import { extractScopedMarkdown } from "../community.js";
import type { Extractor, FetchMetadata } from "../types.js";
import { parseNaverBlogDocument, parseNaverBlogUrl } from "./parse.js";

function postViewUrl(blogId: string, logNo: string): string {
  const url = new URL("https://blog.naver.com/PostView.naver");
  url.searchParams.set("blogId", blogId);
  url.searchParams.set("logNo", logNo);
  return url.toString();
}

export { parseNaverBlogUrl } from "./parse.js";

export const naverBlogExtractor: Extractor = {
  name: "naver-blog",
  matches: (url) => parseNaverBlogUrl(url) !== null,
  async extract(url) {
    const parsedUrl = parseNaverBlogUrl(new URL(url));
    if (!parsedUrl) throw new Error(`Not a Naver Blog post URL: ${url}`);

    const fetched = await fetchDocument(postViewUrl(parsedUrl.blogId, parsedUrl.logNo));
    const dom = new JSDOM(fetched.text, { url: fetched.finalUrl, virtualConsole: new VirtualConsole() });
    const parsedDocument = parseNaverBlogDocument(dom.window.document);
    const selector = parsedDocument.container?.matches(".se-main-container")
      ? ".se-main-container"
      : parsedDocument.container?.matches("#postViewArea")
        ? "#postViewArea"
        : ".post-view";
    const result = await extractScopedMarkdown(fetched.text, fetched.finalUrl, selector);
    const metadata: FetchMetadata = {
      ...(parsedDocument.author ? { author: parsedDocument.author } : {}),
      ...(parsedDocument.published ? { published: parsedDocument.published } : {}),
      ...(parsedDocument.description ? { description: parsedDocument.description } : {}),
      domain: "blog.naver.com",
      ...(result.wordCount > 0 ? { word_count: result.wordCount } : {}),
      status: fetched.status,
      ...(fetched.contentType ? { content_type: fetched.contentType } : {}),
      ...(fetched.finalUrl !== url ? { final_url: fetched.finalUrl } : {}),
    };

    return {
      title: parsedDocument.title || "Untitled",
      markdown: result.markdown,
      metadata,
      extractor: "naver-blog",
    };
  },
};
