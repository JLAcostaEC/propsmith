/**
 * The default source adapter: plain TypeScript files, read as-is.
 *
 * This is the "no framework at all" baseline. It claims the four TypeScript
 * extensions, hands the parser the file unchanged, and contributes neither
 * element-attribute modules nor tags.
 */

import type { ExtractedScript, SourceAdapter } from "../types.js";

/** File extensions the plain TypeScript reader claims. */
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

/** `.tsx` files must be parsed with JSX enabled; everything else is plain TS. */
function langFor(filePath: string): ExtractedScript["lang"] {
  return filePath.toLowerCase().endsWith(".tsx") ? "tsx" : "ts";
}

/**
 * The adapter that is always active, ahead of every configured one.
 *
 * `extract` is the identity: the whole file is TypeScript, so `offset` is `0`
 * and every AST span already lines up with the real file.
 */
export function typescriptAdapter(): SourceAdapter {
  return {
    name: "typescript",
    extensions: [...EXTENSIONS],
    extract(source: string, filePath: string): ExtractedScript | null {
      return { code: source, lang: langFor(filePath), offset: 0 };
    },
  };
}
