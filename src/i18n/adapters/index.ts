/**
 * i18n adapters — `@jlacostaec/propsmith/i18n/adapters`.
 *
 * An adapter answers the four questions that vary between i18n tools: where the
 * catalog lives, which locales exist, what expression goes into the markdown,
 * and which keys are legal. Everything harder than that — the staleness
 * algorithm and the lockfile — is core, so a new adapter is a small file.
 *
 * The `I18nAdapter` type is re-exported here so writing one needs this entry
 * point and nothing else.
 */

export { paraglide } from "./paraglide.js";
export type { ParaglideOptions } from "./paraglide.js";
export type { Catalog, I18nAdapter, KeyContext } from "../../types.js";

/**
 * The casing the built-in key naming uses.
 *
 * Exported because the moment you pass your own `key`, you get the raw
 * `AutoSuggestBox` / `maxItemsInView` and have to case them yourself — and
 * hand-rolling that is how a catalog ends up with two spellings of the same
 * convention. `defaultKey` is here for the same reason: a custom key is usually
 * the default with one piece changed.
 */
export { defaultKey, snake } from "../key.js";
