# Getting started

From nothing to a generated props table in five minutes, then into CI.

## Requirements

- Node 22 or newer. propsmith is ESM only.
- Props declared as an **exported TypeScript type or interface**. That is the whole boundary — see
  [frameworks](./frameworks.md) for the three shapes that fit it.

## 1. Install

```sh
pnpm add -D @jlacostaec/propsmith
```

## 2. Tag a type

propsmith only sees types carrying the `@propsmith` tag. The tag's argument is the **name**, and
that name is the only join between the type and the table — never a path.

```ts
// src/components/button.types.ts

/** @propsmith Button */
export type ButtonProps = {
  /** The visual size of the button. */
  size?: Sizes;

  /** Whether the button is disabled. @default false */
  disabled?: boolean;
};

export type Sizes = "small" | "medium" | "large";
```

`Sizes` is exported on purpose: only exported declarations enter the symbol index, and only indexed
names can be resolved into their values. See [types](./types.md).

## 3. Scaffold the config

```sh
npx propsmith init
```

`init` detects the framework, looks for `project.inlang`, counts the files that already carry
`@propsmith` and the files that already carry markers, and writes a filled-in
`propsmith.config.ts`:

```
$ propsmith init

  ✓ detected Svelte (svelte.config.js)
  ✓ detected paraglide (project.inlang/settings.json — locales: en, es)
  ✓ found 29 type files under src/lib/components/*/
  ✓ found 32 files containing props markers

  wrote propsmith.config.ts
  next: propsmith --dry-run
```

The minimum it can write is two fields:

```ts
// propsmith.config.ts
import { defineConfig } from "@jlacostaec/propsmith";

export default defineConfig({
  sources: ["src/**/*.{ts,tsx}"],
  outputs: [{ name: "docs", files: ["docs/**/*.md"] }],
});
```

If Node refuses to import a `.ts` config on your version, rename it to `propsmith.config.mjs` — the
caveat and its exact error message are in [configuration](./configuration.md#a-ts-config-and-node).

## 4. Place a marker

propsmith writes only between markers. It never creates a file and never invents a location — the
author decides where the table goes and at what heading level, because propsmith emits no headings
of its own.

```md
## Props

<!-- props:Button -->
<!-- /props:Button -->
```

A lone opening marker is enough; `write` inserts the close for you. Full syntax in
[markers](./markers.md).

## 5. Dry run

```sh
npx propsmith --dry-run
```

Nothing is written. The tables that would be written are printed instead:

```md
| Name       | Type                                         | Default | Description                     |
| ---------- | -------------------------------------------- | ------- | ------------------------------- |
| `size`     | `'small'` &#124; `'medium'` &#124; `'large'` |         | The visual size of the button.  |
| `disabled` | `boolean`                                    | `false` | Whether the button is disabled. |
```

The pipes are `&#124;` in plain text between the code spans rather than inside them, because an
entity does not decode inside a code span. See [output](./output.md#pipes).

## 6. Write

```sh
npx propsmith
```

Bare `propsmith` writes — it is a generator, like `prisma generate`, so the safety net is
`git diff`, not a confirmation prompt.

Run it twice: the second run produces identical bytes, and the file's existing line endings and
final newline survive untouched. That is what makes the CI check below trustworthy on Windows as
well as Linux.

## 7. Wire `check` into CI

`check` writes nothing and reports drift. Add both scripts:

```json
{
  "scripts": {
    "docs": "propsmith",
    "docs:check": "propsmith check"
  }
}
```

```yml
- name: Docs
  run: pnpm docs:check
```

Exit codes are `0` clean, `1` drift or errors, `2` invalid config or misuse — CI has to be able to
tell a stale table from a broken config. Every flag and every reported finding is in
[cli](./cli.md).

If a formatter (oxfmt, Prettier) rewrites markdown in your repo, it will realign the tables
propsmith writes. That is expected and does not cause drift: comparison strips the padding before
comparing. See [output](./output.md#formatters-realign-tables).

## Where to go next

| you want to                                | read                                                     |
| ------------------------------------------ | -------------------------------------------------------- |
| know every config field                    | [configuration](./configuration.md)                      |
| control what a cell says                   | [tags](./tags.md)                                        |
| stop repeating a shared type's description | [types](./types.md#inherited-descriptions)               |
| understand marker errors                   | [markers](./markers.md)                                  |
| make `size?: Sizes` show its values        | [types](./types.md)                                      |
| add Svelte, React or Vue                   | [frameworks](./frameworks.md), [adapters](./adapters.md) |
| route descriptions through an i18n catalog | [i18n](./i18n.md)                                        |
