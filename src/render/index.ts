/** Markdown rendering: escaping, the props table, and the `@types` glossary. */

export { assertNoHtml, codeSpan, escapeCell, oneLine } from "./escape.js";
export { renderGlossary } from "./glossary.js";
export type { GlossaryEntry } from "./glossary.js";
export { COLUMN_HEADINGS, renderTable } from "./table.js";
export type { RenderTableOptions } from "./table.js";
