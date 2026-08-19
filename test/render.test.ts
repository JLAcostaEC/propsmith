import { describe, expect, it } from "vitest";

import { alignTable, normalizeTable, sameContent } from "../src/render/align.js";
import { assertNoHtml, codeSpan, escapeCell } from "../src/render/escape.js";

const UNALIGNED = ["| Name | Type |", "| --- | --- |", "| `size` | `Sizes` |", ""].join("\n");

describe("escaping", () => {
  it("pulls every pipe out of the code span", () => {
    expect(codeSpan("'a' | 'b'")).toBe("`'a'` &#124; `'b'`");
  });

  it("turns a bare pipe in a cell into an entity", () => {
    expect(escapeCell("a | b")).toBe("a &#124; b");
  });

  it("leaves an already-emitted entity alone", () => {
    expect(escapeCell("`'a'` &#124; `'b'`")).toBe("`'a'` &#124; `'b'`");
  });
});

describe("the no-HTML rule", () => {
  it("rejects a tag in live markdown", () => {
    expect(() => assertNoHtml("a <br> b", "test")).toThrow(/HTML tag/);
    expect(() => assertNoHtml("<div>", "test")).toThrow(/HTML tag/);
  });

  it("allows a generic inside a code span, which is literal text there", () => {
    expect(() => assertNoHtml("`Array<string>`", "test")).not.toThrow();
    expect(() => assertNoHtml("`Omit<FSInput, 'a'>`", "test")).not.toThrow();
    expect(() => assertNoHtml("``Every attribute of `<button>` ``", "test")).not.toThrow();
  });

  it("still catches a tag that escapes the span", () => {
    expect(() => assertNoHtml("`Array<string>` and <br>", "test")).toThrow(/HTML tag/);
  });

  it("does not treat an unclosed backtick as a span", () => {
    expect(() => assertNoHtml("` <br>", "test")).toThrow(/HTML tag/);
  });
});

describe("alignment, and the comparison that survives it", () => {
  it("pads every column to its widest cell", () => {
    const aligned = alignTable(UNALIGNED);
    const [header, separator, body] = aligned.split("\n");

    expect(header).toBe("| Name   | Type    |");
    expect(separator).toBe("| ------ | ------- |");
    expect(body).toBe("| `size` | `Sizes` |");
  });

  it("is idempotent", () => {
    expect(alignTable(alignTable(UNALIGNED))).toBe(alignTable(UNALIGNED));
  });

  it("leaves prose and headings alone", () => {
    const mixed = "## Heading\n\ntext\n\n| a | b |\n| - | - |\n";
    expect(alignTable(mixed)).toContain("## Heading");
    expect(alignTable(mixed)).toContain("text");
  });

  it("ignores a pipe-delimited block with no separator row", () => {
    const notATable = "| just | prose |\n| more | prose |\n";
    expect(alignTable(notATable)).toBe(notATable);
  });

  it("treats padded and squeezed tables as the same content", () => {
    const squeezed = "|Name|Type|\n|---|---|\n|`size`|`Sizes`|";
    expect(sameContent(alignTable(UNALIGNED), squeezed)).toBe(true);
    expect(normalizeTable(alignTable(UNALIGNED))).toBe(normalizeTable(squeezed));
  });

  it("still notices a real change", () => {
    const different = "| Name | Type |\n| --- | --- |\n| `size` | `number` |";
    expect(sameContent(UNALIGNED, different)).toBe(false);
  });

  it("ignores the blank lines a region is wrapped in", () => {
    expect(sameContent("\n\n| a |\n| - |\n\n", "| a |\n| - |")).toBe(true);
  });
});
