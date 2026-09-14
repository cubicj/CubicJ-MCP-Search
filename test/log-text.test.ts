import { describe, expect, test } from "vitest";
import { clip, printable } from "../src/log-text.js";

describe("clip", () => {
  test("preserves values through 200 characters", () => {
    expect(clip("")).toBe("");
    expect(clip("가".repeat(200))).toBe("가".repeat(200));
  });

  test("truncates longer values with an ellipsis", () => {
    expect(clip("가".repeat(201))).toBe(`${"가".repeat(200)}…`);
  });
});

describe("printable", () => {
  test("replaces every ASCII control character and DEL", () => {
    const controls = Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)).join("");
    expect(printable(`${controls}\x7f`)).toBe("?".repeat(33));
  });

  test("preserves printable text, quotes, backslashes, and Unicode", () => {
    const text = 'coffee 가 😀 " \\';
    expect(printable(text)).toBe(text);
  });
});
