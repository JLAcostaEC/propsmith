/**
 * The React source adapter.
 *
 * React props are already declared as an exported type or interface in a
 * regular `.ts` / `.tsx` file, so extraction is the identity. The adapter
 * exists for the two things that are not: `react` is the module whose types
 * become an `Element Attributes` row, and the user's extra tags travel with it.
 */

import type { ExtractedScript, SourceAdapter, TagRender } from "../types.js";

export interface ReactAdapterOptions {
  /** Extra tags this adapter contributes, merged under the user's own `tags`. */
  tags?: Record<string, TagRender>;
}

/** File extensions the React adapter claims. */
const EXTENSIONS = [".tsx", ".ts"];

/** Modules whose types become an `Element Attributes` row. */
const ELEMENT_ATTRIBUTE_MODULES = ["react"];

/** `.tsx` files must be parsed with JSX enabled; everything else is plain TS. */
function langFor(filePath: string): ExtractedScript["lang"] {
  return filePath.toLowerCase().endsWith(".tsx") ? "tsx" : "ts";
}

/**
 * React preset. There is no `bindable` equivalent in React, so the only tags
 * this adapter carries are the ones the caller passes in.
 */
export function reactAdapter(options?: ReactAdapterOptions): SourceAdapter {
  return {
    name: "react",
    extensions: [...EXTENSIONS],
    extract(source: string, filePath: string): ExtractedScript | null {
      return { code: source, lang: langFor(filePath), offset: 0 };
    },
    elementAttributeModules: [...ELEMENT_ATTRIBUTE_MODULES],
    tags: { ...options?.tags },
  };
}
