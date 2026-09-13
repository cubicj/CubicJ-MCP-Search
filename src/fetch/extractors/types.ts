export interface FetchMetadata {
  author?: string;
  published?: string;
  description?: string;
  domain?: string;
  site?: string;
  word_count?: number;
  page_count?: number;
  views?: number;
  recommends?: number;
  comment_count?: number;
  status?: number;
  final_url?: string;
  content_type?: string;
}

export interface ExtractResult {
  title: string;
  markdown: string;
  metadata: FetchMetadata;
  extractor: string;
}

export interface Extractor {
  name: string;
  matches(url: URL): boolean;
  extract(url: string): Promise<ExtractResult>;
}
