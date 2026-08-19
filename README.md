# propsmith

**Turn TypeScript prop types into markdown tables that never go stale.**

Document a prop once, in the JSDoc right next to it. propsmith writes the table, keeps it matching
the code on every run, and tells CI the moment the two drift apart. One `@propsmith` tag, one marker
in a markdown file, five minutes — no type checker, no runtime, no headings you did not ask for.

## Source Of Truth

```ts
/** @propsmith Button */
export type ButtonProps = {
  /** The visual size of the button. */
  size?: Sizes;

  /** Whether the button is disabled. @default false */
  disabled?: boolean;

  /**
   * Visual style of the button.
   * @deprecated Use `variant` instead.
   */
  appearance?: string;
};

export type Sizes = "small" | "medium" | "large";
```

## Generated Table

```md
| Name             | Type                       | Default | Description                                                        |
| ---------------- | -------------------------- | ------- | ------------------------------------------------------------------ |
| `size`           | `"small"` &#124; `"large"` |         | The visual size of the button.                                     |
| `disabled`       | `boolean`                  | `false` | Whether the button is disabled.                                    |
| ~~`appearance`~~ | `string`                   |         | Visual style of the button. **Deprecated:** Use `variant` instead. |
```

`Sizes` was resolved from your source, not from the type checker. See [types](./docs/types.md).

## Install

```sh
pnpm add -D @jlacostaec/propsmith
```

Node 22 or newer, ESM only.

## Quick start (on project root)

```sh
pnpm propsmith init          # scaffold propsmith.config.ts
```

### Or without installing:

```sh
npx @jlacostaec/propsmith init
pnpm dlx @jlacostaec/propsmith init
```

## Minimal config

```ts
// propsmith.config.ts
import { defineConfig } from "@jlacostaec/propsmith";

export default defineConfig({
  sources: ["src/**/*.{ts,tsx}"],
  outputs: [{ name: "docs", files: ["docs/**/*.md"] }],
});
```

Put a marker where the table belongs — propsmith emits no headings, so the position and the level
are yours:

```md
## Props

<!-- props:Button -->
<!-- /props:Button -->
```

```sh
npx propsmith --dry-run     # print what it would write
npx propsmith               # write
npx propsmith check         # CI: 0 clean, 1 drift, 2 misuse
```

The full five-minute path is in [getting started](./docs/getting-started.md).

## What you get

- **The type as you wrote it.** Never `object`, never truncated. A named type is resolved from your
  own source and inlined, linked, or shown as its shape.
- **One description, reused.** A prop with no comment takes the description and the `@default` of
  the type it is declared with, so a shared `Variant` is documented once and only once.
- **`check` for CI.** Names the props that drifted and exits non-zero. A formatter realigning the
  table is not drift, so the check stays quiet until something is genuinely wrong.
- **Optional i18n.** Descriptions can route through a catalog — paraglide out of the box — with a
  lockfile that knows which translations the English moved out from under.

## AI-first

Documentation is context now, and half of what reads your props table is not a person: an agent
grepping the repo, an assistant with your docs in its window, an `llms.md` pasted into a prompt.
propsmith is built for that reader as much as for the human one.

- **No HTML. Ever.** CommonMark plus a GFM table, nothing else — every token in the output is
  content, not markup a plain-text reader has to strip first.
- **A machine lane beside the human one.** One run writes the rendered docs site _and_ an
  untranslated `llms.md`, from the same types, with different column sets if you want them.
- **The IR on stdout.** `propsmith --json` hands over the parsed props — names, types, defaults,
  tags, source locations — so a tool never has to parse your markdown back into data.
- **Context that cannot rot.** A stale table is a model confidently quoting a prop that no longer
  exists. `propsmith check` is how that stops being possible.

The tool itself calls no model and ships no AI dependency. It is a plain, fast CLI — the point is
what it produces.

## Documentation

| page                                         | what it covers                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| [getting started](./docs/getting-started.md) | install, `init`, first dry run, first write, `check` in CI               |
| [configuration](./docs/configuration.md)     | every config field, discovery order, the `package.json` shorthand        |
| [tags](./docs/tags.md)                       | `@propsmith`, `@default`, `@deprecated`, `@inheritDoc`, and custom tags  |
| [markers](./docs/markers.md)                 | marker syntax, named closes, fenced-block immunity, scanner diagnostics  |
| [types](./docs/types.md)                     | resolution, inherited descriptions, the glossary, `types.links`          |
| [output](./docs/output.md)                   | what a cell contains, and the guarantees about the file it is written to |
| [cli](./docs/cli.md)                         | every command and flag, exit codes, annotated output                     |
| [i18n](./docs/i18n.md)                       | the opt-in catalog lane, the keys, the lockfile, build ordering          |
| [adapters](./docs/adapters.md)               | source and i18n adapters, with a complete Vue SFC example                |
| [frameworks](./docs/frameworks.md)           | plain TypeScript, Svelte and React, end to end                           |

## Licence

MIT © Jorge Acosta. See [LICENSE.md](./LICENSE.md).
