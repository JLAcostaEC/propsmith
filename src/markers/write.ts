/**
 * Region writer.
 *
 * Splices new bodies into the regions `scan` found. Everything outside a
 * region — including the file's line endings and its final newline, or the
 * absence of one — comes through untouched, so a run that changes nothing
 * leaves a clean `git status` on Windows as well as on Linux.
 */

import type { Region } from "../types.js";

/** The rewritten file, and whether it differs from what was read. */
export interface ReplaceResult {
  text: string;
  changed: boolean;
}

/** Drop the blank lines that surround a region body. */
function trimBlankLines(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");
}

/** The file's dominant line ending. A new or newline-free file gets `"\n"`. */
export function detectEol(source: string): "\r\n" | "\n" {
  let crlf = 0;
  let lf = 0;
  for (let i = source.indexOf("\n"); i !== -1; i = source.indexOf("\n", i + 1)) {
    if (i > 0 && source.charCodeAt(i - 1) === 13) crlf += 1;
    else lf += 1;
  }
  return crlf > lf ? "\r\n" : "\n";
}

/** Rewrite every line ending in `text` to `eol`, lone carriage returns included. */
export function normalizeEol(text: string, eol: string): string {
  return text.replace(/\r\n|\r|\n/g, eol);
}

/**
 * Replace one region's body. Regions must be applied from LAST to FIRST so
 * offsets stay valid; the edits are sorted that way here, so the caller may
 * pass them in any order.
 *
 * Every region is laid out as: opening marker line, blank line, body, blank
 * line, closing marker line. A region whose closing marker is missing gets one
 * inserted directly after the body, leaving the text that followed the opening
 * marker where it was. Running twice produces identical bytes.
 */
export function replaceRegions(
  source: string,
  edits: readonly { region: Region; body: string }[],
): ReplaceResult {
  if (edits.length === 0) return { text: source, changed: false };

  const eol = detectEol(source);
  const ordered = edits.toSorted((a, b) => b.region.openStart - a.region.openStart);
  let text = source;

  for (const { region, body } of ordered) {
    // Offsets index the original source, and splicing back to front keeps the
    // prefix of `text` identical to the prefix of `source`.
    const open = source.slice(region.openStart, region.openEnd);
    const { closeStart, closeEnd } = region;

    let close: string;
    let end: number;
    if (closeStart !== undefined && closeEnd !== undefined) {
      close = source.slice(closeStart, closeEnd);
      end = closeEnd;
    } else {
      close = `<!-- /props:${region.name} -->`;
      end = region.openEnd;
    }

    const inner = trimBlankLines(normalizeEol(body, eol));
    const block =
      inner === ""
        ? `${open}${eol}${eol}${close}`
        : `${open}${eol}${eol}${inner}${eol}${eol}${close}`;

    text = text.slice(0, region.openStart) + block + text.slice(end);
  }

  return { text, changed: text !== source };
}
