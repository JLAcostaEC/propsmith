/**
 * The `@types` glossary region.
 *
 * propsmith never emits headings — with exactly one exception, here.
 * A glossary *is* a list of headings, and its author placed the region
 * deliberately, so the `###` levels are part of what was asked for. Anchors come
 * from the heading text, which is why the heading is the bare type name and
 * nothing else: `AutoSuggestVirtualizer` -> `#autosuggestvirtualizer`.
 */

import { codeSpan, oneLine } from "./escape.js";

export interface GlossaryEntry {
  name: string;
  text: string;
}

/**
 * Alphabetical by name. Each entry is a `###` heading, a blank line, and the
 * definition as a code span (pipes split out per the escape rules).
 *
 * Returns an empty string when there is nothing to define.
 */
export function renderGlossary(entries: readonly GlossaryEntry[]): string {
  const blocks: string[] = [];

  for (const entry of sorted(entries)) {
    const name = oneLine(entry.name);
    if (name.length === 0) continue;
    const definition = codeSpan(entry.text);
    blocks.push(definition.length > 0 ? `### ${name}\n\n${definition}\n` : `### ${name}\n`);
  }

  return blocks.join("\n");
}

/** Case-insensitive, with a code-point tiebreak so the order never varies by platform. */
function sorted(entries: readonly GlossaryEntry[]): GlossaryEntry[] {
  return entries.toSorted((a, b) => {
    const left = a.name.toLowerCase();
    const right = b.name.toLowerCase();
    if (left !== right) return left < right ? -1 : 1;
    if (a.name === b.name) return 0;
    return a.name < b.name ? -1 : 1;
  });
}
