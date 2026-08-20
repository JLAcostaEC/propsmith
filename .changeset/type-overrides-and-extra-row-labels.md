---
"@jlacostaec/propsmith": minor
---

feat: Resolve a braced `@type`, and fix what an `Omit` branch actually does.

- **`@type {X}` is a type, not a string.** The braced form — JSDoc's own spelling — goes through
  everything a declared type goes through: the symbol index, `inlineUnder`, the glossary,
  `types.links`, and the same diagnostics. `@type {ButtonGenerics}` now renders the union behind the
  name, and `@type {'button' | 'a' | 'div'}` renders one code span per member instead of one span
  with the pipes trapped inside it. `@type <text>` without braces stays the prose escape hatch, and
  both are still reported by `check`.
- **`Omit` no longer borrows `Pick`'s wording.** `Omit<PolymorphicProps<'span'>, 'children'>` read as
  `` `children` from `PolymorphicProps<'span'>` `` — the opposite of the truth, since `children` is
  the one key that branch does not contribute. It now reads
  `` `PolymorphicProps<'span'>` without `children` ``.
- **`types.extras` configures the summary rows.** `labels` holds one template per row kind
  (`{keys}`, `{origin}`, `{element}`, `{text}` are substituted inside code spans), and `origins`
  maps an origin type to a label used wherever that type appears. A template that uses a placeholder
  its row cannot fill, or that contains an HTML tag, is a config error.
- **A JSDoc block on an intersection branch names its row.** `@type` on the branch becomes the Name
  cell and beats every template; the block's first paragraph fills the Description cell, which
  summary rows never had before. The row's `kind`, `keys` and `origin` are untouched, so `--json`
  keeps the facts.
