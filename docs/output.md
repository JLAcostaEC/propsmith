# Output

What propsmith writes, and what it guarantees about the file it writes into.

## Cell reference

| column        | content                                                                                 |
| ------------- | --------------------------------------------------------------------------------------- |
| Name          | `` `name` `` in a code span; ``~~`name`~~`` when deprecated; badges appended as `_tag_` |
| Type          | the resolved type, per [types](./types.md); replaced verbatim by `@type` when present   |
| Default       | the `@default` value in a code span; empty when there is none                           |
| Description   | the first JSDoc paragraph, one line; `**Deprecated:** reason` appended when present     |
| a tag column  | the tag's text, or empty for a bare flag                                                |
| a summary row | the label in Name; every other column empty                                             |

Row order is **declaration order** — the order you see in the editor — with intersection summary
rows appended after the members. The heading of a tag column is the tag id Title Cased: `since`
becomes `Since`.

## Markdown, never HTML

The output is CommonMark plus a GFM table. HTML **entities** such as `&#124;` are used; an HTML
**tag** never is, so the tables stay portable to MDX, to sanitising renderers, to plain-text
consumers such as an `llms.md`, and to the diff. `assertNoHtml` enforces it on every region before
it is written or compared.

That is why a badge is `` `ref` _bindable_ `` rather than a `sup` element, and why a deprecation
notice shares the description's line rather than following a `br`.

## Pipes

A `|` inside a type would split the table cell, and `&#124;` does not decode inside a code span —
CommonMark treats it as literal text there. So a union is written as **one code span per member,
with the separator in plain text between them**:

```md
| `size` | `'small'` &#124; `'medium'` &#124; `'large'` |
```

This renders correctly everywhere, and the values can wrap in a narrow column. A pipe buried inside
a generic has no top-level separator to pull out, so the span is cut around it instead:

```md
| `filter` | `Omit<X, 'a'` &#124; `'b'>` |
```

Code spans are fenced defensively — the fence grows past the longest backtick run inside the
content, and content touching a backtick is padded — so a type containing a template literal cannot
break out of its span. Any other pipe that reaches a cell becomes `&#124;` as the row is assembled.

## The type is printed as you wrote it

Collapsed to one line, never `object`, never truncated for length alone. Length is a presentation
problem; the answer is `overflow-x: auto` on the docs table. Resolution can _add_ to what you wrote
— the values behind a name, a link, a key shape — but never removes it. See [types](./types.md).

## No headings

You write the `##` and `###` yourself. A docs site collects its table of contents from the headings
in the page and derives anchor ids from them, so a generated heading would join that navigation at
whatever level propsmith guessed; and a page often interleaves prose between two tables, so
position and level are yours to choose.

The single exception is the `@types` glossary region, where the headings _are_ the content and the
anchors are the reason the region exists. See [types](./types.md#the-glossary-region).

## Formatters realign tables

`oxfmt` and Prettier both rewrite a markdown table with every column padded to its widest cell, so
in a repo that formats markdown the table propsmith wrote is not the table that gets committed.

Two things make that a non-event:

1. **Comparison ignores padding.** `check` and the change detection compare tables cell by cell
   with the padding stripped, never byte for byte. This is the mechanism to rely on: alignment
   differences are invisible to drift detection whatever your formatter does.
2. **Tables are emitted already aligned**, to the width both formatters converge on, so `write`
   produces no formatting churn in the diff.

Run your formatter after `propsmith`, or let the pre-commit hook do it. Nothing breaks if you
don't.

## Idempotency and file preservation

- **Two runs produce identical bytes.** The region layout is a fixed point.
- **Line endings are preserved.** The file's dominant EOL is detected and the generated body is
  rewritten to match, so a CRLF file stays CRLF — otherwise Windows sees drift that Linux does not.
- **The final newline, or its absence, is preserved.** Only the bytes between the markers change.
- **Everything outside a region is untouched**, including whitespace.

Related: [markers](./markers.md), [cli](./cli.md), [types](./types.md).
