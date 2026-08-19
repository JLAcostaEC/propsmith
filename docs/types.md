# Types

`size?: Sizes` printed verbatim tells the reader nothing, and in a design system that is the common
case. propsmith resolves it — **syntactically, never with the TypeScript checker.**

## The symbol index

Every **exported** type alias and interface propsmith parses is filed by name. When a Type cell hits
a name it would otherwise print bare, it asks the index for the declaration and takes its literal
text.

- **On demand.** Files are parsed because they carry `@propsmith`; a name that comes up short
  triggers a second, narrower pass for exactly that name.
- **Exported only.** A `type NotExported = { … }` is invisible to the index. If you want a name
  resolved, export it.
- **A flat, global namespace.** The join is the name, never the path, so two exported `Options`
  types in two files are one entry and the last one scanned wins. Give them distinct names.

## One level, no recursion

A name resolves to its declaration text and **stops**. Names inside that text are not resolved
again.

```ts
export type Panel = { animation: ExpanderAnimation };
export type ExpanderAnimation = { duration: number; easing: Easing };
export type Easing = "linear" | "ease-in" | "ease-out";
```

`animation` renders as `` `{ duration: number; easing: Easing }` ``. `Easing` stays a name. This is
what keeps an `HTMLButtonAttributes` reference from expanding three hundred DOM members into a
cell.

## `inlineUnder`

```ts
types: {
  inlineUnder: 60;
}
```

The maximum length, in characters, of a resolved definition that may be printed **in place of** the
name. Default `60`; `0` disables inlining and sends every resolved name down the chain below.

## The cell, in order

Given `types: { inlineUnder: 60, links: { Snippet: "https://svelte.dev/docs/svelte/snippet" } }`:

| #   | situation                               | cell                                                                                        |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | resolved, fits `inlineUnder`            | `` `'small'` `` &#124; `` `'medium'` `` &#124; `` `'large'` ``                              |
| 2   | resolved, too long, glossary configured | ``[`LogLevel`](/docs/types#loglevel)``                                                      |
| 3   | resolved, too long, no glossary         | `` `ExpanderAnimation` `` `` `{ duration, easing, delay, … (4 keys) }` `` — **check warns** |
| 4   | unresolved, in `types.links`            | ``[`Snippet`](https://svelte.dev/docs/svelte/snippet)``                                     |
| 5   | unresolved, not in `types.links`        | `` `Dayjs` `` — **check warns**                                                             |

**What you wrote is never removed; resolution can only add.** Row 3 keeps the name — the thing you
type in your code — and appends the shape rather than replacing one with the other. Rows 3 and 5
are the only dead cells, and both are reported.

### Row 1 — inlined

```ts
export type Sizes = "small" | "medium" | "large";
```

```md
| `size` | `'small'` &#124; `'medium'` &#124; `'large'` | | The visual size. |
```

The definition is re-split at its top-level pipes so each member gets its own code span — see
[output](./output.md#pipes).

### Row 3 — degraded shape

With no `types.glossary`, a resolved-but-long declaration keeps its name and appends what it is:

| declaration   | appended                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------- |
| object        | `` `{ duration, easing, delay, … (4 keys) }` `` — first three keys, then a count          |
| union         | `` `'silent'` `` &#124; `` `'error'` `` &#124; `` `'warn'` `` &#124; `` `… (5 values)` `` |
| anything else | nothing; the bare name                                                                    |

Both forms are `type-too-long` warnings. The fix is usually a glossary, occasionally a smaller
named type.

### Row 5 — unresolvable

A bare name with no declaration in the index and no entry in `types.links` renders as itself and
warns with `unresolved-type`. That includes **DOM interfaces**: `HTMLButtonElement` is not something
propsmith parses, so `ref?: HTMLButtonElement` warns until you add it to `types.links`. Intrinsic
keywords — `string`, `number`, `boolean`, `void`, `unknown`, `never`, `null`, `undefined`, `object`,
`symbol`, `bigint`, `any`, `this`, `true`, `false` — are never looked up and never reported.

## `types.links`

```ts
types: {
  links: {
    Snippet: "https://svelte.dev/docs/svelte/snippet",
    ReactNode: "https://react.dev/reference/react/ReactNode",
    Dayjs: "https://day.js.org/docs/en/parse/parse",
    HTMLButtonElement: "https://developer.mozilla.org/docs/Web/API/HTMLButtonElement",
  },
}
```

The map for types propsmith can **never** resolve: they come from a dependency, from the DOM, or
from a `.d.ts` outside `sources`. A name found here is linked instead of warned about, which keeps
the `unresolved-type` list a genuine to-do list rather than permanent noise.

`@see` on a member wins over `types.links`, over the glossary, and over resolution — see
[tags](./tags.md#see-target).

## Inherited descriptions

A prop with **no description** takes the one on the type it is declared with, and a prop with **no
`@default`** takes that type's `@default`:

```ts
// tokens.ts

/**
 * The visual style of a control.
 * @default "primary"
 */
export type Variant = "primary" | "ghost" | "danger";
```

```ts
// button.types.ts

/** @propsmith Button */
export type ButtonProps = {
  variant?: Variant;
};
```

```md
| `variant` | `"primary"` &#124; `"ghost"` &#124; `"danger"` | `"primary"` | The visual style of a control. |
```

The rules:

- **Only what is missing is filled.** A prop's own sentence and its own `@default` always win, and
  the two are independent — a documented prop with no default still borrows the default.
- **The type must be one name.** `Variant` and `Options<T>` qualify, and so does `Variant | null`.
  A literal union, an array, a function type or an inline object has no single declaration to
  inherit from.
- **The type must be exported**, like anything else the index has to find.
- **One level.** The type's own description is used as written; it does not itself inherit.
- **`@inheritDoc [Name]`** asks explicitly, and can name a different type — see
  [tags](./tags.md#inheritdoc-name).
- **A prop that ends up with no description is a `missing-description` warning**, and the message
  says whether a type was consulted and came back empty too.

Turn the automatic half off with `types.inherit: false`; `@inheritDoc` keeps working.

With the i18n lane on, an inherited description is **one shared catalog key**
(`global_types_variant`), so it is translated once no matter how many props use it. See
[i18n](./i18n.md#what-becomes-a-key).

## The glossary region

```ts
types: {
  glossary: "/docs/types";
}
```

Set it and row 2 replaces row 3: a resolved-but-long type is linked to
`/docs/types#<lowercased-name>`. The anchor matches what a docs site derives from a heading of the
same text.

The definitions go in a `@types` region, wherever you like:

```md
# Types

<!-- props:@types -->

### ExpanderAnimation

`{ duration: number; easing: string; delay: number }`

### LogLevel

`'silent' | 'error' | 'warn' | 'info' | 'debug'`

<!-- /props:@types -->
```

Entries are alphabetical, each a `###` heading followed by the definition as a code span. This is
the only place propsmith emits a heading, because the anchors are the whole point of the region.

`glossary` is a **URL**, not a file path: propsmith can find the region by its marker, but cannot
know that `docs/types.md` is served at `/docs/types`. For a same-file glossary — one page carrying
both the tables and the definitions, which is what an `llms.md` needs — set it to `"#"`.

There is no default. Without `types.glossary` there is no glossary, and long types degrade to row 3
with a warning. An output may override the base for its own files:

```ts
outputs: [
  { name: "site", files: ["docs/**/*.svx"], glossary: "/docs/types" },
  { name: "llms", files: ["docs/llms.md"], glossary: "#" },
],
```

## What is never resolved

Resolution applies to a **bare name** or a **generic reference**, at the top level of the type or of
one of its top-level union members. Everything else is composed text and is printed exactly as
written:

| type text                       | cell                                    | why                                                                   |
| ------------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| `(value: string) => void`       | `` `(value: string) => void` ``         | a function type, not a name                                           |
| `Option[]`                      | `` `Option[]` ``                        | an array, not a name                                                  |
| `Omit<X, 'a' \| 'b'>`           | `` `Omit<X, 'a'` `` &#124; `` `'b'>` `` | a generic with no declaration; the span is cut around the buried pipe |
| `{ id: string; label: string }` | `` `{ id: string; label: string }` ``   | anonymous, and short                                                  |

Names buried inside composed text — `MouseEvent` in `(event: MouseEvent) => void` — are neither
resolved nor reported.

An **anonymous** object type longer than `inlineUnder` degrades to its key shape alone:

```ts
{
  duration: number;
  easing: string;
  delay: number;
  reduced: boolean;
  extra: string;
}
```

renders as `` `{ duration, easing, delay, … (5 keys) }` ``. It carries no name, so there is nothing
to link and nothing to report — but the reader still gets the shape, never the word `object`. If
you read that cell often, extract a named type.

## Intersections

An intersection member that is not an object literal does not expand into rows. It becomes one
summary row:

| intersection member                                                                    | row                                                                                  |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| a type from an element-attribute module, or named `HTML*Attributes` / `SVG*Attributes` | `Element Attributes (button)` — the element from the type argument, or from the name |
| `Pick<FSInput, 'placeholder' \| 'disabled'>`                                           | `` `placeholder`, `disabled` from FSInput ``                                         |
| `Omit<X, 'a'>`                                                                         | the same form, from the remaining keys                                               |
| a bare reference to another type                                                       | the reference, verbatim                                                              |

The keys of a `Pick` or an `Omit` are string literals in the AST, so they are read directly. An
interface's `extends` clauses are handled identically. Summary rows carry a Name cell and nothing
else.

Related: [tags](./tags.md), [output](./output.md), [configuration](./configuration.md#types).
