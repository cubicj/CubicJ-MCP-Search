import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { extractPdf, isPdf, PDF_NO_TEXT_NOTICE, parsePdfDate } from "../../../src/fetch/extractors/pdf.js";
import type { FetchedDocument } from "../../../src/fetch/fetch.js";

function pdfDocument(name: string): FetchedDocument {
  const bytes = new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
  return {
    requestedUrl: `https://example.com/files/${name}`,
    finalUrl: `https://example.com/files/${name}`,
    status: 200,
    statusText: "OK",
    contentType: "application/pdf",
    bytes,
    text: new TextDecoder().decode(bytes),
  };
}

test("isPdf accepts the content type or the magic prefix", () => {
  const magic = new TextEncoder().encode("%PDF-1.7 ...");
  assert.equal(isPdf("application/pdf", new Uint8Array()), true);
  assert.equal(isPdf("application/octet-stream", magic), true);
  assert.equal(isPdf(null, magic), true);
  assert.equal(isPdf("application/octet-stream", new TextEncoder().encode("PK")), false);
  assert.equal(isPdf("text/html", magic), false);
});

test("parsePdfDate preserves timezone semantics", () => {
  assert.equal(parsePdfDate("D:20260822120000+09'30'"), "2026-08-22T12:00:00+09:30");
  assert.equal(parsePdfDate("D:20260822120000-07'00'"), "2026-08-22T12:00:00-07:00");
  assert.equal(parsePdfDate("D:20260822120000Z"), "2026-08-22T12:00:00Z");
  assert.equal(parsePdfDate("D:20260822120000"), "2026-08-22T12:00:00");
});

test("parsePdfDate rejects invalid date and time components", () => {
  const invalidDates = [
    "D:20269922120000Z",
    "D:20260022120000Z",
    "D:20260800120000Z",
    "D:20260832120000Z",
    "D:20260822240000Z",
    "D:20260822126000Z",
    "D:20260822120060Z",
  ];

  for (const value of invalidDates) assert.equal(parsePdfDate(value), null, value);
});

test("extracts pages, title, and metadata", async () => {
  const result = await extractPdf(pdfDocument("sample.pdf"));
  assert.equal(result.extractor, "pdf");
  assert.equal(result.title, "Sample Title");
  assert.match(result.markdown, /^## Page 1\n/);
  assert.match(result.markdown, /First page body text\./);
  assert.match(result.markdown, /\n\n## Page 2\n/);
  assert.match(result.markdown, /Second page body text\./);
  assert.equal(result.metadata.page_count, 2);
  assert.equal(result.metadata.author, "Fixture Author");
  assert.equal(result.metadata.published, "2026-08-22T12:00:00Z");
  assert.equal(result.metadata.status, 200);
  assert.equal(result.metadata.content_type, "application/pdf");
  assert.ok((result.metadata.word_count ?? 0) > 0);
});

test("image-only PDFs return a notice", async () => {
  const result = await extractPdf(pdfDocument("image-only.pdf"));
  assert.equal(result.markdown, PDF_NO_TEXT_NOTICE);
  assert.equal(result.title, "image-only.pdf");
  assert.equal(result.metadata.page_count, 1);
  assert.equal(result.metadata.word_count, undefined);
});

test("malformed PDFs throw", async () => {
  const bad = { ...pdfDocument("sample.pdf"), bytes: new TextEncoder().encode("%PDF-broken") };
  await assert.rejects(extractPdf(bad), (error: Error) => {
    assert.match(error.message, /^PDF extraction failed: /);
    return true;
  });
});

test("page extraction failures use the PDF error contract", async () => {
  const bad = pdfDocument("sample.pdf");
  const source = new TextDecoder("latin1").decode(bad.bytes);
  const corrupted = source.replace("/Kids [3 0 R 5 0 R]", "/Kids [9 0 R 5 0 R]");
  assert.notEqual(corrupted, source);
  bad.bytes = new TextEncoder().encode(corrupted);

  await assert.rejects(extractPdf(bad), (error: Error) => {
    assert.match(error.message, /^PDF extraction failed: /);
    return true;
  });
});
