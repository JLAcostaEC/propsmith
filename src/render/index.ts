/** Markdown rendering: escaping, the props table, and the `@types` glossary. */

export { assertNoHtml, codeSpan, containsHtmlTag, escapeCell, oneLine } from "./escape.js";
export { DEFAULT_EXTRAS_LABELS, EXTRAS_PLACEHOLDERS, formatExtraLabel } from "./extras.js";
export type { ExtraLabelValues } from "./extras.js";
export { renderGlossary } from "./glossary.js";
export type { GlossaryEntry } from "./glossary.js";
export { COLUMN_HEADINGS, renderTable } from "./table.js";
export type { RenderTableOptions } from "./table.js";
