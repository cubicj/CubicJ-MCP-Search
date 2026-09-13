import { blueskyExtractor } from "./bluesky/extractor.js";
import { clienExtractor } from "./clien/extractor.js";
import { dcinsideExtractor } from "./dcinside/extractor.js";
import { fmkoreaExtractor } from "./fmkorea/extractor.js";
import { genericExtractor } from "./generic.js";
import { githubExtractor } from "./github/extractor.js";
import { namuWikiExtractor } from "./namu-wiki/extractor.js";
import { naverBlogExtractor } from "./naver-blog/extractor.js";
import { ruliwebExtractor } from "./ruliweb/extractor.js";
import type { Extractor } from "./types.js";

const siteExtractors: Extractor[] = [
  dcinsideExtractor,
  naverBlogExtractor,
  githubExtractor,
  blueskyExtractor,
  clienExtractor,
  ruliwebExtractor,
  fmkoreaExtractor,
  namuWikiExtractor,
];

export function selectExtractor(url: string): Extractor {
  const parsed = new URL(url);
  return siteExtractors.find((extractor) => extractor.matches(parsed)) ?? genericExtractor;
}
