/**
 * Region scanner.
 *
 * Finds `<!-- props:Name -->` … `<!-- /props:Name -->` pairs in a markdown
 * file. Markers inside a fenced code block are invisible: a page documenting
 * propsmith will contain one as an example, and it must not become a region.
 */

import type { Diagnostic, Region } from "../types.js";

/** What one file's scan produced. */
export interface ScanResult {
  regions: Region[];
  diagnostics: Diagnostic[];
}

/** Opening marker. Group 1 is the region name, `@` prefix included. */
export const OPEN_RE = /<!--\s*props:(@?[A-Za-z0-9_/-]+)\s*-->/;

/** Closing marker. Group 1 is the region name, `@` prefix included. */
export const CLOSE_RE = /<!--\s*\/props:(@?[A-Za-z0-9_/-]+)\s*-->/;

/** A ``` or ~~~ line: group 1 is the run of fence characters, group 2 the rest. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

interface OpenMarker {
  name: string;
  kind: Region["kind"];
  openStart: number;
  openEnd: number;
  line: number;
  column: number;
  /** A name opened twice in one file: reported, and not returned as a region. */
  duplicate: boolean;
}

/** Drop the blank lines that surround a region body, keeping its inner text verbatim. */
function trimBlankLines(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");
}

function regionOf(
  file: string,
  source: string,
  open: OpenMarker,
  closeStart?: number,
  closeEnd?: number,
): Region {
  const region: Region = {
    name: open.name,
    kind: open.kind,
    file,
    openStart: open.openStart,
    openEnd: open.openEnd,
    body: "",
    line: open.line,
  };
  if (closeStart !== undefined && closeEnd !== undefined) {
    region.closeStart = closeStart;
    region.closeEnd = closeEnd;
    region.body = trimBlankLines(source.slice(open.openEnd, closeStart));
  }
  return region;
}

/**
 * Scan one markdown file for propsmith regions.
 *
 * An opening marker with no close is still returned — with `closeStart` and
 * `closeEnd` absent and an empty body — so `write` can complete it in place.
 * `check` reports it, because check never fixes anything.
 */
export function scanRegions(file: string, source: string): ScanResult {
  const regions: Region[] = [];
  const diagnostics: Diagnostic[] = [];
  const stack: OpenMarker[] = [];
  /** name -> line of the first opening marker carrying it. */
  const opened = new Map<string, number>();
  // Built per call: a shared global regex would carry `lastIndex` between scans.
  const markerRe = new RegExp(`${OPEN_RE.source}|${CLOSE_RE.source}`, "g");

  let fenceChar = "";
  let fenceLength = 0;
  let offset = 0;
  let line = 0;

  for (const rawLine of source.split("\n")) {
    const lineStart = offset;
    offset += rawLine.length + 1;
    line += 1;

    // `split("\n")` leaves the CR of a CRLF file at the end of every line.
    const text = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const fence = FENCE_RE.exec(text);

    if (fenceChar !== "") {
      const closes =
        fence !== null &&
        fence[1].startsWith(fenceChar) &&
        fence[1].length >= fenceLength &&
        fence[2].trim() === "";
      if (closes) {
        fenceChar = "";
        fenceLength = 0;
      }
      continue;
    }

    // A backtick fence may not carry a backtick in its info string; a tilde fence may.
    if (fence !== null && (fence[1].startsWith("~") || !fence[2].includes("`"))) {
      fenceChar = fence[1].slice(0, 1);
      fenceLength = fence[1].length;
      continue;
    }

    markerRe.lastIndex = 0;
    let match = markerRe.exec(text);
    while (match !== null) {
      const openStart = lineStart + match.index;
      const openEnd = openStart + match[0].length;
      const column = match.index + 1;
      const openName = match[1];
      const closeName = match[2];

      if (openName !== undefined) {
        const firstLine = opened.get(openName);
        if (firstLine === undefined) {
          opened.set(openName, line);
        } else {
          diagnostics.push({
            severity: "error",
            code: "duplicate-marker",
            message: `Duplicate marker \`props:${openName}\` at line ${line}: already opened at line ${firstLine}.`,
            file,
            line,
            column,
          });
        }
        stack.push({
          name: openName,
          kind: openName.startsWith("@") ? "builtin" : "component",
          openStart,
          openEnd,
          line,
          column,
          duplicate: firstLine !== undefined,
        });
      } else if (closeName !== undefined) {
        const top = stack[stack.length - 1];
        if (top === undefined) {
          diagnostics.push({
            severity: "error",
            code: "mismatched-marker",
            message: `Closing marker \`/props:${closeName}\` at line ${line} has no opening marker.`,
            file,
            line,
            column,
          });
        } else if (top.name === closeName) {
          stack.pop();
          if (!top.duplicate) regions.push(regionOf(file, source, top, openStart, openEnd));
        } else {
          diagnostics.push({
            severity: "error",
            code: "mismatched-marker",
            message:
              `Closing marker \`/props:${closeName}\` at line ${line} does not match ` +
              `\`props:${top.name}\`, opened at line ${top.line}.`,
            file,
            line,
            column,
          });
          // When the name is open further out, everything nested inside it is unpaired.
          const target = stack.findLastIndex((entry) => entry.name === closeName);
          if (target !== -1) {
            while (stack.length - 1 > target) {
              const orphan = stack.pop();
              if (orphan !== undefined) reportUnpaired(orphan, file, source, regions, diagnostics);
            }
            const owner = stack.pop();
            if (owner !== undefined && !owner.duplicate) {
              regions.push(regionOf(file, source, owner, openStart, openEnd));
            }
          }
        }
      }

      match = markerRe.exec(text);
    }
  }

  while (stack.length > 0) {
    const orphan = stack.pop();
    if (orphan !== undefined) reportUnpaired(orphan, file, source, regions, diagnostics);
  }

  regions.sort((a, b) => a.openStart - b.openStart);
  diagnostics.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return { regions, diagnostics };
}

function reportUnpaired(
  open: OpenMarker,
  file: string,
  source: string,
  regions: Region[],
  diagnostics: Diagnostic[],
): void {
  if (open.duplicate) return;
  diagnostics.push({
    severity: "error",
    code: "unpaired-marker",
    message: `Opening marker \`props:${open.name}\` at line ${open.line} has no closing marker.`,
    file,
    line: open.line,
    column: open.column,
  });
  regions.push(regionOf(file, source, open));
}
