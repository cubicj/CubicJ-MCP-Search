import type { FetchMetadata } from "./extractors/types.js";

export function sliceContent(text: string, startIndex: number, maxLength: number): string {
  const isHighSurrogate = (index: number) => {
    const code = text.charCodeAt(index);
    return code >= 0xd800 && code <= 0xdbff;
  };
  const isLowSurrogate = (index: number) => {
    const code = text.charCodeAt(index);
    return code >= 0xdc00 && code <= 0xdfff;
  };

  let start = startIndex;
  let end = startIndex + maxLength;
  if (start > 0 && start < text.length && isLowSurrogate(start) && isHighSurrogate(start - 1)) {
    start += 1;
  }
  if (end > start && end < text.length && isHighSurrogate(end - 1) && isLowSurrogate(end)) {
    end += 1;
  }
  return text.substring(start, end);
}

export interface PagedContent {
  content: string;
  total_length: number;
  truncated: boolean;
  next_start_index: number;
}

export function paginate(text: string, startIndex: number, maxLength: number): PagedContent {
  return {
    content: sliceContent(text, startIndex, maxLength),
    total_length: text.length,
    truncated: startIndex + maxLength < text.length,
    next_start_index: startIndex + maxLength,
  };
}

function truncationNotice(paged: PagedContent): string {
  return `\n\n[Truncated. Total length: ${paged.total_length} characters. Continue with start_index=${paged.next_start_index}.]`;
}

export function buildMarkdownText(title: string, url: string, metadata: FetchMetadata, paged: PagedContent): string {
  const metadataLines = [
    ["Author", metadata.author],
    ["Published", metadata.published],
    ["Description", metadata.description],
    ["Site", metadata.site],
    ["Domain", metadata.domain],
    ["Views", metadata.views],
    ["Recommends", metadata.recommends],
    ["Comments", metadata.comment_count],
    ["Word count", metadata.word_count],
    ["Pages", metadata.page_count],
    ["Status", metadata.status],
    ["Final URL", metadata.final_url],
    ["Content type", metadata.content_type],
  ]
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([label, value]) => `**${label}**: ${value}`);
  const header = [`# ${title}`, "", `**URL**: ${url}`, ...metadataLines].join("\n");
  const text = `${header}\n\n${paged.content}`;
  return paged.truncated ? `${text}${truncationNotice(paged)}` : text;
}

export function buildRawText(paged: PagedContent): string {
  return paged.truncated ? `${paged.content}${truncationNotice(paged)}` : paged.content;
}
