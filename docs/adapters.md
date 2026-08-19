# Adapters

Everything framework-specific lives in an adapter. The core knows only TypeScript syntax and
markdown, so adding a framework is a preset, not a fork.

There are two kinds. A **source adapter** says which files hold TypeScript and where inside them it
starts. An **i18n adapter** says where the catalog lives and what its syntax is.

## Source adapters

```ts
export interface ExtractedScript {
  /** TypeScript source to hand to the parser. */
  code: string;
  lang: "ts" | "tsx";
  /**
   * Byte offset of `code` inside the original file. Added back when computing
   * line and column so diagnostics point at the real file.
   */
  offset: number;
}

export interface SourceAdapter {
  name: string;
  /** File extensions this adapter claims, including the dot. */
  extensions: string[];
  /**
   * Pull TypeScript out of a file. Return `null` when the file holds nothing
   * parseable (a `.svelte` with no typed script block, for instance).
   */
  extract(source: string, filePath: string): ExtractedScript | null;
  /** Modules whose types become an `Element Attributes` row. */
  elementAttributeModules?: string[];
  /** Tags this adapter contributes, merged under the user's own `tags`. */
  tags?: Record<string, TagRender>;
}
```

`offset` is the field that is easy to get wrong and the one that matters most in practice. Every AST
span the extractor computes is relative to `code`; adding `offset` back is what keeps a diagnostic
pointing at line 47 of `Box.svelte` instead of line 3 of an anonymous fragment.

Adapters are tried **in configuration order**, and the first whose `extensions` contains the file's
extension wins, so list the more specific adapter first. The plain TypeScript reader is appended
last automatically, so a project with no framework at all still has an adapter that claims its
files. A file no adapter claims is skipped silently.

Import them from the `./adapters` subpath:

```ts
import { reactAdapter, svelteAdapter, typescriptAdapter } from "@jlacostaec/propsmith/adapters";
```

### `typescriptAdapter()` — the default

|                           |                                             |
| ------------------------- | ------------------------------------------- |
| extensions                | `.ts`, `.tsx`, `.mts`, `.cts`               |
| `extract`                 | the identity; `offset` is `0`               |
| `lang`                    | `"tsx"` for a `.tsx` file, `"ts"` otherwise |
| element-attribute modules | none                                        |
| tags                      | none                                        |

Always present, and you never list it — it is appended unless an adapter named `typescript` is
already in `adapters`. Listing it explicitly is only useful to change its position in the order.

### `svelteAdapter(options?)`

|                           |                                          |
| ------------------------- | ---------------------------------------- |
| extensions                | `.svelte`, `.svelte.ts`                  |
| element-attribute modules | `svelte/elements`                        |
| tags                      | `bindable: "badge"`, plus `options.tags` |

```ts
svelteAdapter({ tags: { experimental: "badge" } });
```

A `.svelte.ts` rune module is plain TypeScript and is passed through whole. A `.svelte` file has its
typed script block lifted out:

- Only blocks with `lang="ts"` or `lang="typescript"` are considered. A file with none returns
  `null` and is skipped.
- Prop types live in the module block when there is one, so a typed `<script module>` — or the
  legacy `<script context="module">` — wins over a typed instance block regardless of which comes
  first in the file.
- The attribute list is walked by a scanner rather than matched by a regular expression, so a
  `generics="T extends Record<string, X>"` attribute cannot end the tag early.

`bindable` is a badge here rather than in the core because it is Svelte-only.

### `reactAdapter(options?)`

|                           |                               |
| ------------------------- | ----------------------------- |
| extensions                | `.tsx`, `.ts`                 |
| `extract`                 | the identity; `offset` is `0` |
| element-attribute modules | `react`                       |
| tags                      | `options.tags` only           |

React props are already an exported type or interface in a regular file, so extraction is the
identity. The adapter exists for the one thing that is not: `react` is the module whose types
collapse into an `Element Attributes` row. React spells them `ButtonHTMLAttributes`, which does not
match the `HTML*Attributes` name pattern that Svelte's spelling does, so the module entry is what
recognises them.

There is no `bindable` equivalent in React, so the adapter carries no tags of its own.

## A custom source adapter: Vue SFC

A complete, working adapter for `.vue` single-file components. Props declared as an exported type
inside a `<script setup lang="ts">` block are in scope; a runtime `defineProps({ … })` is not, and
never will be — that is the boundary of the whole tool.

```ts
// tools/vue-adapter.ts
import type { ExtractedScript, SourceAdapter } from "@jlacostaec/propsmith/adapters";

/** Every `script` element in the file, with its attributes and its body. */
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

function isTyped(attributes: string): boolean {
  return /\blang\s*=\s*["'](ts|typescript)["']/i.test(attributes);
}

export function vueAdapter(): SourceAdapter {
  return {
    name: "vue",
    extensions: [".vue"],
    extract(source: string): ExtractedScript | null {
      SCRIPT_RE.lastIndex = 0;
      for (let match = SCRIPT_RE.exec(source); match !== null; match = SCRIPT_RE.exec(source)) {
        const [whole, attributes = "", code = ""] = match;
        if (!isTyped(attributes)) continue;
        // `offset` must point at `code` inside the original file, not at the tag.
        return { code, lang: "ts", offset: match.index + whole.indexOf(code) };
      }
      return null;
    },
  };
}
```

Wire it in:

```ts
// propsmith.config.ts
import { defineConfig } from "@jlacostaec/propsmith";
import { vueAdapter } from "./tools/vue-adapter.js";

export default defineConfig({
  sources: ["src/**/*.{ts,vue}"],
  adapters: [vueAdapter()],
  outputs: [{ name: "docs", files: ["docs/**/*.md"] }],
});
```

Given:

```vue
<template>
  <div class="card"><slot /></div>
</template>

<script setup lang="ts">
/** @propsmith Card */
export type CardProps = {
  /** Heading shown at the top of the card. */
  title: string;
  /** Visual density. @default 'comfortable' */
  density?: "comfortable" | "compact";
};

defineProps<CardProps>();
</script>
```

it produces:

```md
| Name      | Type                               | Default         | Description                           |
| --------- | ---------------------------------- | --------------- | ------------------------------------- |
| `title`   | `string`                           |                 | Heading shown at the top of the card. |
| `density` | `'comfortable'` &#124; `'compact'` | `'comfortable'` | Visual density.                       |
```

and a diagnostic about `title` would report line 7 of `Card.vue`, because of the `offset`.

Three things to check when writing your own:

1. **`offset` points at the first character of `code`**, not at the opening tag. Getting it wrong
   silently shifts every reported line.
2. **Return `null`, do not throw**, when the file holds nothing parseable. A `.vue` file with a
   plain JavaScript block is not an error.
3. **Choose one block.** `extract` returns a single script; if a format allows several, decide which
   one carries the prop types and say so in the adapter's own doc comment.

Adding `elementAttributeModules: ["vue"]` would collapse a `HTMLAttributes` intersection into a
single row, the same way Svelte and React do — worth it only if your components actually spread DOM
attributes through a typed intersection.

## A custom i18n adapter

The core owns the staleness algorithm; the adapter owns the file format. This one keeps a flat
`{ key: text }` JSON file per locale and writes plain `{{ key }}` placeholders into the markdown —
enough for a static-site generator that does its own interpolation.

```ts
// tools/json-i18n.ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Catalog, I18nAdapter, KeyContext } from "@jlacostaec/propsmith";

export interface JsonI18nOptions {
  /** Directory holding `<locale>.json`. */
  dir: string;
  /** The locale the English is written in. */
  source: string;
  /** Every locale, source included. */
  locales: string[];
  stalePath?: string;
}

/** paraglide-style keys: lowercase, digits and underscores. */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function snake(text: string): string {
  return text
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/^_+|_+$/g, "");
}

export function jsonI18n(options: JsonI18nOptions): I18nAdapter {
  const file = (locale: string): string => resolve(options.dir, `${locale}.json`);

  return {
    name: "json",

    locales() {
      return { source: options.source, all: [...options.locales] };
    },

    load() {
      const catalog: Catalog = {};
      for (const locale of options.locales) {
        try {
          catalog[locale] = JSON.parse(readFileSync(file(locale), "utf8")) as Record<
            string,
            string
          >;
        } catch {
          // A locale with no file yet is an empty catalog, not a failure.
          catalog[locale] = {};
        }
      }
      return catalog;
    },

    save(catalog: Catalog) {
      for (const [locale, messages] of Object.entries(catalog)) {
        // Alphabetical keys keep merge conflicts small and local.
        const ordered = Object.fromEntries(
          Object.entries(messages).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        );
        writeFileSync(file(locale), `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
      }
    },

    expression(key: string) {
      return `{{ ${key} }}`;
    },

    validateKey(key: string) {
      return IDENTIFIER.test(key) ? null : `\`${key}\` is not a lowercase identifier`;
    },

    // Every kind of text needs its own key, or two of them overwrite each
    // other in the catalog. propsmith reports a collision as `invalid-key`.
    key({ component, prop, kind, type }: KeyContext) {
      if (kind === "type") return `global_types_${snake(type ?? "")}`;
      if (kind === "label") return `${snake(component)}_${snake(prop)}`;
      const base = `${snake(component)}_props_${snake(prop)}`;
      return kind === "deprecated" ? `${base}_deprecated` : base;
    },

    ...(options.stalePath === undefined ? {} : { stalePath: options.stalePath }),
  };
}
```

```ts
// propsmith.config.ts
i18n: jsonI18n({
  dir: "./messages",
  source: "en",
  locales: ["en", "es"],
  stalePath: "./messages/{locale}.stale.json",
}),
```

Notes on the contract, in the order they bite:

- **`load` must not throw.** A locale whose file does not exist yet is an empty record. The first
  run of a new locale is the normal case, not an error.
- **`save` receives the whole catalog**, already invalidated and already merged. Preserve the
  format and the order of your tool's files; do not re-derive anything.
- **`expression(key)` is written into a markdown cell**, so it must contain no HTML and no raw pipe.
  See [output](./output.md).
- **`validateKey` returns the reason, or `null` when the key is legal.** That is the inverted sense
  it looks like; `null` means fine. A non-null result becomes an `invalid-key` error naming both the
  key and your message.
- **`key` is optional**, but if you write one it must return a distinct key per `kind` — see
  [i18n](./i18n.md#what-becomes-a-key). Without it, keys default to the naming described there.
- **`stalePath` is optional**, and `{locale}` is substituted. Without it, invalidated translations
  are dropped rather than parked, and the review queue disappears with them.

You never write the staleness logic, the hashing or the lockfile: those are core, so that every
adapter agrees about what is stale. See [i18n](./i18n.md#the-lockfile).

Related: [frameworks](./frameworks.md), [configuration](./configuration.md), [i18n](./i18n.md).
