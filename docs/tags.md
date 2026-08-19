# Tags

Three tiers, by how much propsmith knows about each.

1. **Structural** — always understood, never declared.
2. **Flags** — declared in `tags`, rendered as a badge or as a column.
3. **Everything else** — parsed, kept in the IR, never rendered.

## How a JSDoc block is read

**The description is the first paragraph only.** Everything after the first blank line stays in the
IR as `descriptionFull` and never reaches a cell — a cell is one line.

**A tag runs until the next line that begins with `@`.** A tag may share the summary line, but only
one can:

```ts
/** Kept. @default 1 @deprecated Use `b`. */
a?: number;
```

reads as `@default` with the text ``1 @deprecated Use `b`.`` — the deprecation is swallowed. Write
one tag per line, and keep at most one on the summary line:

```ts
/**
 * Kept.
 * @default 1
 * @deprecated Use `b`.
 */
b?: number;
```

That yields `default: "1"` and ``deprecated: "Use `b`."``. Tag text can therefore span lines, which
`@deprecated` and `@see` both need.

A tag opens at the start of a line or after whitespace, so `user@example.com` and `{@link Foo}` in
prose are not tags.

## Tier 1 — structural

| tag                    | on             | effect                                                                                                    |
| ---------------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| `@propsmith <Name>`    | the **type**   | declares which component this type documents. Repeatable. Accepts a namespace: `@propsmith shared/Button` |
| `@default <value>`     | member or type | fills the Default column, verbatim, in a code span                                                        |
| `@internal`            | member or type | excludes it from the table without making it private in code                                              |
| `@deprecated [reason]` | a **member**   | strikes the name; the reason is appended to the description, inline                                       |
| `@see <target>`        | a **member**   | explicit link for that type. Wins over everything, including resolution                                   |
| `@inheritDoc [Name]`   | a **member**   | take the description and `@default` from a type, named or the member's own                                |
| `@type <text>`         | a **member**   | overrides the Type cell entirely. Last resort, and `check` reports every use                              |

`@internal`, `@deprecated`, `@see` and `@inheritDoc` are TSDoc standard: if the IDE already shows
it, propsmith honours it instead of inventing a synonym.

### `@propsmith <Name>`

Mandatory. A type named `ButtonProps` with no tag does not exist for propsmith, which is what makes
a wide `sources` glob safe: the selector is the tag, never the path.

It is also the only join between a type and its table. `@propsmith Button` matches
`<!-- props:Button -->` wherever that marker lives.

Names are therefore a **global namespace**. A duplicate across two files is a `duplicate-component`
error listing both. Disambiguate with a namespace:

```ts
/** @propsmith shared/Button */
export type ButtonProps = { … };
```

matched by `<!-- props:shared/Button -->`.

Repeatable, on separate lines, when one type documents more than one component:

```ts
/**
 * @propsmith shared/ListViewItem
 * @propsmith ListViewItem
 */
export type ListViewItemProps<T, K extends keyof T = keyof T> = {
  /** The item. */
  item: T;
};
```

Both names get the same rows. Type parameters are recorded verbatim in the IR
(`["T", "K extends keyof T = keyof T"]`) and do not appear in the table.

Only the first word after the tag is the name; the rest of the line is ignored. A name beginning
with `@` is an error — `@` is reserved for built-in regions, see [markers](./markers.md).

### `@default <value>`

```ts
/** Whether the button is disabled. @default false */
disabled?: boolean;
```

```md
| `disabled` | `boolean` | `false` | Whether the button is disabled. |
```

The value is verbatim, so `@default 'button'` renders as `` `'button'` `` with the quotes intact.
propsmith never reads the component implementation, so a `@default` that disagrees with the code is
written out as-is.

On a **type**, `@default` becomes the default of every prop declared with that type that does not
state its own — see [`@inheritDoc`](#inheritdoc-name).

### `@internal`

On a member, the row disappears. No diagnostic: hiding it is what was asked for.

```ts
/**
 * Registry injected by ButtonGroup.
 * @internal
 */
__group?: ButtonGroupContext;
```

On a type, no component is produced, but the declaration still enters the symbol index so other
types can resolve references to it:

```ts
/**
 * @propsmith Hidden
 * @internal
 */
export type HiddenProps = { a?: string };
```

Note the two tags on separate lines. `/** @propsmith Hidden @internal */` does **not** work:
`@internal` becomes part of the `@propsmith` tag's text.

### `@deprecated [reason]`

```ts
/**
 * Visual style of the button.
 * @deprecated Use `variant` instead. Removed in 3.0.
 */
appearance?: string;
```

```md
| ~~`appearance`~~ | `string` | | Visual style of the button. **Deprecated:** Use `variant` instead. Removed in 3.0. |
```

The name is struck through and the reason is appended on the same line. A bare `@deprecated` with
no reason yields `**Deprecated.**` instead.

In an output with `description: "i18n"`, the reason and the word introducing it are both catalog
messages — see [i18n](./i18n.md#what-becomes-a-key).

### `@see <target>`

```ts
/** Content rendered inside the button. @see https://svelte.dev/docs/svelte/snippet */
children?: Snippet;
```

```md
| `children` | [`Snippet`](https://svelte.dev/docs/svelte/snippet) | | Content rendered inside the button. |
```

The target is used verbatim as the link destination — a URL, or any relative path your site
resolves. It wins over `types.links`, over the glossary, and over resolution.

It applies only where the type is a bare name or a generic reference. On a member typed
`'a' | 'b'` there is no name to link, so the tag has no visible effect.

### `@inheritDoc [Name]`

Take the description — and the `@default` — from a type instead of repeating them:

```ts
/**
 * The visual style of a control.
 * @default "primary"
 */
export type Variant = "primary" | "ghost" | "danger";

/** @propsmith Button */
export type ButtonProps = {
  variant?: Variant;

  /** @inheritDoc Variant */
  fallback?: string;
};
```

```md
| `variant` | `"primary"` &#124; `"ghost"` &#124; `"danger"` | `"primary"` | The visual style of a control. |
| `fallback` | `string` | `"primary"` | The visual style of a control. |
```

`variant` needs no tag: an undocumented prop looks at its own type automatically. The tag is for
the cases where that is not enough — a prop whose own type says nothing, or one that should borrow
from a different type. Inheritance only ever fills what is missing; a prop's own sentence and its
own `@default` always win.

Full rules, including how to turn the automatic half off, in [types](./types.md#inherited-descriptions).

### `@type <text>`

The escape hatch. It replaces the Type cell with your text, unmodified:

```ts
/** Layout override. @type A CSS length */
width?: number | string;
```

```md
| `width` | A CSS length | | Layout override. |
```

Because it permits a table that disagrees with the code, **every use is reported by `check`** as a
`type-override-used` warning.

## Tier 2 — flags

A tag propsmith has no opinion about becomes visible by being declared in `tags`:

```ts
tags: {
  bindable: "badge",
  experimental: "badge",
  since: "column",
},
```

### As a badge

```ts
/**
 * The underlying DOM node.
 * @bindable
 */
ref?: HTMLButtonElement;
```

```md
| `ref` _bindable_ | `HTMLButtonElement` | | The underlying DOM node. |
```

The tag name in italics, appended to the Name cell, in the order the keys appear in `tags`. A badge
shows the tag's presence, not its text: `@bindable value` still renders `_bindable_`.

### As a column

```ts
tags: { since: "column" },
```

```ts
/** Sorting strategy. @since 2.4.0 */
sort?: SortMode;
```

```md
| Name   | Type       | Default | Description       | Since |
| ------ | ---------- | ------- | ----------------- | ----- |
| `sort` | `SortMode` |         | Sorting strategy. | 2.4.0 |
```

The column is appended to every output's column set unless the output already lists it by name, in
which case its declared position is kept. The heading is the tag id Title Cased. A bare tag with no
text renders an empty cell.

The Svelte adapter ships `bindable` as a badge; React ships none. See [adapters](./adapters.md).

## Tier 3 — everything else

Any other tag is parsed and ignored **by the table**. `@example`, `@remarks` and friends do not
reach a cell, do not warn, and do not break anything.

They do reach the IR. `MemberDoc.flags` carries every non-structural tag it finds, declared or not,
so a renderer working off `--json` can use a tag propsmith has never heard of:

```ts
/**
 * The rows to render.
 * @remarks Virtualised past 200 items.
 * @since 2.3.0
 */
items: T[];
```

```jsonc
// propsmith --json, trimmed
{
  "name": "items",
  "type": "T[]",
  "description": "The rows to render.",
  "flags": { "remarks": "Virtualised past 200 items.", "since": "2.3.0" },
}
```

Neither tag appears in the table until one is declared in `tags`. Tier 1 tags stay out of `flags`,
because they already have dedicated fields — with one deliberate exception: declare `deprecated` in
`tags` and it appears in `flags` too, which is how you get a Deprecated column alongside the
strikethrough.

## What `check` reports about tags

| finding               | severity | cause                                                           |
| --------------------- | -------- | --------------------------------------------------------------- |
| `missing-description` | warning  | a member that ends up with no description, inheritance included |
| `type-override-used`  | warning  | any `@type`                                                     |
| `duplicate-component` | error    | one `@propsmith` name on two types                              |
| `config-invalid`      | error    | `@propsmith` with no name, or a name beginning with `@`         |
| `tag-without-marker`  | error    | a tagged type documented nowhere                                |

Related: [markers](./markers.md), [types](./types.md), [output](./output.md).
