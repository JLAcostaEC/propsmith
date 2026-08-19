/**
 * The Type cell.
 *
 * Turns the verbatim type text of a member into markdown, following the
 * fallback chain in `docs/types.md`. Two constraints shape every line here:
 *
 * - **No HTML, ever.** Not even `<code>`. Only CommonMark plus entities.
 * - **A pipe cannot live inside a code span.** CommonMark treats an entity
 *   reference as literal text inside a code span, so `&#124;` would render raw.
 *   The separator therefore always sits in plain text *between* spans
 *   (option B of §5.3): `` `'a'` `` &#124; `` `'b'` ``.
 *
 * Resolution is syntactic and one level deep: a name resolves to its
 * declaration text and stops. Names inside that text are never resolved again.
 */

import type { ResolvedTypes, TypeDeclaration } from "../types.js";
import type { SymbolIndex } from "./index.js";

export interface RenderTypeOptions {
  index: SymbolIndex;
  types: ResolvedTypes;
  /** Overrides types.glossary for the current output. */
  glossary?: string;
  /** Explicit @see target for this member, which wins over types.links. */
  see?: string;
}

export interface RenderedType {
  /** Ready-to-paste markdown for the Type cell. */
  markdown: string;
  /** Names that could not be resolved and had no link — for diagnostics. */
  unresolved: string[];
  /** Names that resolved but were too long to inline — for diagnostics. */
  tooLong: string[];
  /** Local type names that must appear in the glossary region. */
  glossaryNeeded: string[];
}

/** The union separator: an entity, in plain text, outside every code span. */
const SEPARATOR = " &#124; ";

/** How many keys or values a degraded shape shows before the ellipsis. */
const MAX_DEGRADED_ITEMS = 3;

/**
 * Type keywords that are never looked up and never reported as unresolved.
 * `Sizes` is a name propsmith should resolve; `boolean` is not.
 */
const INTRINSIC_TYPES = new Set([
  "any",
  "bigint",
  "boolean",
  "false",
  "never",
  "null",
  "number",
  "object",
  "string",
  "symbol",
  "this",
  "true",
  "undefined",
  "unknown",
  "void",
]);

/** Characters that would break a markdown link destination or a table row. */
const TARGET_ESCAPES: Record<string, string> = {
  " ": "%20",
  "(": "%28",
  ")": "%29",
  "|": "%7C",
  "<": "%3C",
  ">": "%3E",
};

interface RenderContext {
  index: SymbolIndex;
  inlineUnder: number;
  links: Record<string, string>;
  /** Effective glossary base. `undefined` means there is no glossary. */
  glossary: string | undefined;
  see: string | undefined;
  unresolved: string[];
  tooLong: string[];
  glossaryNeeded: string[];
}

/** A reference to a named type, with or without type arguments. */
interface NameRef {
  /** The name to look up, e.g. `Sizes` or `ListViewItemProps`. */
  base: string;
  /** The text as the author wrote it, e.g. `ListViewItemProps<T>`. */
  label: string;
  hasTypeArguments: boolean;
}

/**
 * Render the Type cell for one member.
 *
 * @param typeText verbatim type text, as the author wrote it
 */
export function renderType(typeText: string, opts: RenderTypeOptions): RenderedType {
  const ctx: RenderContext = {
    index: opts.index,
    inlineUnder: opts.types.inlineUnder ?? 0,
    links: opts.types.links ?? {},
    glossary: opts.glossary ?? opts.types.glossary,
    see: opts.see,
    unresolved: [],
    tooLong: [],
    glossaryNeeded: [],
  };

  const text = collapse(typeText);
  const markdown = text === "" ? "" : renderUnion(text, ctx, true);

  return {
    markdown,
    unresolved: ctx.unresolved,
    tooLong: ctx.tooLong,
    glossaryNeeded: ctx.glossaryNeeded,
  };
}

/**
 * The anchor a glossary link points at, matching what `rehype-slug` derives
 * from a heading of the same name.
 */
export function glossaryAnchor(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\- _]+/gu, "")
    .replace(/\s+/g, "-");
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render a type, splitting a top-level union so the pipes become separators in
 * plain text rather than characters inside a code span.
 *
 * @param resolve `false` inside an already-resolved declaration — §8's
 *   "one level, no recursion".
 */
function renderUnion(text: string, ctx: RenderContext, resolve: boolean): string {
  const members = splitTopLevel(text, "|");
  const rendered: string[] = [];

  for (const member of members) {
    const cell = renderAtom(member, ctx, resolve);
    if (cell !== "") rendered.push(cell);
  }

  return rendered.join(SEPARATOR);
}

/** Render one union member — or the whole type, when it is not a union. */
function renderAtom(text: string, ctx: RenderContext, resolve: boolean): string {
  if (!resolve) return codeSpanWithPipes(text);

  const ref = parseNameRef(text);
  if (ref && !INTRINSIC_TYPES.has(ref.base)) {
    const cell = renderNameRef(ref, ctx);
    if (cell !== undefined) return cell;
  }

  return renderComposed(text, ctx);
}

/**
 * The fallback chain of `docs/types.md`, in order. Returns `undefined` when nothing
 * in the chain applies, which happens only for a reference carrying type
 * arguments — `Omit<X, 'a' | 'b'>` is a composed type, not a bare name, and
 * must keep every character the author wrote.
 */
function renderNameRef(ref: NameRef, ctx: RenderContext): string | undefined {
  if (ctx.see !== undefined && ctx.see !== "") {
    return link(ref.label, ctx.see);
  }

  const decl = ctx.index.get(ref.base);

  if (decl) {
    const definition = collapse(decl.text);

    // 1 — resolved, and short enough to print in place of the name.
    if (ctx.inlineUnder > 0 && definition.length <= ctx.inlineUnder && definition !== "") {
      return renderUnion(definition, ctx, false);
    }

    // 2 — resolved, too long, the glossary carries the full definition.
    if (ctx.glossary !== undefined) {
      pushUnique(ctx.glossaryNeeded, ref.base);
      return link(ref.label, glossaryUrl(ctx.glossary, ref.base));
    }

    // 3 — resolved, too long, no glossary: keep the name, append the shape.
    pushUnique(ctx.tooLong, ref.base);
    const shape = degradedShape(decl);
    const name = codeSpanWithPipes(ref.label);
    return shape === "" ? name : `${name} ${shape}`;
  }

  // 4 — unresolvable by propsmith, but the config knows where it is documented.
  const configured = ctx.links[ref.base];
  if (configured !== undefined && configured !== "") {
    return link(ref.label, configured);
  }

  // 5 — a bare name propsmith knows nothing about.
  if (!ref.hasTypeArguments) {
    pushUnique(ctx.unresolved, ref.base);
    return codeSpan(ref.label);
  }

  return undefined;
}

/**
 * A type that is not a bare name: a generic, a function type, an inline object.
 * Printed verbatim, except that an anonymous object too long to read degrades
 * to its key shape — §8's "the short rendering, never `object`". It carries no
 * name, so there is nothing to report and nothing to link.
 */
function renderComposed(text: string, ctx: RenderContext): string {
  if (ctx.inlineUnder > 0 && text.length > ctx.inlineUnder && isObjectLiteral(text)) {
    const shape = keyShape(objectKeys(text));
    if (shape !== "") return codeSpan(shape);
  }

  return codeSpanWithPipes(text);
}

/**
 * What a resolved-but-too-long declaration shows after its name: the keys of an
 * object, or the head of a union with a count of the rest.
 */
function degradedShape(decl: TypeDeclaration): string {
  if (decl.shape === "union" && decl.values && decl.values.length > 0) {
    const shown: string[] = [];
    for (const value of decl.values.slice(0, MAX_DEGRADED_ITEMS)) {
      const span = codeSpanWithPipes(collapse(value));
      if (span !== "") shown.push(span);
    }
    if (decl.values.length > MAX_DEGRADED_ITEMS) {
      shown.push(codeSpan(`… (${decl.values.length} values)`));
    }
    return shown.join(SEPARATOR);
  }

  if (decl.shape === "object" && decl.keys && decl.keys.length > 0) {
    const shape = keyShape(decl.keys);
    return shape === "" ? "" : codeSpan(shape);
  }

  return "";
}

/** `{ duration, easing, delay }`, truncated with a count when it runs long. */
function keyShape(keys: readonly string[]): string {
  if (keys.length === 0) return "";
  if (keys.length <= MAX_DEGRADED_ITEMS) return `{ ${keys.join(", ")} }`;
  const shown = keys.slice(0, MAX_DEGRADED_ITEMS).join(", ");
  return `{ ${shown}, … (${keys.length} keys) }`;
}

// ---------------------------------------------------------------------------
// Markdown primitives
// ---------------------------------------------------------------------------

/**
 * A code span that survives any content: the fence grows past the longest run
 * of backticks inside, and content touching a backtick is padded, exactly as
 * CommonMark requires.
 */
function codeSpan(text: string): string {
  const content = text.trim();
  if (content === "") return "";

  let fenceLength = 1;
  const runs = content.match(/`+/g);
  if (runs) {
    for (const run of runs) {
      if (run.length >= fenceLength) fenceLength = run.length + 1;
    }
  }

  const fence = "`".repeat(fenceLength);
  const pad = content.startsWith("`") || content.endsWith("`") ? " " : "";
  return `${fence}${pad}${content}${pad}${fence}`;
}

/**
 * A code span for text that may contain a pipe at any depth. The pipe cannot be
 * escaped inside a span and cannot be left raw inside a table cell, so the span
 * is cut around it and the separator lives in plain text between the halves:
 * `` `Omit<X, 'a'` `` &#124; `` `'b'>` ``. Ugly, and the only markdown-only
 * option there is.
 */
function codeSpanWithPipes(text: string): string {
  if (!text.includes("|")) return codeSpan(text);

  const spans: string[] = [];
  for (const part of text.split("|")) {
    const span = codeSpan(part);
    if (span !== "") spans.push(span);
  }

  return spans.join(SEPARATOR);
}

/** `[`Name`](target)`, with a destination that cannot break the table row. */
function link(label: string, target: string): string {
  return `[${codeSpanWithPipes(label)}](${encodeTarget(target)})`;
}

function encodeTarget(target: string): string {
  return collapse(target).replace(/[ ()|<>]/g, (char) => TARGET_ESCAPES[char] ?? char);
}

function glossaryUrl(base: string, name: string): string {
  return `${base.trim().replace(/#+$/, "")}#${glossaryAnchor(name)}`;
}

// ---------------------------------------------------------------------------
// Type-text inspection
// ---------------------------------------------------------------------------

const NAME_PATTERN = "[A-Za-z_$][A-Za-z0-9_$]*(?:\\s*\\.\\s*[A-Za-z_$][A-Za-z0-9_$]*)*";
const BARE_NAME_RE = new RegExp(`^${NAME_PATTERN}$`);
const GENERIC_NAME_RE = new RegExp(`^(${NAME_PATTERN})\\s*<([\\s\\S]*)>$`);

/**
 * Read `Sizes` or `ListViewItemProps<T>` as a reference to a named type.
 * Anything else — an array, a function type, a literal, a mapped type — is not
 * a name and returns `null`.
 */
function parseNameRef(text: string): NameRef | null {
  if (BARE_NAME_RE.test(text)) {
    return { base: text.replace(/\s+/g, ""), label: text, hasTypeArguments: false };
  }

  const generic = GENERIC_NAME_RE.exec(text);
  if (generic && isBalanced(generic[2] ?? "")) {
    return { base: (generic[1] ?? "").replace(/\s+/g, ""), label: text, hasTypeArguments: true };
  }

  return null;
}

function isObjectLiteral(text: string): boolean {
  return (
    text.length > 1 && text.startsWith("{") && text.endsWith("}") && isBalanced(text.slice(1, -1))
  );
}

/** The member names of an inline object type, for the key-shape fallback. */
function objectKeys(text: string): string[] {
  const keys: string[] = [];

  for (const member of splitTopLevel(text.slice(1, -1), ";,")) {
    const key = memberKey(member);
    if (key !== null) keys.push(key);
  }

  return keys;
}

function memberKey(member: string): string | null {
  const text = collapse(member).replace(/^(?:readonly|public|private|protected)\s+/, "");
  // An index signature has no name to show.
  if (text === "" || text.startsWith("[")) return null;

  const stop = text.search(/[?:(<]/);
  const name = (stop === -1 ? text : text.slice(0, stop)).trim();
  const unquoted = unquote(name);
  return unquoted === "" ? null : unquoted;
}

function unquote(text: string): string {
  const first = text.charAt(0);
  const isQuote = first === "'" || first === '"' || first === "`";
  if (isQuote && text.length > 1 && text.charAt(text.length - 1) === first) {
    return text.slice(1, -1);
  }
  return text;
}

// ---------------------------------------------------------------------------
// Depth-aware scanning
// ---------------------------------------------------------------------------

/**
 * Split on any of `separators` at nesting depth zero, tracking `<>`, `()`,
 * `{}`, `[]` and string literals — `'a|b'` is one value, and the quote may be
 * single, double or a backtick. Empty parts are dropped, so a leading `|` in
 * `| 'a' | 'b'` costs nothing.
 */
function splitTopLevel(text: string, separators: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let brackets = 0;
  let angles = 0;
  let quote = "";

  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);

    if (quote !== "") {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
    } else if (char === "(" || char === "[" || char === "{") {
      brackets++;
    } else if (char === ")" || char === "]" || char === "}") {
      if (brackets > 0) brackets--;
    } else if (char === "=" && text.charAt(i + 1) === ">") {
      // An arrow, not a closing type-argument bracket.
      i++;
    } else if (char === "<") {
      angles++;
    } else if (char === ">") {
      if (angles > 0) angles--;
    } else if (brackets === 0 && angles === 0 && separators.includes(char)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(text.slice(start));

  const result: string[] = [];
  for (const part of parts) {
    const trimmed = collapse(part);
    if (trimmed !== "") result.push(trimmed);
  }

  return result;
}

/** Whether every bracket and quote in the text closes, so a slice is a whole. */
function isBalanced(text: string): boolean {
  let brackets = 0;
  let angles = 0;
  let quote = "";

  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);

    if (quote !== "") {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
    } else if (char === "(" || char === "[" || char === "{") {
      brackets++;
    } else if (char === ")" || char === "]" || char === "}") {
      brackets--;
      if (brackets < 0) return false;
    } else if (char === "=" && text.charAt(i + 1) === ">") {
      i++;
    } else if (char === "<") {
      angles++;
    } else if (char === ">") {
      angles--;
      if (angles < 0) return false;
    }
  }

  return brackets === 0 && angles === 0 && quote === "";
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Whitespace, including newlines, collapsed to single spaces. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}
