/**
 * The i18n lane, as the runner sees it.
 *
 * Internal: the public i18n surface is `@jlacostaec/propsmith/i18n/adapters`,
 * which is what a consumer imports to configure or write an adapter. This
 * module is the other half — key naming, the lockfile, and the staleness
 * algorithm — and is imported by `run.ts`.
 */

export { defaultKey, snake } from "./key.js";
export { hashText, readLockfile, writeLockfile } from "./lockfile.js";
export { syncCatalog } from "./sync.js";
export type { SyncEntry, SyncInput, SyncOutput } from "./sync.js";
