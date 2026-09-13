const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

const ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const ACCEPT_LANGUAGE = "ko,en;q=0.9";

const CHARSET_ALIASES: Record<string, string> = {
  ms949: "euc-kr",
  cp949: "euc-kr",
  "x-windows-949": "euc-kr",
  ks_c_5601: "euc-kr",
  "ks_c_5601-1987": "euc-kr",
  ms932: "shift_jis",
  cp932: "shift_jis",
  ms936: "gbk",
  cp936: "gbk",
  ms950: "big5",
  cp950: "big5",
};

interface HostHeaderOverride {
  host: string;
  headers: Record<string, string | null>;
}

const HOST_HEADER_OVERRIDES: HostHeaderOverride[] = [{ host: "brunch.co.kr", headers: { "User-Agent": null } }];

export interface FetchedDocument {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  statusText: string;
  contentType: string | null;
  bytes: Uint8Array;
  text: string;
}

export interface FetchDocumentInit {
  headers?: Record<string, string>;
}

function parseContentType(header: string | null): string | null {
  if (header === null) return null;
  const mediaType = header.split(";", 1)[0].trim().toLowerCase();
  return mediaType || null;
}

function parseCharset(value: string): string | null {
  const match = value.match(/charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s;"']+))/i);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function readAttribute(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, "i");
  const match = tag.match(pattern);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function sniffCharset(bytes: Uint8Array): string | null {
  const prefix = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));

  for (const match of prefix.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const charset = readAttribute(tag, "charset");
    if (charset) return charset;

    const httpEquiv = readAttribute(tag, "http-equiv");
    const content = readAttribute(tag, "content");
    if (httpEquiv?.toLowerCase() === "content-type" && content) {
      const contentCharset = parseCharset(content);
      if (contentCharset) return contentCharset;
    }
  }

  const xmlDeclaration = prefix.match(/<\?xml\b[^>]*\bencoding\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*\?>/i);
  return xmlDeclaration?.[1] ?? xmlDeclaration?.[2] ?? null;
}

function canSniffCharset(contentType: string | null): boolean {
  return (
    contentType === null ||
    contentType === "text/html" ||
    contentType === "application/xhtml+xml" ||
    contentType === "application/xml" ||
    contentType === "text/xml" ||
    contentType.endsWith("+xml")
  );
}

function normalizeCharset(charset: string): string {
  const label = charset.trim().toLowerCase();
  return CHARSET_ALIASES[label] ?? label;
}

function decode(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(normalizeCharset(charset)).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function describeFetchError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(String(error));
  const cause = error.cause as { code?: string; message?: string } | undefined;
  if (!cause?.message) return error;
  const code = cause.code ? `${cause.code} ` : "";
  return new Error(`${error.message}: ${code}${cause.message}`);
}

function matchesHost(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`);
}

export function resolveRequestHeaders(url: string, overrides?: Record<string, string>): Headers {
  const headers = new Headers({
    "User-Agent": USER_AGENT,
    Accept: ACCEPT,
    "Accept-Language": ACCEPT_LANGUAGE,
  });
  const hostname = new URL(url).hostname;
  for (const override of HOST_HEADER_OVERRIDES) {
    if (!matchesHost(hostname, override.host)) continue;
    for (const [name, value] of Object.entries(override.headers)) {
      if (value === null) headers.delete(name);
      else headers.set(name, value);
    }
  }
  for (const [name, value] of Object.entries(overrides ?? {})) {
    headers.set(name, value);
  }
  return headers;
}

export async function fetchDocument(url: string, init?: FetchDocumentInit): Promise<FetchedDocument> {
  const headers = resolveRequestHeaders(url, init?.headers);

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    throw describeFetchError(error);
  }
  const contentTypeHeader = response.headers.get("content-type");
  const contentType = parseContentType(contentTypeHeader);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const headerCharset = contentTypeHeader ? parseCharset(contentTypeHeader) : null;
  const charset = headerCharset ?? (canSniffCharset(contentType) ? sniffCharset(bytes) : null) ?? "utf-8";

  return {
    requestedUrl: url,
    finalUrl: response.url,
    status: response.status,
    statusText: response.statusText,
    contentType,
    bytes,
    text: decode(bytes, charset),
  };
}
