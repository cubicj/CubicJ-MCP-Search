import { URLS, USER_AGENT } from "./endpoints.js";
import type { RawCommentPage } from "./parse.js";

export interface SessionData {
  cookies: string;
  esno: string;
}

function extractCookies(response: Response): string {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

function extractEsno(html: string): string {
  const match = html.match(/name=['"]e_s_n_o['"][^>]*value=['"]([^'"]+)['"]/);
  if (!match) throw new Error("Failed to extract e_s_n_o token");
  return match[1];
}

const defaultHeaders = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const REQUEST_TIMEOUT_MS = 15_000;

function extractRedirectUrl(body: string): string | null {
  const match = body.match(/location\.replace\("([^"]+)"\)/);
  return match ? match[1] : null;
}

function mergeQueryParams(redirectUrl: string, originalUrl: string): string {
  const redirect = new URL(redirectUrl);
  const original = new URL(originalUrl);
  for (const [key, value] of original.searchParams) {
    if (!redirect.searchParams.has(key)) {
      redirect.searchParams.set(key, value);
    }
  }
  return redirect.toString();
}

export async function fetchPage(url: string): Promise<{ html: string; session: SessionData; finalUrl: string }> {
  const res = await fetch(url, { headers: defaultHeaders, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const html = await res.text();

  const rawRedirect = extractRedirectUrl(html);
  if (rawRedirect) {
    const redirectUrl = mergeQueryParams(rawRedirect, url);
    const res2 = await fetch(redirectUrl, { headers: defaultHeaders, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res2.ok) throw new Error(`HTTP ${res2.status}: ${redirectUrl}`);
    const html2 = await res2.text();
    return {
      html: html2,
      session: { cookies: extractCookies(res2), esno: extractEsno(html2) },
      finalUrl: redirectUrl,
    };
  }

  return {
    html,
    session: { cookies: extractCookies(res), esno: extractEsno(html) },
    finalUrl: url,
  };
}

export async function fetchComments(
  galleryId: string,
  postNo: number,
  session: SessionData,
  galleryType: string,
  page = 1,
): Promise<RawCommentPage> {
  const body = new URLSearchParams({
    id: galleryId,
    no: postNo.toString(),
    cmt_id: galleryId,
    cmt_no: postNo.toString(),
    focus_cno: "",
    focus_pno: "",
    e_s_n_o: session.esno,
    comment_page: page.toString(),
    sort: "",
    prevCnt: "",
    board_type: "",
    _GALLTYPE_: galleryType,
  });

  const res = await fetch(URLS.COMMENT, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: `${URLS.POST_VIEW}?id=${galleryId}&no=${postNo}`,
      Cookie: session.cookies,
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`Comment API HTTP ${res.status}`);
  return (await res.json()) as RawCommentPage;
}
