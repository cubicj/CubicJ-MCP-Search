export interface ParsedNaverBlogUrl {
  blogId: string;
  logNo: string;
}

const NAVER_BLOG_HOSTS = new Set(["blog.naver.com", "m.blog.naver.com"]);

export function parseNaverBlogUrl(url: URL): ParsedNaverBlogUrl | null {
  if (!NAVER_BLOG_HOSTS.has(url.hostname)) return null;

  if (/^\/PostView\.(?:naver|nhn)$/.test(url.pathname)) {
    const blogId = url.searchParams.get("blogId");
    const logNo = url.searchParams.get("logNo");
    if (!blogId || !logNo || !/^\d+$/.test(logNo)) return null;
    return { blogId, logNo };
  }

  const pathMatch = url.pathname.match(/^\/([^/]+)\/(\d+)$/);
  if (!pathMatch) return null;

  try {
    const blogId = decodeURIComponent(pathMatch[1]);
    if (blogId.includes("/")) return null;
    return { blogId, logNo: pathMatch[2] };
  } catch {
    return null;
  }
}

function attribute(document: Document, selector: string, name: string): string | null {
  return document.querySelector(selector)?.getAttribute(name)?.trim() || null;
}

function text(document: Document, selector: string): string | null {
  return document.querySelector(selector)?.textContent?.trim() || null;
}

export function parseNaverBlogDocument(document: Document) {
  const title =
    attribute(document, 'meta[property="og:title"]', "content") ??
    text(document, ".se-title-text") ??
    text(document, "title")
      ?.replace(/\s*:\s*네이버 블로그\s*$/, "")
      .trim() ??
    null;

  return {
    title,
    author: attribute(document, 'meta[property="naverblog:nickname"]', "content") ?? text(document, ".nick"),
    published: text(document, ".se_publishDate"),
    description: attribute(document, 'meta[property="og:description"]', "content"),
    container:
      document.querySelector(".se-main-container") ??
      document.querySelector("#postViewArea") ??
      document.querySelector(".post-view"),
  };
}
