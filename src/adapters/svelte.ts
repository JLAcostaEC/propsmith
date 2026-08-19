/**
 * The Svelte source adapter.
 *
 * A `.svelte` file is not TypeScript, so the adapter lifts the typed
 * `<script>` block out of the markup and reports where it started. Every AST
 * span the extractor later computes is relative to that block, and adding
 * `offset` back is what keeps a diagnostic pointing at the real line of the
 * real file instead of line 3 of an anonymous fragment.
 */

import type { ExtractedScript, SourceAdapter, TagRender } from "../types.js";

export interface SvelteAdapterOptions {
  /** Extra tags this adapter contributes, merged under the user's own `tags`. */
  tags?: Record<string, TagRender>;
}

/** File extensions the Svelte adapter claims. */
const EXTENSIONS = [".svelte", ".svelte.ts"];

/** Modules whose types become an `Element Attributes` row. */
const ELEMENT_ATTRIBUTE_MODULES = ["svelte/elements"];

/** `lang` values that mark a `<script>` block as TypeScript. */
const TYPED_LANGS = new Set(["ts", "typescript"]);

/** A `<script>` element found in the markup, with its content span. */
interface ScriptBlock {
  /** Attribute names lowercased; bare attributes carry `true`. */
  attributes: Record<string, string | true>;
  /** Index of the first character after the opening tag. */
  contentStart: number;
  /** Index of the `<` that opens the closing tag. */
  contentEnd: number;
}

/** The result of walking an opening tag's attribute list. */
interface ParsedTag {
  attributes: Record<string, string | true>;
  /** Index of the first character after the `>`. */
  tagEnd: number;
  selfClosing: boolean;
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

/**
 * Walk an opening tag from just after `<script`, returning its attributes.
 *
 * Quoted values are read whole, so a `generics="T extends Record<string, X>"`
 * attribute cannot end the tag early — the reason this is a scanner and not a
 * regular expression.
 */
function parseTag(source: string, from: number): ParsedTag | null {
  const attributes: Record<string, string | true> = {};
  let index = from;

  while (index < source.length) {
    while (index < source.length && isWhitespace(source.charAt(index))) index += 1;
    if (index >= source.length) return null;

    if (source.charAt(index) === ">") {
      return { attributes, tagEnd: index + 1, selfClosing: false };
    }
    if (source.charAt(index) === "/" && source.charAt(index + 1) === ">") {
      return { attributes, tagEnd: index + 2, selfClosing: true };
    }

    const nameStart = index;
    while (index < source.length) {
      const char = source.charAt(index);
      if (isWhitespace(char) || char === "=" || char === ">" || char === "/") break;
      index += 1;
    }
    const name = source.slice(nameStart, index).toLowerCase();
    if (name === "") {
      // A stray `/` or an otherwise unreadable character: step over it.
      index += 1;
      continue;
    }

    while (index < source.length && isWhitespace(source.charAt(index))) index += 1;
    if (source.charAt(index) !== "=") {
      attributes[name] = true;
      continue;
    }

    index += 1;
    while (index < source.length && isWhitespace(source.charAt(index))) index += 1;

    const quote = source.charAt(index);
    if (quote === '"' || quote === "'") {
      const valueStart = index + 1;
      const valueEnd = source.indexOf(quote, valueStart);
      if (valueEnd === -1) return null;
      attributes[name] = source.slice(valueStart, valueEnd);
      index = valueEnd + 1;
      continue;
    }

    const valueStart = index;
    while (index < source.length) {
      const char = source.charAt(index);
      if (isWhitespace(char) || char === ">") break;
      index += 1;
    }
    attributes[name] = source.slice(valueStart, index);
  }

  return null;
}

/** Every `<script>…</script>` pair in the file, in document order. */
function findScriptBlocks(source: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  const haystack = source.toLowerCase();
  let index = 0;

  while (index < haystack.length) {
    const open = haystack.indexOf("<script", index);
    if (open === -1) break;

    const afterName = source.charAt(open + 7);
    if (afterName !== "" && !isWhitespace(afterName) && afterName !== ">" && afterName !== "/") {
      index = open + 7;
      continue;
    }

    const tag = parseTag(source, open + 7);
    if (tag === null) break;
    if (tag.selfClosing) {
      index = tag.tagEnd;
      continue;
    }

    const close = haystack.indexOf("</script", tag.tagEnd);
    if (close === -1) break;

    blocks.push({ attributes: tag.attributes, contentStart: tag.tagEnd, contentEnd: close });
    index = close + 8;
  }

  return blocks;
}

/** `lang="ts"` or `lang="typescript"`, in any attribute position. */
function isTyped(block: ScriptBlock): boolean {
  const lang = block.attributes["lang"];
  return typeof lang === "string" && TYPED_LANGS.has(lang.trim().toLowerCase());
}

/** Svelte 5 `<script module>` and the legacy `<script context="module">`. */
function isModule(block: ScriptBlock): boolean {
  if (block.attributes["module"] !== undefined) return true;
  const context = block.attributes["context"];
  return typeof context === "string" && context.trim().toLowerCase() === "module";
}

/**
 * Svelte preset.
 *
 * Prop types live in the module block when there is one, so a typed
 * `<script module>` wins over a typed instance block regardless of which comes
 * first in the file. A `.svelte.ts` rune module is plain TypeScript and is
 * passed through whole.
 */
export function svelteAdapter(options?: SvelteAdapterOptions): SourceAdapter {
  return {
    name: "svelte",
    extensions: [...EXTENSIONS],
    extract(source: string, filePath: string): ExtractedScript | null {
      if (filePath.toLowerCase().endsWith(".svelte.ts")) {
        return { code: source, lang: "ts", offset: 0 };
      }

      const typed = findScriptBlocks(source).filter(isTyped);
      if (typed.length === 0) return null;

      const chosen = typed.find(isModule) ?? typed[0];
      return {
        code: source.slice(chosen.contentStart, chosen.contentEnd),
        lang: "ts",
        offset: chosen.contentStart,
      };
    },
    elementAttributeModules: [...ELEMENT_ATTRIBUTE_MODULES],
    tags: { bindable: "badge", ...options?.tags },
  };
}
