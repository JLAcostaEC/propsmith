/**
 * IR -> GFM table.
 *
 * This module is pure markdown assembly: it never resolves a type, never reads
 * a catalog and never touches the filesystem. The two cells whose content
 * depends on configuration — Type and Description — arrive as callbacks, which
 * is what keeps type resolution and the i18n lane out of the renderer.
 */

import type { ColumnId, ComponentDoc, ExtraRow, MemberDoc, TagRender } from "../types.js";
import { codeSpan, escapeCell, oneLine } from "./escape.js";

/** The two texts a deprecation notice is assembled from. */
export interface Deprecation {
  /** The word introducing the notice. */
  label: string;
  /** The reason. Empty when `@deprecated` carried none. */
  reason: string;
}

export interface RenderTableOptions {
  component: ComponentDoc;
  columns: ColumnId[];
  tags: Record<string, TagRender>;
  /** Renders the Type cell. Provided by the caller so this module stays pure. */
  renderTypeCell: (member: MemberDoc) => string;
  /** Renders the Description cell — plain text or an i18n expression. */
  renderDescriptionCell: (member: MemberDoc) => string;
  /**
   * The label and reason of the deprecation notice, already in whatever
   * language the output writes. Defaults to the English label and the reason
   * verbatim from the tag.
   */
  renderDeprecation?: (member: MemberDoc) => Deprecation;
}

/** The English label, used unless the caller supplies its own. */
const DEPRECATED_LABEL = "Deprecated";

/** Headings for the columns propsmith understands itself. */
export const COLUMN_HEADINGS: Record<string, string> = {
  name: "Name",
  type: "Type",
  default: "Default",
  description: "Description",
};

/** Used only when a caller hands over an empty column list. */
const DEFAULT_COLUMNS: ColumnId[] = ["name", "type", "default", "description"];

export function renderTable(opts: RenderTableOptions): string {
  const { component, columns, tags, renderTypeCell, renderDescriptionCell } = opts;
  const renderDeprecation = opts.renderDeprecation ?? defaultDeprecation;
  const cols = columns.length > 0 ? columns : DEFAULT_COLUMNS;
  const headings = cols.map(headingFor);

  const lines: string[] = [row(headings.map(escapeCell)), row(headings.map(separatorFor))];

  for (const member of component.members) {
    lines.push(
      row(
        cols.map((column) =>
          escapeCell(
            memberCell(
              column,
              member,
              tags,
              renderTypeCell,
              renderDescriptionCell,
              renderDeprecation,
            ),
          ),
        ),
      ),
    );
  }

  for (const extra of component.extras) {
    lines.push(row(cols.map((column) => escapeCell(extraCell(column, extra)))));
  }

  return `${lines.join("\n")}\n`;
}

/** `name` -> `Name`; a tag column is Title Cased: `since` -> `Since`. */
function headingFor(column: ColumnId): string {
  const known = COLUMN_HEADINGS[column];
  if (known !== undefined) return known;
  const words: string[] = [];
  for (const word of column.split(/[-_\s]+/)) {
    if (word.length > 0) words.push(word.charAt(0).toUpperCase() + word.slice(1));
  }
  return words.length > 0 ? words.join(" ") : column;
}

/** Dashes matching the heading's width, so the table reads well unrendered. */
function separatorFor(heading: string): string {
  return "-".repeat(Math.max(3, heading.length));
}

/** `| a | b |`, with an empty cell written as a single space. */
function row(cells: readonly string[]): string {
  const rendered = cells.map((cell) => (cell.length > 0 ? ` ${cell} ` : " "));
  return `|${rendered.join("|")}|`;
}

function memberCell(
  column: ColumnId,
  member: MemberDoc,
  tags: Record<string, TagRender>,
  renderTypeCell: (member: MemberDoc) => string,
  renderDescriptionCell: (member: MemberDoc) => string,
  renderDeprecation: (member: MemberDoc) => Deprecation,
): string {
  switch (column) {
    case "name":
      return nameCell(member, tags);
    case "type":
      return renderTypeCell(member);
    case "default":
      return defaultCell(member);
    case "description":
      return descriptionCell(member, renderDescriptionCell, renderDeprecation);
    default:
      return flagCell(column, member);
  }
}

/** `` `size` ``, struck through when deprecated, badges appended in config order. */
function nameCell(member: MemberDoc, tags: Record<string, TagRender>): string {
  const name = codeSpan(member.name);
  const cell = member.deprecated === undefined ? name : `~~${name}~~`;
  const badges = badgesFor(member, tags);
  return badges.length > 0 ? `${cell} ${badges}` : cell;
}

/** ` _bindable_ _experimental_` — the tag name in italics, in the config's key order. */
function badgesFor(member: MemberDoc, tags: Record<string, TagRender>): string {
  const badges: string[] = [];
  for (const tag of Object.keys(tags)) {
    if (tags[tag] !== "badge") continue;
    const value: string | true | undefined = member.flags[tag];
    if (value === undefined) continue;
    badges.push(`_${tag}_`);
  }
  return badges.join(" ");
}

function defaultCell(member: MemberDoc): string {
  const value = member.defaultValue;
  if (value === undefined || value.trim().length === 0) return "";
  return codeSpan(value);
}

/**
 * The caller's text, with the deprecation notice appended **on the same line** —
 * a `br` element would be an HTML tag, which propsmith never emits.
 */
function descriptionCell(
  member: MemberDoc,
  render: (member: MemberDoc) => string,
  renderDeprecation: (member: MemberDoc) => Deprecation,
): string {
  const text = oneLine(render(member));
  if (member.deprecated === undefined) return text;

  const { label, reason } = renderDeprecation(member);
  const word = oneLine(label) || DEPRECATED_LABEL;
  const why = oneLine(reason);
  const notice = why.length > 0 ? `**${word}:** ${why}` : `**${word}.**`;
  return text.length > 0 ? `${text} ${notice}` : notice;
}

/** English label, reason verbatim: what an output with no i18n lane writes. */
function defaultDeprecation(member: MemberDoc): Deprecation {
  return {
    label: DEPRECATED_LABEL,
    reason: typeof member.deprecated === "string" ? member.deprecated : "",
  };
}

/** A tag rendered as its own column: its text, or empty for a bare flag. */
function flagCell(column: string, member: MemberDoc): string {
  const value: string | true | undefined = member.flags[column];
  return typeof value === "string" ? value : "";
}

/** Extras carry a pre-rendered label and note; every other column is empty. */
function extraCell(column: ColumnId, extra: ExtraRow): string {
  if (column === "name") return extra.label;
  if (column === "description") return extra.note ?? "";
  return "";
}
