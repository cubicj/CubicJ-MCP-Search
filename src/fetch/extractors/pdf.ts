import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { FetchedDocument } from "../fetch.js";
import type { ExtractResult, FetchMetadata } from "./types.js";

export const PDF_NO_TEXT_NOTICE = "[No text layer. This PDF is image-only.]";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

function hasPdfMagic(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((byte, index) => bytes[index] === byte);
}

export function isPdf(contentType: string | null, bytes: Uint8Array): boolean {
  if (contentType === "application/pdf") return true;
  return (contentType === null || contentType === "application/octet-stream") && hasPdfMagic(bytes);
}

interface TextItemLike {
  str: string;
  hasEOL: boolean;
  transform: number[];
}

function isTextItem(item: unknown): item is TextItemLike {
  return typeof item === "object" && item !== null && "str" in item && "transform" in item;
}

function assemblePageText(items: unknown[]): string {
  let text = "";
  let lastY: number | null = null;
  for (const item of items) {
    if (!isTextItem(item)) continue;
    const y = item.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 2 && !text.endsWith("\n")) text += "\n";
    if (item.str) {
      if (text.length > 0 && !/\s$/.test(text) && !text.endsWith("\n")) text += " ";
      text += item.str;
    }
    if (item.hasEOL) text += "\n";
    lastY = y;
  }
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parsePdfDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(
    /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:(Z)|([+-])(\d{2})(?:'?(\d{2})'?)?)?$/,
  );
  if (!match) return null;
  const [
    ,
    year,
    month = "01",
    day = "01",
    hour = "00",
    minute = "00",
    second = "00",
    utc,
    offsetSign,
    offsetHour,
    offsetMinute = "00",
  ] = match;
  const valid =
    Number(month) >= 1 &&
    Number(month) <= 12 &&
    Number(day) >= 1 &&
    Number(day) <= 31 &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59 &&
    (!offsetSign || (Number(offsetHour) <= 23 && Number(offsetMinute) <= 59));
  if (!valid) return null;

  const timestamp = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  if (utc) return `${timestamp}Z`;
  return offsetSign ? `${timestamp}${offsetSign}${offsetHour}:${offsetMinute}` : timestamp;
}

function fileName(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname.split("/").filter(Boolean).at(-1) ?? parsed.hostname;
}

export async function extractPdf(document: FetchedDocument): Promise<ExtractResult> {
  let loadingTask: ReturnType<typeof getDocument> | null = null;
  try {
    const parameters: NonNullable<Parameters<typeof getDocument>[0]> & { isEvalSupported: boolean } = {
      data: document.bytes,
      disableFontFace: true,
      isEvalSupported: false,
      useWorkerFetch: false,
      verbosity: 0,
    };
    loadingTask = getDocument(parameters);
    const pdf = await loadingTask.promise;
    const pageCount = pdf.numPages;
    const pages: string[] = [];
    for (let number = 1; number <= pageCount; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push(assemblePageText(content.items));
    }
    const info = ((await pdf.getMetadata()).info ?? {}) as Record<string, unknown>;
    const body = pages.map((text, index) => `## Page ${index + 1}\n\n${text}`.trimEnd()).join("\n\n");
    const wordCount = pages.join(" ").split(/\s+/).filter(Boolean).length;
    const title = typeof info.Title === "string" && info.Title.trim() ? info.Title.trim() : fileName(document.finalUrl);
    const author = typeof info.Author === "string" && info.Author.trim() ? info.Author.trim() : null;
    const published = parsePdfDate(info.CreationDate);

    const metadata: FetchMetadata = {
      ...(author ? { author } : {}),
      ...(published ? { published } : {}),
      page_count: pageCount,
      ...(wordCount > 0 ? { word_count: wordCount } : {}),
      status: document.status,
      ...(document.finalUrl !== document.requestedUrl ? { final_url: document.finalUrl } : {}),
      ...(document.contentType ? { content_type: document.contentType } : {}),
    };

    return { title, markdown: wordCount > 0 ? body : PDF_NO_TEXT_NOTICE, metadata, extractor: "pdf" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`PDF extraction failed: ${message}`);
  } finally {
    if (loadingTask) {
      try {
        await loadingTask.destroy();
      } catch {}
    }
  }
}
