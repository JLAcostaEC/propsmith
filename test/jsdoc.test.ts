/**
 * JSDoc reading, on the shapes oxc actually produces.
 *
 * `parseJSDoc` is handed the raw comment value — the text between the
 * delimiters, leading star included — so every fixture below is written that
 * way, and the first test pins that assumption against the real parser.
 * `attachComments` is driven with nodes and comments from `parseSync`, which is
 * exactly what `extractFile` feeds it.
 */

import { parseSync } from "oxc-parser";
import type { TSInterfaceDeclaration, TSSignature } from "oxc-parser";
import { describe, expect, it } from "vitest";

import { attachComments, type ParsedJSDoc, parseJSDoc } from "../src/extract/jsdoc.js";

/** A source string, written line by line so the offsets under test stay visible. */
function source(...lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

/** Parse `code` and attach its comments to the members of its first interface. */
function attach(code: string): {
  members: readonly TSSignature[];
  docs: Map<TSSignature, ParsedJSDoc>;
} {
  const parsed = parseSync("props.ts", code, { lang: "ts" });
  expect(parsed.errors).toEqual([]);

  const declaration = parsed.program.body[0] as TSInterfaceDeclaration;
  const members = declaration.body.body;
  return { members, docs: attachComments(members, parsed.comments, code) };
}

describe("the body and the summary", () => {
  // The whole file depends on this shape: no delimiters, one leading star, and
  // the indentation of the closing line left on the last line.
  it("is handed the raw value oxc produces, star included", () => {
    const code = source("/**", " * The label.", " */", "type A = string;");
    const { comments } = parseSync("raw.ts", code, { lang: "ts" });

    expect(comments.map((comment) => comment.value)).toEqual(["*\n * The label.\n "]);
  });

  it("reads a one-line summary", () => {
    expect(parseJSDoc("* Whether it is disabled. ")).toEqual({
      summary: "Whether it is disabled.",
      full: "Whether it is disabled.",
      tags: {},
    });
  });

  it("splits a trailing tag off the summary line", () => {
    expect(parseJSDoc("* Whether it is disabled. @default false ")).toEqual({
      summary: "Whether it is disabled.",
      full: "Whether it is disabled.",
      tags: { default: ["false"] },
    });
  });

  it("strips the star prefix from every line", () => {
    const doc = parseJSDoc(["*", " * First line.", " * Second line.", " "].join("\n"));

    expect(doc.full).toBe("First line.\nSecond line.");
    // The summary is one line by definition, so the break becomes a space.
    expect(doc.summary).toBe("First line. Second line.");
    expect(doc.tags).toEqual({});
  });

  it("keeps every paragraph in full and only the first in the summary", () => {
    const doc = parseJSDoc(
      ["*", " * First paragraph, over", " * two lines.", " *", " * Second paragraph.", " "].join(
        "\n",
      ),
    );

    expect(doc.summary).toBe("First paragraph, over two lines.");
    expect(doc.full).toBe("First paragraph, over\ntwo lines.\n\nSecond paragraph.");
  });

  // A block written without continuation stars is dedented instead, so the
  // relative indentation of markdown inside it survives. Rejecting a comment
  // for not being JSDoc is `attachComments`' job, not this function's.
  it("dedents a block that carries no continuation stars", () => {
    const doc = parseJSDoc(["", "  Indented body.", "    - a list item", ""].join("\n"));

    expect(doc.full).toBe("Indented body.\n  - a list item");
    expect(doc.summary).toBe("Indented body. - a list item");
  });

  it("returns empty strings for an empty comment", () => {
    expect(parseJSDoc("*")).toEqual({ summary: "", full: "", tags: {} });
    expect(parseJSDoc(["*", " *", " "].join("\n"))).toEqual({ summary: "", full: "", tags: {} });
  });

  // A tag opens at the start of a line or after whitespace, which is what keeps
  // an email address and an inline `{@link}` out of the tag map.
  it("does not read an @ that is glued to the text before it as a tag", () => {
    const doc = parseJSDoc("* See {@link Foo} or mail team@example.com. ");

    expect(doc.tags).toEqual({});
    expect(doc.summary).toBe("See {@link Foo} or mail team@example.com.");
  });
});

describe("tags", () => {
  it("maps a bare tag to an empty string, not to undefined", () => {
    const doc = parseJSDoc("* @bindable ");

    expect(doc.tags).toEqual({ bindable: [""] });
    expect(doc.tags.bindable[0]).toBe("");
    expect(doc.tags.bindable[0]).not.toBeUndefined();
  });

  it("lets tag text run on until a line starts with the next tag", () => {
    const doc = parseJSDoc(
      [
        "*",
        " * Summary.",
        " * @remarks The tag text starts here",
        " * and carries on to here.",
        " * @default 1",
        " ",
      ].join("\n"),
    );

    expect(doc.tags.remarks).toEqual(["The tag text starts here\nand carries on to here."]);
    expect(doc.tags.default).toEqual(["1"]);
    // The tag ends the body: none of its text leaks back into the summary.
    expect(doc.full).toBe("Summary.");
  });

  it("keeps a repeated tag in source order", () => {
    const doc = parseJSDoc(
      ["*", " * @see https://a.example", " * @see https://b.example", " "].join("\n"),
    );

    expect(doc.tags.see).toEqual(["https://a.example", "https://b.example"]);
  });

  it("keeps punctuation and inline code in tag text", () => {
    const doc = parseJSDoc("* @deprecated Use `variant` instead. ");

    expect(doc.tags.deprecated).toEqual(["Use `variant` instead."]);
    expect(doc.summary).toBe("");
  });

  it("reads a comment that is nothing but tags", () => {
    const doc = parseJSDoc(["*", " * @default false", " * @bindable", " "].join("\n"));

    expect(doc.summary).toBe("");
    expect(doc.full).toBe("");
    expect(doc.tags).toEqual({ default: ["false"], bindable: [""] });
  });
});

describe("attaching comments to nodes", () => {
  it("attaches each comment to the member that follows it", () => {
    const { members, docs } = attach(
      source(
        "interface Props {",
        "  /** The label. */",
        "  label: string;",
        "",
        "  /** Whether it is disabled. @default false */",
        "",
        "  disabled: boolean;",
        "}",
      ),
    );

    expect(docs.size).toBe(2);
    expect(docs.get(members[0])?.summary).toBe("The label.");
    // Only whitespace separates the second comment from its member, blank line
    // included, so the gap does not break the pairing.
    expect(docs.get(members[1])?.summary).toBe("Whether it is disabled.");
    expect(docs.get(members[1])?.tags.default).toEqual(["false"]);
  });

  it("does not attach a comment across another member", () => {
    const { members, docs } = attach(
      source(
        "interface Props {",
        "  /** Only about the label. */",
        "  label: string;",
        "  size: number;",
        "}",
      ),
    );

    expect(docs.get(members[0])?.summary).toBe("Only about the label.");
    expect(docs.has(members[1])).toBe(false);
    expect(docs.size).toBe(1);
  });

  it("leaves an undocumented member out of the map", () => {
    const { members, docs } = attach(
      source(
        "interface Props {",
        "  size: number;",
        "  /** The label. */",
        "  label: string;",
        "}",
      ),
    );

    expect(docs.has(members[0])).toBe(false);
    expect(docs.get(members[1])?.summary).toBe("The label.");

    const bare = attach(source("interface Props {", "  size: number;", "}"));
    expect(bare.docs.size).toBe(0);
  });

  it("attaches a trailing comment to nothing", () => {
    const { docs } = attach(
      source(
        "interface Props {",
        "  /** The label. */",
        "  label: string;",
        "  /** Documents nothing. */",
        "}",
      ),
    );

    expect([...docs.values()].map((doc) => doc.summary)).toEqual(["The label."]);
  });

  // Both of these sit directly above a member with only whitespace between, so
  // they would attach if the filter for real JSDoc blocks were not there.
  it("ignores a plain block comment and a line comment", () => {
    const { members, docs } = attach(
      source(
        "interface Props {",
        "  /** The label. */",
        "  label: string;",
        "  /* not a JSDoc block */",
        "  size: number;",
        "  // not a block comment at all",
        "  title: string;",
        "}",
      ),
    );

    expect(docs.size).toBe(1);
    expect(docs.get(members[0])?.summary).toBe("The label.");
    expect(docs.has(members[1])).toBe(false);
    expect(docs.has(members[2])).toBe(false);
  });
});
