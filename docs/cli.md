# CLI

```
propsmith                 write (tables + catalog)
propsmith --dry-run       print what it would write, touch nothing
propsmith check           write nothing, report drift, exit non-zero
propsmith init            scaffold propsmith.config.ts from what it detects
```

## Commands

### `propsmith`

Writes. It replaces every region whose name matches a `@propsmith` tag, writes the i18n catalog when
that lane is enabled, and updates the lockfile. There is no confirmation prompt — it is a generator,
and `git diff` is the safety net.

### `propsmith --dry-run`

Everything `write` does, minus the writing. Tables are printed to stdout. This is the command for
iterating on a JSDoc comment.

### `propsmith check`

Writes nothing, reports drift, exits non-zero if there is any. This is the CI command, and it is
also the first useful thing to run in a repo that has never used propsmith: it measures how much
drift exists today.

`check` never fixes anything, including what `write` fixes silently — a lone opening marker is an
error here and an invitation there.

### `propsmith init`

Detects the framework, detects `project.inlang`, finds the files that carry `@propsmith` and the
files that carry markers, and writes a filled-in `propsmith.config.ts`.

```
$ propsmith init

  ✓ detected Svelte (svelte.config.js)
  ✓ detected paraglide (project.inlang/settings.json — locales: en, es)
  ✓ found 29 type files under src/lib/components/*/
  ✓ found 32 files containing props markers

  wrote propsmith.config.ts
  next: propsmith --dry-run
```

## Options

| option               | applies to            | effect                                                           |
| -------------------- | --------------------- | ---------------------------------------------------------------- |
| `--component <name>` | write, dry-run, check | restrict the run to one component. Repeatable                    |
| `--only <output>`    | write, dry-run, check | restrict the run to one named output (`--only llms`). Repeatable |
| `--no-i18n`          | write, dry-run, check | skip the catalog lane for this run                               |
| `--config <path>`    | all                   | escape hatch; skips config discovery entirely                    |
| `--strict`           | check                 | warnings fail the run too                                        |
| `--json`             | all                   | machine-readable output, including the full IR                   |
| `--dry-run`          | write                 | print instead of writing                                         |

`--component` takes the `@propsmith` name, namespace included: `--component shared/Button`. It also
accepts the declared type name. `--only` takes an output's `name` from the config.

`--json` prints the run result: the file changes, the catalog changes, every diagnostic, and the IR
— so a consumer can render anything propsmith does not.

## Exit codes

| code | meaning                  |
| ---- | ------------------------ |
| `0`  | clean                    |
| `1`  | drift or errors          |
| `2`  | invalid config or misuse |

CI has to be able to tell `1` from `2`: a stale table is something a developer fixes by running
`propsmith`, a broken config is a build problem. `--strict` promotes warnings to failures, so a run
with only warnings exits `1`.

## `check` output

```
$ propsmith check

  ✗ docs/auto-suggest-box/footer.svx:12
      <!-- props:AutoSuggestBox --> does not match the type — 2 props with no row:
      selectedOptions, textBoxRef
  ✗ src/lib/components/tooltip/types.ts:14
      @propsmith Tooltip has no marker in any output. Add <!-- props:Tooltip --> to a
      documentation file
  ⚠ src/lib/components/auto-suggest-box/types.ts:52
      AutoSuggestBox.virtualizer: `AutoSuggestVirtualizer` is longer than 60 characters
      and there is no glossary to link it to. Add <!-- props:@types --> or shorten the type

  2 errors · 1 warning
```

- `✗` is an error and sets exit `1`. `⚠` is a warning and does not, unless `--strict`.
- Source locations point at the real line of the real file even when the type lives inside a
  `.svelte` block.
- A drift error names the props that gained or lost a row, so you do not have to diff two tables by
  eye. The fix is `propsmith`.

## What `check` reports

| code                  | severity        | meaning                                                                                                             |
| --------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `parse-error`         | error / warning | the file did not parse. An error when nothing was recovered, a warning when the rest of the file was still readable |
| `config-invalid`      | error           | see [configuration](./configuration.md#diagnostics-this-module-emits)                                               |
| `duplicate-component` | error           | one `@propsmith` name on two types                                                                                  |
| `unpaired-marker`     | error           | an opening marker with no close                                                                                     |
| `mismatched-marker`   | error           | a close that does not match its opener, with both line numbers                                                      |
| `duplicate-marker`    | error           | the same region name twice in one file                                                                              |
| `marker-without-tag`  | error           | a marker whose name matches no `@propsmith`                                                                         |
| `tag-without-marker`  | error           | a `@propsmith` name with no marker in any output                                                                    |
| `table-drift`         | error           | the region body differs from what would be generated, with the props that moved                                     |
| `invalid-key`         | error           | the i18n adapter rejected a generated key, or two kinds of text resolved to the same key                            |
| `missing-description` | warning         | a member that ends up with no description, inheritance included                                                     |
| `type-override-used`  | warning         | any use of `@type`                                                                                                  |
| `type-too-long`       | warning         | a resolved type over `inlineUnder` with no glossary                                                                 |
| `unresolved-type`     | warning         | a bare name propsmith could not resolve and that is not in `types.links`                                            |
| `catalog-orphan-key`  | warning         | a key in the catalog no member points at                                                                            |
| `catalog-missing-key` | warning         | a key missing from a locale                                                                                         |
| `catalog-stale`       | warning         | the English changed since the translation was made                                                                  |
| `catalog-hand-edited` | warning         | someone edited the source catalog by hand                                                                           |
| `catalog-conflict`    | warning         | the JSDoc and the catalog both changed; the JSDoc wins                                                              |

The `catalog-*` codes only exist when an `i18n` block does — see [i18n](./i18n.md).

## In a consumer's `package.json`

```jsonc
"scripts": {
  "docs": "propsmith",
  "docs:check": "propsmith check",
  "build": "propsmith && paraglide-js compile --project ./project.inlang && vite build"
}
```

The ordering in `build` matters when the i18n lane is on — see
[i18n](./i18n.md#build-ordering).

Related: [getting-started](./getting-started.md), [markers](./markers.md),
[configuration](./configuration.md).
