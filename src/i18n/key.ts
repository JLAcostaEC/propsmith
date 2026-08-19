/**
 * Key naming.
 *
 * A catalog key is not a label, it is an identifier: paraglide compiles
 * `button_props_size` into the function `m.button_props_size()`. That is why the
 * key is derived from names the author already chose — a rename is visible in a
 * diff and reviewable — and why the result is constrained to
 * `/^[a-z_][a-z0-9_]*$/` rather than merely lowercased.
 *
 * Adapters may override the naming through `I18nAdapter.key`; {@link defaultKey}
 * is what everything falls back to.
 */

import type { KeyContext } from "../types.js";

/**
 * One word of an identifier.
 *
 * Three alternatives, in order: an acronym run (`HTML` in `HTMLButton`, with any
 * digits that trail it), a normal word that keeps its digits (`box2`), and a
 * bare number for text that starts with one. Everything the pattern does *not*
 * match — `-`, `.`, `/`, `$`, whitespace — is a separator by omission, which is
 * how consecutive separators collapse without a second pass.
 */
const WORD = /[A-Z]+(?![a-z])[0-9]*|[A-Za-z][a-z0-9]*|[0-9]+/g;

/** Text with nothing identifier-shaped in it at all, e.g. `""` or `"--"`. */
const EMPTY_KEY = "_";

/**
 * Snake-case any name propsmith might read.
 *
 * ```
 * AutoSuggestBox  -> auto_suggest_box
 * ariaLabel       -> aria_label
 * HTMLButton      -> html_button
 * shared/Button   -> shared_button
 * data-test.id    -> data_test_id
 * 2fa             -> _2_fa
 * ```
 *
 * A leading digit gets an underscore in front of it, because the key becomes a
 * function name and `2fa()` is not one. Leading and trailing separators are
 * dropped, so `_private` and `/shared` both lose theirs; input with no letters
 * or digits at all returns `"_"`. The result always matches
 * `/^[a-z_][a-z0-9_]*$/`.
 */
export function snake(text: string): string {
  const words = text.match(WORD);
  if (words === null) return EMPTY_KEY;
  const key = words.join("_").toLowerCase();
  return key.charCodeAt(0) >= 48 && key.charCodeAt(0) <= 57 ? `_${key}` : key;
}

/** The prefix for a description shared by every prop of one type. */
const GLOBAL_TYPE_PREFIX = "global_types_";

/** The `prop` of the label introducing a deprecation notice. */
export const DEPRECATED_LABEL = "deprecated";

/** The `component` every label key is built from. */
export const LABEL_NAMESPACE = "propsmith";

/**
 * The key for one piece of text, by what that text is.
 *
 * | kind          | key                                | example                       |
 * | ------------- | ---------------------------------- | ----------------------------- |
 * | `description` | `<component>_props_<prop>`         | `button_props_size`           |
 * | `deprecated`  | `<component>_props_<prop>_deprecated` | `button_props_size_deprecated` |
 * | `type`        | `global_types_<type>`              | `global_types_variant`        |
 * | `label`       | `<component>_<prop>`               | `propsmith_deprecated`        |
 *
 * `_props_` in the middle is deliberate: it is a searchable marker, which is
 * what lets a reader tell a generated key from a hand-written one. A `type` key
 * is deliberately not per component — the whole point is that every prop typed
 * `Variant` shares the one message that `Variant` carries.
 */
export function defaultKey(ctx: KeyContext): string {
  const component = snake(ctx.component);
  const prop = snake(ctx.prop);

  switch (ctx.kind) {
    case "deprecated":
      return `${component}_props_${prop}_deprecated`;
    case "type":
      return `${GLOBAL_TYPE_PREFIX}${snake(ctx.type ?? "")}`;
    case "label":
      return `${component}_${prop}`;
    default:
      return `${component}_props_${prop}`;
  }
}
