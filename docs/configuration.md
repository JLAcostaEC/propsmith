# Configuration

The authored shape is `PropsmithConfig`. Every field is validated before the run: bad input becomes
a diagnostic, never an exception, and every problem is reported in one pass.

```ts
// propsmith.config.ts
import { defineConfig } from "@jlacostaec/propsmith";
import { svelteAdapter } from "@jlacostaec/propsmith/adapters";

export default defineConfig({
  sources: ["src/**/*.{ts,tsx,svelte}"],
  ignore: ["**/*.{test,spec}.ts", "**/*.stories.*"],
  adapters: [svelteAdapter()],

  outputs: [
    {
      name: "site",
      files: ["docs/**/footer.svx"],
      columns: ["name", "type", "default", "description"],
      description: "text",
    },
  ],

  tags: { bindable: "badge", since: "column" },

  types: {
    inlineUnder: 60,
    glossary: "/docs/types",
    links: { Snippet: "https://svelte.dev/docs/svelte/snippet" },
  },

  lockfile: "propsmith.lock.json",
});
```

`defineConfig` is the identity function. It exists only so the authored object is type checked.

## Fields

| field                     | type                        | default                       | notes                                                                                    |
| ------------------------- | --------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `sources`                 | `string[]`                  | — required                    | globs for source files. Empty or missing is a `config-invalid` error                     |
| `ignore`                  | `string[]`                  | `[]`                          | `**/node_modules/**` and `**/dist/**` are always appended                                |
| `adapters`                | `SourceAdapter[]`           | `[]`                          | the plain TypeScript reader is appended unless one named `typescript` is already present |
| `outputs`                 | `OutputConfig[]`            | — required                    | empty or missing is a `config-invalid` error                                             |
| `tags`                    | `Record<string, TagRender>` | `{}`                          | `"badge"` or `"column"`; adapter tags merge underneath                                   |
| `types`                   | `TypesConfig`               | see below                     | type resolution                                                                          |
| `i18n`                    | `I18nAdapter`               | absent                        | omit it and the whole i18n lane disappears                                               |
| `lockfile`                | `string`                    | `"propsmith.lock.json"`       | path, relative to `cwd`                                                                  |
| `elementAttributeModules` | `string[]`                  | `[]`                          | merged with every adapter's own list                                                     |
| `cwd`                     | `string`                    | the process working directory | resolved to an absolute path; every glob is relative to it                               |

Globs are left exactly as written. Only `cwd` is made absolute.

### `sources`

**Do not encode the folder architecture here.** The real selector is the `@propsmith` tag, so the
glob only has to be wide enough to include the file:

```ts
sources: ["src/**/*.{ts,tsx}"],
ignore: ["**/*.{test,spec}.ts", "**/*.stories.*", "src/legacy/**"],
```

Every matched file is read and tested for `@propsmith` before the parser is invoked, so a wide glob
over a monorepo costs milliseconds and the parser only runs on the files that matter.

A file whose extension no adapter claims is skipped silently. That is what lets `sources` stay wide
without the config having to enumerate extensions.

### `outputs`

An output is a column set plus a set of documentation files. One file matched by two outputs is two
jobs, because the column sets differ.

| field         | type               | default                                      | notes                                                                |
| ------------- | ------------------ | -------------------------------------------- | -------------------------------------------------------------------- |
| `name`        | `string`           | — required                                   | what `--only` refers to. Must be unique                              |
| `files`       | `string[]`         | — required                                   | globs for the markdown files holding the markers                     |
| `columns`     | `ColumnId[]`       | `["name", "type", "default", "description"]` | every tag configured as `"column"` is appended if not already listed |
| `description` | `"text" \| "i18n"` | `"text"`                                     | `"i18n"` writes the adapter's expression instead of English          |
| `glossary`    | `string`           | `types.glossary`                             | overrides the glossary base for this output only                     |

`description: "i18n"` with no `i18n` block is a `config-invalid` error. That pairing is the entire
i18n surface at the rendering level — see [i18n](./i18n.md).

Any string is a valid `ColumnId`. An unknown id is rendered as a tag column: its heading is the id
Title Cased (`since` becomes `Since`) and its cell is the tag's text.

### `tags`

```ts
tags: {
  bindable: "badge",       // `ref` _bindable_
  experimental: "badge",
  since: "column",         // its own column, appended to every output
},
```

Two render modes and nothing else. `@bindable` is Svelte-only, so the Svelte adapter contributes it
rather than the core; you add `@experimental` without writing a plugin.

**Merge order:** adapter tags first, the user's `tags` on top. A user's `bindable: "column"`
therefore beats the Svelte adapter's `bindable: "badge"`. Entries whose value is neither `"badge"`
nor `"column"` are dropped silently.

Full semantics, including which tags are structural and need no declaration, in [tags](./tags.md).

### `types`

| field         | type                     | default | notes                                                                                                                                  |
| ------------- | ------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `inlineUnder` | `number`                 | `60`    | max characters of a resolved definition that may replace the name. `0` disables inlining. A negative value is a `config-invalid` error |
| `glossary`    | `string`                 | absent  | URL base for links to resolved-but-long types. `"#"` gives same-file anchors                                                           |
| `links`       | `Record<string, string>` | `{}`    | type name to URL, for types propsmith can never resolve                                                                                |
| `inherit`     | `boolean`                | `true`  | let an undocumented prop take the description and `@default` of its type. `@inheritDoc` works either way                               |

`glossary` is a URL rather than a file path because propsmith can find the glossary file by its
marker but cannot know that `docs/types.md` is served at `/docs/types`.

The full fallback chain, and the rules for inherited descriptions, are in [types](./types.md).

### `adapters`

A source adapter answers two questions the core refuses to know: which files hold TypeScript, and
where inside them it starts.

```ts
import { reactAdapter, svelteAdapter } from "@jlacostaec/propsmith/adapters";

adapters: [svelteAdapter(), reactAdapter()],
```

Adapters are tried in order and the first whose `extensions` match the file's extension wins, so
put the more specific one first. The plain TypeScript reader is appended last automatically.
Writing your own is in [adapters](./adapters.md).

### `elementAttributeModules`

Modules whose types collapse into a single `Element Attributes (button)` row instead of expanding
several hundred DOM members. The Svelte adapter contributes `svelte/elements`, the React adapter
contributes `react`; this field adds more.

A type whose _name_ matches `HTML*Attributes` or `SVG*Attributes` is recognised without any module
entry at all — the module list exists for spellings that do not, such as React's
`ButtonHTMLAttributes`.

## The `package.json` shorthand

A `"propsmith"` key in `package.json` covers projects that need no functions in their config:

```json
{
  "propsmith": {
    "sources": ["src/**/*.ts"],
    "outputs": [{ "name": "docs", "files": ["docs/**/*.md"] }],
    "types": { "inlineUnder": 60, "links": { "Dayjs": "https://day.js.org/docs/en/parse/parse" } }
  }
}
```

It is JSON, so `adapters` and `i18n` cannot be expressed here — both are functions or objects with
methods. Everything else works identically.

## Discovery order

1. `--config <path>`, when given. A path that does not exist is a `config-invalid` error and the
   run stops; nothing else is tried.
2. `propsmith.config.ts`, then `propsmith.config.js`, then `propsmith.config.mjs`, directly under
   `cwd`. The first that exists wins. Parent directories are not searched.
3. The `"propsmith"` key in `<cwd>/package.json`.
4. Nothing. A missing config is not an error in itself — `init` does not need one — so the command
   decides whether to fail.

The config module may `export default` the object or export it as a bare namespace. Anything that
is not a plain object (an array, a string, `undefined`) is reported as
"did not export a config object".

## A `.ts` config, and Node

Importing `propsmith.config.ts` relies on Node's native type stripping, which is only on by default
from Node 22.18 onwards — and `engines` declares `>=22`, so the whole supported range is not
covered. When the import fails, propsmith says so rather than reporting a generic module error:

```
could not import `/repo/propsmith.config.ts`: Node refused to load a TypeScript config.
Importing one relies on native type stripping, which is only on by default from Node 22.18
onwards (this process is v22.4.0). Either move to a newer Node, or rename the file to
`propsmith.config.mjs` and write it in plain JavaScript.
```

Two ways out, in order of preference:

1. Move to a Node that strips types.
2. Rename to `propsmith.config.mjs` and drop the type annotations. `defineConfig` still gives you
   completions through JSDoc in most editors.

propsmith does not bundle a loader such as `jiti`; the `.mjs` config is the supported way out.

Note that only `.ts`, `.js` and `.mjs` are looked for by convention. `.mts` and `.cts` work through
`--config`, and get the same type-stripping message when Node refuses them.

## Diagnostics this module emits

All carry code `config-invalid` and severity `error`.

| condition                                  | message                                                        |
| ------------------------------------------ | -------------------------------------------------------------- |
| `sources` empty or missing                 | needs at least one glob                                        |
| `outputs` empty or missing                 | needs at least one output                                      |
| an entry in `outputs` is not an object     | every entry must be an object                                  |
| an output has no `name`                    | it is what `--only` refers to                                  |
| two outputs share a name                   | output names must be unique                                    |
| an output has no `files`                   | it needs at least one glob                                     |
| `description: "i18n"` with no `i18n` block | the pairing is invalid                                         |
| `types.inlineUnder` is negative            | use `0` to disable inlining                                    |
| `--config` points at a missing file        | config file not found                                          |
| the config module throws on import         | the import failure, with the type-stripping note when relevant |
| the config module exports no object        | it should `export default defineConfig({ … })`                 |

Every problem is reported in one pass, rather than one per run.
