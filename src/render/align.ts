/**
 * Table alignment, and the padding-insensitive comparison that goes with it.
 *
 * Measured, not assumed: `oxfmt --check` fails on a hand-written markdown table
 * and rewrites it with every column padded to a common width. Prettier does the
 * same. So in any consumer repo that formats markdown, the table propsmith
 * writes is not the table that ends up committed.
 *
 * Left alone that would make `check` report drift on every run, forever — the
 * one failure mode that would make the tool untrustworthy in exactly the place
 * it is meant to earn trust. Two mechanisms answer it:
 *
 * 1. `alignTable` emits the padded form both formatters converge on, so in the
 *    common case the formatter has nothing to change and `write` causes no churn.
 * 2. `normalizeTable` strips the padding before anything is compared, so
 *    alignment differences are invisible to drift detection whatever the
 *    consumer's formatter does with them.
 *
 * The second is the correctness mechanism; the first only keeps diffs quiet.
 */

/** A line that opens and closes with a pipe is a table row. */
const ROW = /^\s*\|.*\|\s*$/;

/** `---`, `:--`, `--:`, `:-:` — a separator cell. */
const SEPARATOR_CELL = /^:?-+:?$/;

/**
 * Split a table row into its cells.
 *
 * Every cell propsmith writes has already had its pipes turned into `&#124;`,
 * so a bare `|` can only be a delimiter. A backslash-escaped `\|` is honoured
 * anyway, because the region may hold a table someone wrote by hand.
 */
function splitRow(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.slice(1, -1);
  const cells: string[] = [];
  let current = "";

  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i];
    if (char === "\\" && inner[i + 1] === "|") {
      current += "\\|";
      i += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL.test(cell));
}

/**
 * A table is a run of consecutive rows whose second line is a separator.
 * Anything else in the region — prose, a heading, a blank line — is left alone.
 */
interface Block {
  start: number;
  end: number;
  rows: string[][];
}

function findTables(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!ROW.test(lines[index]!)) {
      index += 1;
      continue;
    }

    const rows: string[][] = [];
    const start = index;
    while (index < lines.length && ROW.test(lines[index]!)) {
      rows.push(splitRow(lines[index]!));
      index += 1;
    }

    // Without a separator on the second line it is not a GFM table, so leave it.
    if (rows.length >= 2 && isSeparatorRow(rows[1]!)) {
      blocks.push({ start, end: index, rows });
    }
  }

  return blocks;
}

/** Column count is the widest row; short rows are padded with empty cells. */
function columnCount(rows: readonly string[][]): number {
  return rows.reduce((max, row) => Math.max(max, row.length), 0);
}

/**
 * Pad every column to the width of its widest cell.
 *
 * The separator row is rebuilt from the measured width rather than padded, so
 * its dashes span the column exactly the way a formatter would write them.
 */
export function alignTable(markdown: string): string {
  const trailing = markdown.endsWith("\n");
  const lines = markdown.split("\n");
  const blocks = findTables(lines);
  if (blocks.length === 0) return markdown;

  for (const block of blocks) {
    const count = columnCount(block.rows);
    const widths: number[] = Array.from({ length: count }, () => 0);

    for (const [rowIndex, row] of block.rows.entries()) {
      if (rowIndex === 1) continue; // the separator never sets a width
      for (let column = 0; column < count; column += 1) {
        widths[column] = Math.max(widths[column]!, (row[column] ?? "").length);
      }
    }

    // A column of nothing but empty cells still needs somewhere to put dashes.
    for (let column = 0; column < count; column += 1) {
      widths[column] = Math.max(widths[column]!, 3);
    }

    for (const [rowIndex, row] of block.rows.entries()) {
      const cells =
        rowIndex === 1
          ? widths.map((width) => "-".repeat(width))
          : widths.map((width, column) => (row[column] ?? "").padEnd(width));
      lines[block.start + rowIndex] = `| ${cells.join(" | ")} |`;
    }
  }

  const result = lines.join("\n");
  return trailing && !result.endsWith("\n") ? `${result}\n` : result;
}

/**
 * The canonical form used for every comparison.
 *
 * Cells are trimmed and separators collapsed to `---`, so a table realigned by
 * prettier or oxfmt compares equal to the one propsmith would write. Lines
 * outside a table only lose trailing whitespace, and blank lines at either end
 * of the region are dropped — a region's surrounding blank lines are the
 * writer's business, not the content's.
 */
export function normalizeTable(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks = findTables(lines);
  const inTable = new Map<number, string[]>();

  for (const block of blocks) {
    for (const [rowIndex, row] of block.rows.entries()) {
      const cells = rowIndex === 1 ? row.map(() => "---") : row.map((cell) => cell.trim());
      inTable.set(block.start + rowIndex, cells);
    }
  }

  const out = lines.map((line, index) => {
    const cells = inTable.get(index);
    return cells === undefined ? line.trimEnd() : `|${cells.join("|")}|`;
  });

  while (out.length > 0 && out[0] === "") out.shift();
  while (out.length > 0 && out[out.length - 1] === "") out.pop();

  return out.join("\n");
}

/** True when two region bodies say the same thing, whatever their padding. */
export function sameContent(a: string, b: string): boolean {
  return normalizeTable(a) === normalizeTable(b);
}
