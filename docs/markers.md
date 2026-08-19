# Markers

A marker pair is a region propsmith owns. Everything outside it belongs to the author and is never
touched.

```md
<!-- props:Button -->

| Name   | Type                        | Default | Description      |
| ------ | --------------------------- | ------- | ---------------- |
| `size` | `'small'` &#124; `'medium'` |         | The visual size. |

<!-- /props:Button -->
```

## Syntax

```
<!-- props:NAME -->     opening
<!-- /props:NAME -->    closing
```

- Whitespace inside the comment is optional and flexible: `<!--props:Button-->` and
  `<!--  props:Button  -->` are both accepted.
- `NAME` may contain letters, digits, `_`, `-` and `/`, and may start with a single `@`. A dot is
  not allowed.
- The `/` in a name is what namespaces do: `<!-- props:shared/Button -->` pairs with
  `@propsmith shared/Button`.
- More than one marker may appear on a line; each is matched independently.
- Names are matched exactly, case included.

The join with the source is the name and nothing else. There is no directory relationship between
`src/components/button.types.ts` and the file holding `<!-- props:Button -->`.

## The closing marker names what it closes

With six regions in one file, an anonymous close would swallow everything up to the next region and
report the error two hundred lines from its cause. A named close turns that into one message with
both line numbers.

## Built-in regions carry `@`

Regions that are not components are prefixed:

```md
<!-- props:@types -->
<!-- /props:@types -->
```

The `@` means "not a component name", so a glossary region cannot collide with a component called
`Types`, and future kinds (`@events`, `@css-vars`) need no new syntax.

`@types` is the glossary region — see [types](./types.md#the-glossary-region). A `@propsmith` tag
whose argument starts with `@` is rejected at extraction, so the two namespaces cannot cross.

## A lone opening marker is an invitation

Write one line:

```md
<!-- props:Tooltip -->
```

`write` inserts the closing marker and the table, leaving whatever followed exactly where it was.
`check` reports it as an `unpaired-marker` error, because check never fixes anything.

## Layout, and idempotency

Every region propsmith writes has the same shape:

```
opening marker line
(blank line)
body
(blank line)
closing marker line
```

An empty body collapses to marker, blank line, marker. From this follow the guarantees the CI check
depends on:

- **Two runs produce identical bytes.** The layout is a fixed point: re-scanning what was written
  and writing it again changes nothing.
- **The file's line endings are preserved.** The dominant EOL of the file is detected and the body
  is rewritten to match it, so a CRLF file stays CRLF. On Windows this is the difference between a
  clean `git status` and a permanently red CI.
- **The final newline, or its absence, is preserved.** Only the bytes between `openStart` and
  `closeEnd` are replaced.
- Regions are spliced last to first, so offsets from a single scan stay valid across several edits
  in one file.

## Markers inside a fenced code block are ignored

A page documenting propsmith contains markers as examples — this one does. The scanner tracks
fences and skips everything inside them:

````md
```md
This marker is an example and is not a region:

<!-- props:Example -->
```

This one is real:

<!-- props:Real -->
<!-- /props:Real -->
````

Fence handling follows CommonMark closely enough for the cases that matter:

- Both ` ``` ` and `~~~` open a fence, with up to three spaces of indentation.
- A closing fence must use the same character, be at least as long, and carry nothing after it.
- A backtick fence may not carry a backtick in its info string; a tilde fence may. So
  ` ```md ` opens a fence and ` ```js `code` ` does not.

Indented (four-space) code blocks are **not** recognised. A marker inside one is treated as real.
Use a fenced block for examples.

## Diagnostics

### From the scanner

| code                | severity | condition                                                                                   | fix                                                                      |
| ------------------- | -------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `unpaired-marker`   | error    | an opening marker with no close                                                             | add `<!-- /props:NAME -->`, or run `propsmith` and let `write` insert it |
| `mismatched-marker` | error    | a closing marker whose name is not the innermost open one — reported with both line numbers | correct the name on one of the two                                       |
| `mismatched-marker` | error    | a closing marker with nothing open                                                          | delete it, or add the matching opening marker above                      |
| `duplicate-marker`  | error    | the same name opened twice in one file                                                      | rename one region, or namespace it (`shared/Button`)                     |

A duplicated name is reported and **neither** copy becomes a region, so nothing is written into an
ambiguous location. An unpaired opening marker is still returned as a region — with an empty body —
which is exactly what lets `write` complete it while `check` refuses to.

When a closing marker matches a name that is open further out, everything nested inside it is
reported as unpaired and the outer region is closed. That recovery is what keeps one typo from
cascading into a page of errors.

### From the run

These need both sides — the markers and the tagged types — so they are reported by `check` and
`write`, not by the scanner.

| code                  | severity | condition                                              | fix                                             |
| --------------------- | -------- | ------------------------------------------------------ | ----------------------------------------------- |
| `marker-without-tag`  | error    | a marker whose name matches no `@propsmith`            | fix the name, add the tag, or delete the region |
| `tag-without-marker`  | error    | a `@propsmith` name with no marker in any output       | add a region somewhere, or `@internal` the type |
| `duplicate-component` | error    | one `@propsmith` name on two types                     | namespace one of them                           |
| `table-drift`         | error    | the region's body differs from what would be generated | run `propsmith`                                 |

A `table-drift` message names the props that gained or lost a row, so the fix is visible without
diffing two tables by eye.

`tag-without-marker` is the finding that matters most: a component documented nowhere is invisible
to everyone, and no amount of reading the docs site reveals it.

## Editing inside a region

Don't — it is overwritten on the next `write`. To change what a cell says, change the JSDoc. See
[tags](./tags.md).

Related: [output](./output.md), [cli](./cli.md).
