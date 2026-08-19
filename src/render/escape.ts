/**
 * Markdown escaping primitives.
 *
 * propsmith emits CommonMark + GFM tables and **never an HTML tag**.
 * That single constraint drives everything in this file:
 *
 * - a raw `|` splits a table cell, so it can never survive into the output;
 * - `&#124;` inside a code span does *not* decode — CommonMark treats entity
 *   references as literal text there — so the separator has to live outside the
 *   backticks;
 * - `<code>` is not an escape hatch, it is forbidden.
 */

/** The pipe, written as the entity that decodes outside a code span. */
const PIPE_ENTITY = "&#124;";

/** `<` followed by a letter, a slash, `!` or `?` — i.e. the start of a tag. */
const HTML_TAG = /<[a-zA-Z/!?]/;

/** Collapse any whitespace run (newlines included) to a single space and trim. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Escape text destined for a markdown table cell. Pipes become `&#124;`.
 *
 * Ampersands are left alone on purpose: cells arrive already carrying the
 * separators produced by {@link codeSpan}, and re-escaping them would show the
 * reader `&amp;#124;`.
 */
export function escapeCell(text: string): string {
  return oneLine(text).split("|").join(PIPE_ENTITY);
}

/**
 * Wrap text in a code span, splitting around pipes so `&#124;` sits outside.
 *
 * `'small' | 'medium'` becomes `` `'small'` &#124; `'medium'` ``. Every pipe is
 * pulled out, including one buried in a generic (`Omit<X, 'a' | 'b'>`), because
 * a pipe left inside backticks still splits the cell. Empty segments — the
 * leading pipe of a multi-line union, for instance — are dropped.
 *
 * Returns an empty string for empty input, never an empty pair of backticks.
 */
export function codeSpan(text: string): string {
  const parts: string[] = [];
  for (const part of oneLine(text).split("|")) {
    const trimmed = part.trim();
    if (trimmed.length > 0) parts.push(span(trimmed));
  }
  return parts.join(` ${PIPE_ENTITY} `);
}

/**
 * Blank out every code span, keeping offsets intact.
 *
 * Inside backticks a `<` is literal text, not a tag — `Array<string>` and
 * `Omit<X, 'a'>` are ordinary, correct output, and generics are one of the three
 * cases this tool exists to handle. Only markdown outside a span can open a tag,
 * so that is the only place worth checking. Replacing the content with spaces
 * rather than deleting it keeps the reported offset pointing at the real text.
 */
function maskCodeSpans(markdown: string): string {
  let masked = "";
  let index = 0;

  while (index < markdown.length) {
    const char = markdown[index]!;
    if (char !== "`") {
      masked += char;
      index += 1;
      continue;
    }

    const fence = /^`+/.exec(markdown.slice(index))![0];
    const closing = markdown.indexOf(fence, index + fence.length);
    // An unclosed fence is not a code span at all; the backtick is literal.
    if (closing === -1) {
      masked += char;
      index += 1;
      continue;
    }

    const end = closing + fence.length;
    masked += " ".repeat(end - index);
    index = end;
  }

  return masked;
}

/**
 * Throws if the string contains an HTML tag. Used to enforce the no-HTML rule.
 *
 * Code spans are exempt, for the reason {@link maskCodeSpans} explains.
 * `context` names what was being rendered, so the message points at a region or
 * a component rather than at a byte offset alone.
 */
export function assertNoHtml(markdown: string, context: string): void {
  const match = HTML_TAG.exec(maskCodeSpans(markdown));
  if (match === null) return;
  const start = Math.max(0, match.index - 24);
  const snippet = oneLine(markdown.slice(start, match.index + 48));
  throw new Error(
    `${context}: generated markdown must not contain an HTML tag ` +
      `(offset ${match.index}): ...${snippet}...`,
  );
}

/**
 * Wrap one already-trimmed, pipe-free fragment in backticks, widening the fence
 * past any backtick run inside it and padding when it starts or ends with one.
 */
function span(content: string): string {
  let fenceLength = 1;
  const runs = content.match(/`+/g);
  if (runs !== null) {
    for (const run of runs) {
      if (run.length >= fenceLength) fenceLength = run.length + 1;
    }
  }
  const fence = "`".repeat(fenceLength);
  // CommonMark strips one leading and one trailing space from a code span, so
  // this padding keeps a literal backtick at either end from closing the span.
  const pad = content.charAt(0) === "`" || content.charAt(content.length - 1) === "`" ? " " : "";
  return `${fence}${pad}${content}${pad}${fence}`;
}
