/**
 * Injected by tsdown's `define` at build time, so the whole package.json is not
 * inlined into `dist/bin.js`. Guarded with `typeof` at every use, because under
 * `vitest` and `tsc` nothing replaces them.
 */
declare const __PKG_NAME__: string;
declare const __PKG_VERSION__: string;
declare const __PKG_DESCRIPTION__: string;
