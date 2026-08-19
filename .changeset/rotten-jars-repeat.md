---
"@jlacostaec/propsmith": minor
---

Initial release: generate props tables from TypeScript types into markdown, and keep them from
going stale.

- **Extraction without a type checker.** `oxc-parser` reads the literal members of a type tagged
  `@propsmith <Name>`, with their JSDoc, so the table prints the type as the author wrote it rather
  than a checker's expansion. TypeScript 7 ships no standalone JS parser, so this is not a
  preference — it is the only pure-function path to an AST.
- **Markdown only, never an HTML tag.** Entities are allowed; tags are not. Union pipes therefore
  sit outside their code spans (`` `'a'` &#124; `'b'` ``), because CommonMark treats an entity
  inside a code span as literal text.
- **Drift detection that survives a formatter.** Tables are emitted already aligned, and compared
  cell by cell with the padding stripped, so prettier or oxfmt realigning a table is not reported
  as drift.
- **Type resolution on demand.** A referenced local type is resolved syntactically, one level deep,
  and either inlined, linked to a glossary region, or degraded to its key shape — never rendered as
  a bare useless name without a diagnostic saying so.
- **Three commands.** `propsmith` writes, `--dry-run` previews, `check` reports drift and exits
  non-zero, `init` scaffolds a config from what the project already looks like.
- **Adapters.** `propsmith/adapters` ships Svelte and React on top of the plain TypeScript default;
  `propsmith/i18n/adapters` ships paraglide. Both lanes are optional and pluggable.
- **Descriptions inherited from a shared type.** A prop with no JSDoc takes the description and the
  `@default` of the type it is declared with, so a documented `Variant` in a global types file is
  written once and used everywhere. `@inheritDoc [Name]` asks for it explicitly, and
  `types.inherit: false` turns the automatic half off.
- **An i18n lane with a lockfile.** Stale translations are detected by recording which English each
  translation was made from, which also distinguishes a changed JSDoc from a hand-edited catalog —
  a distinction that decides whether a translation should be invalidated or left alone. Everything
  a translated cell contains is a message: the description, the `@deprecated` reason, and the word
  that introduces it. An inherited description is one shared key, so `Variant` is translated once.
