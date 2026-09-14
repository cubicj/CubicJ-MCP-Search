export function tokensPerUrl(maxTokens: number, count: number): number {
  return Math.min(8192, Math.max(512, 2 * Math.ceil(maxTokens / count)));
}
