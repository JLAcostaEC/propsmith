/**
 * The symbol index and the Type cell.
 *
 * The five rows of the fallback chain get one test each, in order, because the whole
 * module is that fallback chain: which row a type lands on decides both the cell
 * and what `check` reports about it. Declarations are built by hand here — the
 * extractor is tested elsewhere, and this module only ever sees `TypeDeclaration`.
 */

import { describe, expect, it } from "vitest";

import { assertNoHtml } from "../src/render/escape.js";
import { DEFAULT_EXTRAS_LABELS } from "../src/render/extras.js";
import { createSymbolIndex } from "../src/resolve/index.js";
import { glossaryAnchor, renderType } from "../src/resolve/render-type.js";
import type { RenderedType } from "../src/resolve/render-type.js";
import type { ResolvedTypes, SourceRef, TypeDeclaration } from "../src/types.js";

const SOURCE: SourceRef = { file: "/src/types.ts", line: 1, column: 1 };

function decl(name: string, text: string, extra: Partial<TypeDeclaration> = {}): TypeDeclaration {
  return { name, text, shape: "alias", source: SOURCE, ...extra };
}

const SIZES = decl("Sizes", "'sm' | 'lg'", { shape: "union", values: ["'sm'", "'lg'"] });

const BACKOFF = decl(
  "BackoffPolicy",
  "{ initialDelayMs: number; maxDelayMs: number; multiplier: number }",
  { shape: "object", keys: ["initialDelayMs", "maxDelayMs", "multiplier"] },
);

const ICON_NAME = decl("IconName", "'accept' | 'add' | 'alert' | 'archive' | 'back'", {
  shape: "union",
  values: ["'accept'", "'add'", "'alert'", "'archive'", "'back'"],
});

interface RenderOptions {
  decls?: TypeDeclaration[];
  types?: Partial<ResolvedTypes>;
  /** The per-output glossary, which overrides `types.glossary`. */
  glossary?: string;
  see?: string;
}

function render(typeText: string, opts: RenderOptions = {}): RenderedType {
  return renderType(typeText, {
    index: createSymbolIndex(opts.decls ?? []),
    types: {
      inlineUnder: 60,
      links: {},
      inherit: true,
      extras: { labels: DEFAULT_EXTRAS_LABELS, origins: {} },
      ...opts.types,
    },
    glossary: opts.glossary,
    see: opts.see,
  });
}

/**
 * The contents of every code span, read the way CommonMark reads them: backtick
 * runs alternate open and close, so the odd-numbered pieces are the spans.
 */
function insideCodeSpans(markdown: string): string[] {
  return markdown.split(/`+/).filter((_, index) => index % 2 === 1);
}

// ---------------------------------------------------------------------------

describe("the symbol index", () => {
  it("answers for a name it holds and nothing else", () => {
    const index = createSymbolIndex([SIZES, BACKOFF]);

    expect(index.get("Sizes")?.text).toBe("'sm' | 'lg'");
    expect(index.get("BackoffPolicy")?.shape).toBe("object");
    expect(index.get("Dayjs")).toBeUndefined();
  });

  it("takes declarations added after construction", () => {
    const index = createSymbolIndex();
    expect(index.get("Sizes")).toBeUndefined();

    index.add([SIZES]);
    expect(index.get("Sizes")?.text).toBe("'sm' | 'lg'");
  });

  it("lets the last declaration of a name win", () => {
    // The join between a reference and a declaration is the name, never the
    // path, so a duplicate is a replacement rather than an error.
    const first = decl("Sizes", "'sm' | 'lg'");
    const second = decl("Sizes", "'small' | 'medium' | 'large'", {
      source: { ...SOURCE, file: "/src/other.ts" },
    });

    expect(createSymbolIndex([first, second]).get("Sizes")?.text).toBe(
      "'small' | 'medium' | 'large'",
    );

    const index = createSymbolIndex([first]);
    index.add([second]);
    expect(index.get("Sizes")?.text).toBe("'small' | 'medium' | 'large'");
  });
});

// ---------------------------------------------------------------------------

describe("the five rows of the fallback chain", () => {
  it("row 1 — resolved and short enough: the definition replaces the name", () => {
    const result = render("Sizes", { decls: [SIZES], types: { inlineUnder: 60 } });

    expect(result.markdown).toBe("`'sm'` &#124; `'lg'`");
    expect(result.unresolved).toEqual([]);
    expect(result.tooLong).toEqual([]);
    expect(result.glossaryNeeded).toEqual([]);
  });

  it("row 2 — resolved but too long, with a glossary: a link, and the name recorded", () => {
    const result = render("BackoffPolicy", {
      decls: [BACKOFF],
      types: { inlineUnder: 20, glossary: "/types" },
    });

    expect(result.markdown).toBe("[`BackoffPolicy`](/types#backoffpolicy)");
    expect(result.glossaryNeeded).toEqual(["BackoffPolicy"]);
    expect(result.tooLong).toEqual([]);

    // The per-output glossary wins over the one in `types`.
    const overridden = render("BackoffPolicy", {
      decls: [BACKOFF],
      types: { inlineUnder: 20, glossary: "/types" },
      glossary: "/docs/reference",
    });
    expect(overridden.markdown).toBe("[`BackoffPolicy`](/docs/reference#backoffpolicy)");
  });

  it("row 3 — resolved, too long, no glossary: the name plus its shape, recorded", () => {
    const result = render("BackoffPolicy", { decls: [BACKOFF], types: { inlineUnder: 20 } });

    // What the author wrote is never removed; resolution can only add.
    expect(result.markdown).toBe("`BackoffPolicy` `{ initialDelayMs, maxDelayMs, multiplier }`");
    expect(result.tooLong).toEqual(["BackoffPolicy"]);
    expect(result.glossaryNeeded).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it("row 4 — unresolved but present in types.links: a link", () => {
    const result = render("Snippet", {
      types: { links: { Snippet: "https://svelte.dev/docs/svelte/snippet" } },
    });

    expect(result.markdown).toBe("[`Snippet`](https://svelte.dev/docs/svelte/snippet)");
    expect(result.unresolved).toEqual([]);
    expect(result.tooLong).toEqual([]);
  });

  it("row 5 — unresolved with no link: the bare name, recorded once", () => {
    const result = render("Dayjs");

    expect(result.markdown).toBe("`Dayjs`");
    expect(result.unresolved).toEqual(["Dayjs"]);

    // One diagnostic per name, however often the name appears in the type.
    const repeated = render("Dayjs | Moment | Dayjs");
    expect(repeated.unresolved).toEqual(["Dayjs", "Moment"]);

    // Intrinsics are not names propsmith should have resolved.
    expect(render("string | null | undefined").unresolved).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("what overrides resolution", () => {
  it("uses @see over the index, over types.links, and verbatim", () => {
    const result = render("Sizes", {
      decls: [SIZES],
      types: {
        inlineUnder: 60,
        glossary: "/types",
        links: { Sizes: "https://example.test/wrong" },
      },
      see: "https://day.js.org/docs/en/parse/parse",
    });

    expect(result.markdown).toBe("[`Sizes`](https://day.js.org/docs/en/parse/parse)");
    expect(result.glossaryNeeded).toEqual([]);
    expect(result.tooLong).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it("still follows @see for a name it could never resolve", () => {
    const result = render("Dayjs", { see: "#dayjs" });

    expect(result.markdown).toBe("[`Dayjs`](#dayjs)");
    expect(result.unresolved).toEqual([]);
  });

  it("disables inlining entirely at inlineUnder: 0", () => {
    // `Sizes` fits in any sane budget; zero means there is no budget at all, so
    // even a two-value union falls through to the glossary.
    const linked = render("Sizes", { decls: [SIZES], types: { inlineUnder: 0, glossary: "#" } });
    expect(linked.markdown).toBe("[`Sizes`](#sizes)");
    expect(linked.glossaryNeeded).toEqual(["Sizes"]);

    const degraded = render("Sizes", { decls: [SIZES], types: { inlineUnder: 0 } });
    expect(degraded.markdown).toBe("`Sizes` `'sm'` &#124; `'lg'`");
    expect(degraded.tooLong).toEqual(["Sizes"]);
  });
});

// ---------------------------------------------------------------------------

describe("the top-level union split", () => {
  it("splits a plain union into one member per value", () => {
    expect(render("'a' | 'b'").markdown).toBe("`'a'` &#124; `'b'`");
    // A leading pipe, as a multi-line union is usually written, costs nothing.
    expect(render("| 'a' | 'b'").markdown).toBe("`'a'` &#124; `'b'`");
  });

  it("reads Array<'a' | 'b'> | null as two members, not three", () => {
    const result = render("Array<'a' | 'b'> | null", {
      types: { links: { Array: "https://example.test/array" } },
    });

    // The link is the proof: it exists only because the whole generic arrived at
    // `renderNameRef` as one member. Split naively on every pipe, the first
    // member would be `Array<'a'`, which is not a name reference at all.
    expect(result.markdown).toBe(
      "[`Array<'a'` &#124; `'b'>`](https://example.test/array) &#124; `null`",
    );
    expect(result.unresolved).toEqual([]);
  });

  it("keeps an inline object whole", () => {
    expect(render("{ a: 1 } | null").markdown).toBe("`{ a: 1 }` &#124; `null`");
  });

  it("does not mistake the arrow of a function type for a closing bracket", () => {
    expect(render("(a: string) => void | null").markdown).toBe(
      "`(a: string) => void` &#124; `null`",
    );
  });

  it("treats a pipe inside a string literal as part of that literal", () => {
    // The split is quote-aware, so `{ label: "a|b"; … }` is still one member and
    // still an object literal — which is what lets it degrade to its key shape.
    const object = render('{ label: "a|b"; easing: string; delay: number; loop: boolean }', {
      types: { inlineUnder: 20 },
    });
    expect(object.markdown).toBe("`{ label, easing, delay, … (4 keys) }`");

    // Printed rather than degraded, the pipe still cannot stay inside a code
    // span — a raw pipe would split the table cell — so the span is cut in two.
    expect(render('"a|b" | "c"').markdown).toBe('`"a` &#124; `b"` &#124; `"c"`');
  });
});

// ---------------------------------------------------------------------------

describe("the separator, and the rule behind it", () => {
  it("puts the entity in plain text, outside every code span", () => {
    const markdown = render("'a' | 'b'").markdown;

    expect(markdown).toBe("`'a'` &#124; `'b'`");
    // An entity reference inside a code span is literal text in CommonMark: it
    // would show the reader `&#124;` instead of a pipe. Hence the exact shape —
    // backtick, space, entity, space, backtick — and hence this assertion.
    expect(markdown).toContain("` &#124; `");
    for (const span of insideCodeSpans(markdown)) expect(span).not.toContain("&#124;");
    // And no raw pipe survives to split the cell.
    expect(markdown).not.toContain("|");
  });

  it("cuts a composed type around its pipe", () => {
    const result = render("Omit<X, 'a' | 'b'>");

    expect(result.markdown).toBe("`Omit<X, 'a'` &#124; `'b'>`");
    for (const span of insideCodeSpans(result.markdown)) expect(span).not.toContain("|");
    // It carries type arguments, so it is a composed type rather than a bare
    // name: there is nothing to report and nothing to link.
    expect(result.unresolved).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("degraded shapes", () => {
  it("shows the head of a long union and counts the rest", () => {
    const result = render("IconName", { decls: [ICON_NAME], types: { inlineUnder: 20 } });

    expect(result.markdown).toBe(
      "`IconName` `'accept'` &#124; `'add'` &#124; `'alert'` &#124; `… (5 values)`",
    );
    expect(result.tooLong).toEqual(["IconName"]);
  });

  it("shows the keys of a long anonymous object, never the word object", () => {
    const result = render("{ duration: number; easing: string; delay: number; loop: boolean }", {
      types: { inlineUnder: 20 },
    });

    expect(result.markdown).toBe("`{ duration, easing, delay, … (4 keys) }`");
    // Anonymous: there is no name to report or to link.
    expect(result.tooLong).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it("prints a short anonymous object as written", () => {
    const result = render("{ duration: number }", { types: { inlineUnder: 60 } });
    expect(result.markdown).toBe("`{ duration: number }`");
  });

  it("renders nothing for an empty type text", () => {
    expect(render("").markdown).toBe("");
    expect(render("   ").markdown).toBe("");
  });
});

// ---------------------------------------------------------------------------

describe("the no-HTML rule", () => {
  it("never emits a tag, whatever generic it is handed", () => {
    // A `<` is only literal text inside a code span, and every one of these ends
    // up in one — this is the guarantee `run` asserts on the finished region.
    for (const text of ["Array<string>", "Omit<X, 'a'>", "Record<string, unknown>"]) {
      const result = render(text);
      expect(result.markdown).toBe(`\`${text}\``);
      expect(() => assertNoHtml(result.markdown, text)).not.toThrow();
    }
  });

  it("escapes a link destination that would break the row", () => {
    const result = render("Snippet", {
      types: { links: { Snippet: "https://example.test/a b<c>|d" } },
    });

    expect(result.markdown).toBe("[`Snippet`](https://example.test/a%20b%3Cc%3E%7Cd)");
    expect(() => assertNoHtml(result.markdown, "Snippet")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe("glossary anchors", () => {
  it("lowercases a name into the anchor rehype-slug would derive", () => {
    expect(glossaryAnchor("BackoffPolicy")).toBe("backoffpolicy");
    expect(glossaryAnchor("  Auto Suggest  ")).toBe("auto-suggest");
    expect(glossaryAnchor("HTTP Client!")).toBe("http-client");
    expect(glossaryAnchor("Props<T>")).toBe("propst");
  });
});
