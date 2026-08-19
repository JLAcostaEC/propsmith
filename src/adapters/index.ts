/**
 * Source adapters — `@jlacostaec/propsmith/adapters`.
 *
 * An adapter answers two questions the core refuses to know: which files hold
 * TypeScript, and where inside them it starts. Everything framework-specific
 * lives here; the core speaks TypeScript syntax and markdown only.
 */

export { reactAdapter } from "./react.js";
export type { ReactAdapterOptions } from "./react.js";
export { svelteAdapter } from "./svelte.js";
export type { SvelteAdapterOptions } from "./svelte.js";
export { typescriptAdapter } from "./typescript.js";
export type { ExtractedScript, SourceAdapter } from "../types.js";
