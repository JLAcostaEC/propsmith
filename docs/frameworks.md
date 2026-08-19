# Frameworks

propsmith documents **props declared as an exported TypeScript type or interface.** That is the
whole boundary.

| works                                                     | does not work                           |
| --------------------------------------------------------- | --------------------------------------- |
| a plain TypeScript library with an options object         | Vue with a runtime `defineProps({ … })` |
| Svelte, with the type in a `script` block or a `.ts` file | React with untyped destructured props   |
| React, `type ButtonProps = { … }`                         | JavaScript with PropTypes               |
| Solid, Qwik, Astro, anything TypeScript                   |                                         |

Props declared **inside** a `.svelte` or `.vue` single-file component are reachable through a source
adapter that lifts the typed script block out before parsing — see [adapters](./adapters.md).

Three shapes, end to end. Every table below is real output.

## Plain TypeScript

No framework at all. A library with an options object is the baseline case, and it needs no adapter
and no preset.

### Source

```ts
// src/server/options.ts

/** @propsmith createServer */
export interface CreateServerOptions {
  /** Port the server listens on. @default 3000 */
  port?: number;

  /** Hostname to bind to. @default '127.0.0.1' */
  host?: string;

  /** How the server logs. */
  logLevel?: LogLevel;

  /** Called once the server is listening. */
  onReady?(address: string): void;

  /**
   * Directory served as static assets.
   * @deprecated Use `assets` instead.
   */
  publicDir?: string;
}

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";
```

### Config

```ts
// propsmith.config.ts
import { defineConfig } from "@jlacostaec/propsmith";

export default defineConfig({
  sources: ["src/**/*.ts"],
  outputs: [{ name: "docs", files: ["docs/**/*.md"] }],
});
```

### Docs file

```md
## Options

<!-- props:createServer -->
<!-- /props:createServer -->
```

### Generated

```md
| Name            | Type                                                                         | Default       | Description                                                              |
| --------------- | ---------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| `port`          | `number`                                                                     | `3000`        | Port the server listens on.                                              |
| `host`          | `string`                                                                     | `'127.0.0.1'` | Hostname to bind to.                                                     |
| `logLevel`      | `'silent'` &#124; `'error'` &#124; `'warn'` &#124; `'info'` &#124; `'debug'` |               | How the server logs.                                                     |
| `onReady`       | `(address: string) => void`                                                  |               | Called once the server is listening.                                     |
| ~~`publicDir`~~ | `string`                                                                     |               | Directory served as static assets. **Deprecated:** Use `assets` instead. |
```

`LogLevel` was resolved from source and inlined because its definition fits `inlineUnder`. The
method signature `onReady?(address: string): void` was rebuilt as a function type. Nothing here
needed configuring.

## Svelte

### Source

```svelte
<!-- src/lib/AutoSuggestBox.svelte -->
<script lang="ts" module>
  import type { HTMLInputAttributes } from "svelte/elements";
  import type { Snippet } from "svelte";
  import type { FSInput } from "./input.types.js";

  /** @propsmith AutoSuggestBox */
  export type AutoSuggestBoxProps = {
    /**
     * Text currently in the box.
     * @bindable
     */
    value?: string;

    /** Options offered in the popup. */
    options: Option[];

    /** How the popup is sized. @default 'auto' */
    popupWidth?: PopupWidth;

    /** Rendered for each option. @see https://svelte.dev/docs/svelte/snippet */
    option?: Snippet<[Option]>;
  } & Pick<FSInput, "placeholder" | "disabled"> & HTMLInputAttributes;

  export type Option = { id: string; label: string };

  export type PopupWidth = "auto" | "anchor" | "wide";
</script>

<input />
```

The type lives in the **module** block. The Svelte adapter prefers a typed `script module` over a
typed instance block, because that is where prop types belong; a plain `script lang="ts"` instance
block works too.

### Config

```ts
import { defineConfig } from "@jlacostaec/propsmith";
import { svelteAdapter } from "@jlacostaec/propsmith/adapters";

export default defineConfig({
  sources: ["src/lib/**/*.{ts,svelte}"],
  adapters: [svelteAdapter()],
  outputs: [{ name: "site", files: ["docs/**/footer.svx"] }],
  tags: { bindable: "badge" },
  types: {
    links: { Snippet: "https://svelte.dev/docs/svelte/snippet" },
  },
});
```

`tags: { bindable: "badge" }` is redundant here — the Svelte adapter already contributes it — and is
shown so the mechanism is visible. Listing it explicitly is how you change it to `"column"`.

### Generated

```md
| Name                                   | Type                                                          | Default  | Description                   |
| -------------------------------------- | ------------------------------------------------------------- | -------- | ----------------------------- |
| `value` _bindable_                     | `string`                                                      |          | Text currently in the box.    |
| `options`                              | `Option[]`                                                    |          | Options offered in the popup. |
| `popupWidth`                           | `'auto'` &#124; `'anchor'` &#124; `'wide'`                    | `'auto'` | How the popup is sized.       |
| `option`                               | [`Snippet<[Option]>`](https://svelte.dev/docs/svelte/snippet) |          | Rendered for each option.     |
| `placeholder`, `disabled` from FSInput |                                                               |          |                               |
| Element Attributes (input)             |                                                               |          |                               |
```

Four things happened:

- `@bindable` became `_bindable_`, from the adapter's tag.
- `PopupWidth` was resolved and inlined; `Option[]` is an array, not a bare name, so it stays as
  written.
- `@see` linked `Snippet<[Option]>` with its type argument intact — the label keeps what the author
  wrote.
- The two intersection branches became summary rows: the `Pick` listed its literal keys, and
  `HTMLInputAttributes` collapsed to one row instead of expanding a hundred DOM attributes.

## React

### Source

```tsx
// src/components/Button.tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";

/** @propsmith Button */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The visual size of the button. */
  size?: Sizes;

  /** Content rendered inside the button. */
  children?: ReactNode;

  /**
   * Called when the button is activated.
   * @since 2.4.0
   */
  onPress?(event: MouseEvent): void;

  /**
   * Visual style of the button.
   * @deprecated Use `variant` instead.
   */
  appearance?: string;
}

export type Sizes = "small" | "medium" | "large";
```

An `interface … extends` is handled exactly like an intersection: the heritage clauses become
summary rows.

### Config

```ts
import { defineConfig } from "@jlacostaec/propsmith";
import { reactAdapter } from "@jlacostaec/propsmith/adapters";

export default defineConfig({
  sources: ["src/**/*.{ts,tsx}"],
  adapters: [reactAdapter()],
  outputs: [{ name: "docs", files: ["docs/**/*.md"] }],
  tags: { since: "column" },
  types: {
    links: { ReactNode: "https://react.dev/reference/react/ReactNode" },
  },
});
```

### Generated

```md
| Name                        | Type                                                       | Default | Description                                                        | Since |
| --------------------------- | ---------------------------------------------------------- | ------- | ------------------------------------------------------------------ | ----- |
| `size`                      | `"small"` &#124; `"medium"` &#124; `"large"`               |         | The visual size of the button.                                     |       |
| `children`                  | [`ReactNode`](https://react.dev/reference/react/ReactNode) |         | Content rendered inside the button.                                |       |
| `onPress`                   | `(event: MouseEvent) => void`                              |         | Called when the button is activated.                               | 2.4.0 |
| ~~`appearance`~~            | `string`                                                   |         | Visual style of the button. **Deprecated:** Use `variant` instead. |       |
| Element Attributes (button) |                                                            |         |                                                                    |       |
```

Note the double quotes in the `size` cell: the type is printed **as the author wrote it**, and the
source used `"small"`. The Svelte example above used `'small'` and got single quotes. propsmith does
not normalise your quote style.

`since: "column"` added a column to the end of the set, with the tag's text as its value.
`ButtonHTMLAttributes<HTMLButtonElement>` collapsed to `Element Attributes (button)` — the element
came from the type argument. React's `Xxx HTMLAttributes` spelling is recognised because the React
adapter lists `react` in `elementAttributeModules`; the Svelte-style `HTMLInputAttributes` spelling
is recognised by name alone.

## Vue, and other single-file formats

Not shipped as a preset, but roughly twenty lines. A complete, working `.vue` adapter is in
[adapters](./adapters.md#a-custom-source-adapter-vue-sfc), including the one thing that is easy to
get wrong: `offset` must point at the first character of the extracted code, or every reported line
number is shifted.

The same shape works for Astro, for a custom template format, or for anything else with a typed
script block. What does not work, in any framework, is props that exist only at runtime — a
`defineProps({ title: String })` has no type to read, and propsmith does not run a checker or read
the component implementation to guess one.

Related: [adapters](./adapters.md), [tags](./tags.md), [types](./types.md).
