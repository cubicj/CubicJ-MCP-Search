import { describe, expect, test } from "vitest";
import { tokensPerUrl } from "../../src/brave/budget.js";

describe("tokensPerUrl", () => {
  test("allocates 2048 tokens per URL for the defaults", () => {
    expect(tokensPerUrl(8192, 8)).toBe(2048);
  });

  test("clamps a single URL to 8192 tokens", () => {
    expect(tokensPerUrl(32768, 1)).toBe(8192);
  });

  test("clamps a small share to 512 tokens", () => {
    expect(tokensPerUrl(1024, 20)).toBe(512);
  });

  test("rounds up before doubling a fractional share", () => {
    expect(tokensPerUrl(4096, 5)).toBe(1640);
  });
});
