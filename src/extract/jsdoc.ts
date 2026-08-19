/**
 * JSDoc reading for oxc comment nodes.
 *
 * oxc hands back a flat list of comments and leaves both attachment and tag
 * parsing to the caller: `comment.value` is the raw inner text of the comment,
 * so `/** a *\/` arrives as `"* a "`. Everything in this module works on that
 * raw text and on numeric offsets — no AST types are needed.
 */

/** A parsed JSDoc block. */
export interface ParsedJSDoc {
  /** First paragraph of the body, whitespace-normalised to one line. */
  summary: string;
  /** Whole body, paragraphs preserved. */
  full: string;
  /** Tag name (without `@`) -> array of texts, in source order. Bare tags map to `""`. */
  tags: Record<string, string[]>;
}

/** The shape of an oxc comment node. Structural, so any parser version fits. */
export interface CommentLike {
  type: string;
  value: string;
  start: number;
  end: number;
}

/** A tag name: `@default`, `@propsmith`, `@my-tag`. */
const TAG_NAME = /^[A-Za-z_$][\w$-]*/;
/** A continuation line that carries the JSDoc star. */
const STAR_LINE = /^[ \t]*\*/;
/** The star prefix plus the single space that conventionally follows it. */
const STAR_PREFIX = /^[ \t]*\*[ \t]?/;
/** A paragraph break: one line holding nothing but whitespace. */
const PARAGRAPH_BREAK = /\n[ \t]*\n/;

/** Whitespace of any kind, collapsed to a single space. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Strip the comment's decoration: the leading `*` that marks it as JSDoc, then
 * the `*` (and one following space) from every subsequent line. A block written
 * without continuation stars is dedented by its common indentation instead, so
 * indented markdown inside the body survives.
 */
function toLines(raw: string): string[] {
  const text = raw.startsWith("*") ? raw.slice(1) : raw;
  const lines = text.split(/\r?\n/);
  const first = lines[0].replace(/^[ \t]+/, "").trimEnd();
  const rest = lines.slice(1);

  if (rest.some((line) => STAR_LINE.test(line))) {
    return [
      first,
      ...rest.map((line) => {
        const star = STAR_PREFIX.exec(line);
        return (star ? line.slice(star[0].length) : line.replace(/^[ \t]+/, "")).trimEnd();
      }),
    ];
  }

  let indent = Number.POSITIVE_INFINITY;
  for (const line of rest) {
    if (line.trim() === "") continue;
    indent = Math.min(indent, line.length - line.trimStart().length);
  }
  const width = Number.isFinite(indent) ? indent : 0;
  return [first, ...rest.map((line) => line.slice(width).trimEnd())];
}

interface TagStart {
  /** Index of the `@` inside the line. */
  index: number;
  name: string;
}

/**
 * The first tag opening in `line`. A tag opens at the start of the line or
 * after whitespace, which keeps `user@example.com` and `{@link Foo}` out.
 */
function findTag(line: string): TagStart | null {
  for (let index = line.indexOf("@"); index !== -1; index = line.indexOf("@", index + 1)) {
    if (index > 0 && !/\s/.test(line[index - 1])) continue;
    const name = TAG_NAME.exec(line.slice(index + 1));
    if (name) return { index, name: name[0] };
  }
  return null;
}

/** A tag opening at the very start of the line — what terminates the previous tag. */
function findLeadingTag(line: string): TagStart | null {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("@")) return null;
  const name = TAG_NAME.exec(trimmed.slice(1));
  if (!name) return null;
  return { index: line.length - trimmed.length, name: name[0] };
}

/**
 * Parse the raw inner text of a JSDoc block comment.
 *
 * Body text stops at the first tag, wherever it appears — a tag on the summary
 * line (`Whether it is disabled. @default false`) is read as a tag, and what
 * precedes it stays in the body. A tag runs until the next line that starts
 * with `@`, so tag text can span lines.
 */
export function parseJSDoc(raw: string): ParsedJSDoc {
  const body: string[] = [];
  const tags: Record<string, string[]> = {};
  let open: { name: string; lines: string[] } | null = null;

  const close = (): void => {
    if (!open) return;
    const texts = tags[open.name] ?? (tags[open.name] = []);
    texts.push(open.lines.join("\n").trim());
    open = null;
  };

  for (const line of toLines(raw)) {
    if (open) {
      const next = findLeadingTag(line);
      if (!next) {
        open.lines.push(line);
        continue;
      }
      close();
      open = { name: next.name, lines: [line.slice(next.index + 1 + next.name.length)] };
      continue;
    }

    const tag = findTag(line);
    if (!tag) {
      body.push(line);
      continue;
    }
    const before = line.slice(0, tag.index).trimEnd();
    if (before !== "") body.push(before);
    open = { name: tag.name, lines: [line.slice(tag.index + 1 + tag.name.length)] };
  }
  close();

  const full = body.join("\n").trim();
  return { summary: oneLine(full.split(PARAGRAPH_BREAK)[0]), full, tags };
}

/** The last JSDoc comment ending at or before `offset`, or `null`. */
function lastBefore(comments: readonly CommentLike[], offset: number): CommentLike | null {
  let low = 0;
  let high = comments.length - 1;
  let found: CommentLike | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const comment = comments[middle];
    if (comment.end <= offset) {
      found = comment;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * Pair nodes with the JSDoc block that documents them.
 *
 * A comment documents a node when it is the closest one ending before the node
 * starts and nothing but whitespace separates the two. Only block comments
 * whose text begins with `*` — real `/** … *\/` blocks — are considered.
 * Nodes with no comment are absent from the map.
 */
export function attachComments<T extends { start: number }>(
  nodes: readonly T[],
  comments: readonly CommentLike[],
  source: string,
): Map<T, ParsedJSDoc> {
  const attached = new Map<T, ParsedJSDoc>();
  const blocks = comments
    .filter((comment) => comment.type === "Block" && comment.value.startsWith("*"))
    .toSorted((a, b) => a.end - b.end);
  if (blocks.length === 0) return attached;

  /** One comment can document several nodes; parse each of them once. */
  const parsed = new Map<number, ParsedJSDoc>();
  for (const node of nodes) {
    const comment = lastBefore(blocks, node.start);
    if (!comment) continue;
    if (source.slice(comment.end, node.start).trim() !== "") continue;
    let doc = parsed.get(comment.start);
    if (!doc) {
      doc = parseJSDoc(comment.value);
      parsed.set(comment.start, doc);
    }
    attached.set(node, doc);
  }
  return attached;
}
