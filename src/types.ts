/**
 * The shared contract for every propsmith module.
 *
 * Nothing here imports a parser, a framework or an i18n tool. The core speaks
 * TypeScript syntax and markdown; everything else arrives through an adapter.
 */

// ---------------------------------------------------------------------------
// Source location
// ---------------------------------------------------------------------------

export interface SourceRef {
  /** Absolute path of the file the node was read from. */
  file: string;
  /** 1-indexed. */
  line: number;
  /** 1-indexed. */
  column: number;
}

// ---------------------------------------------------------------------------
// Intermediate representation
// ---------------------------------------------------------------------------

/** A row that summarises an intersection member rather than a declared prop. */
export interface ExtraRow {
  kind: "element-attributes" | "pick" | "omit" | "reference";
  /** Rendered name cell, e.g. `Element Attributes (button)`. */
  label: string;
  /** For `element-attributes`: the DOM element the type argument names. */
  element?: string;
  /** For `pick` / `omit`: the string-literal keys, verbatim without quotes. */
  keys?: string[];
  /** The referenced type name, e.g. `FSInput` or `HTMLButtonAttributes`. */
  origin?: string;
  /** Rendered description cell. */
  note?: string;
}

export interface MemberDoc {
  /** Property name, unquoted. */
  name: string;
  optional: boolean;
  readonly: boolean;
  /** Verbatim type text as written by the author, collapsed to one line. */
  type: string;
  /** First JSDoc paragraph. Empty string when undocumented. */
  description: string;
  /** The whole JSDoc body, paragraphs included. Never rendered into a cell. */
  descriptionFull: string;
  /** `@default` value, verbatim. */
  defaultValue?: string;
  /** `@deprecated`: the reason, or `true` when the tag carries no text. */
  deprecated?: string | true;
  /** `@see` target: a URL or a type name. */
  see?: string;
  /** `@type` override for the Type cell. Recorded so `check` can report it. */
  typeOverride?: string;
  /**
   * `@inheritDoc`: the type to take the description from, or `true` when the
   * tag names none and the member's own type is used.
   */
  inheritDoc?: string | true;
  /**
   * Set when `description` — and possibly `defaultValue` — came from a type
   * declaration rather than from the member's own JSDoc. The declared name.
   */
  inheritedFrom?: string;
  /**
   * Configured tags (`tags` in the config) present on this member.
   * Value is the tag's text, or `true` when it is a bare flag.
   */
  flags: Record<string, string | true>;
  source: SourceRef;
}

export interface ComponentDoc {
  /** The `@propsmith` argument. May be namespaced: `shared/Button`. */
  name: string;
  /** The declared type name, e.g. `ButtonProps`. */
  typeName: string;
  /** Type parameters, verbatim: `["T", "K extends keyof T = keyof T"]`. */
  typeParameters: string[];
  members: MemberDoc[];
  /** Summary rows produced by intersection members, in declaration order. */
  extras: ExtraRow[];
  source: SourceRef;
}

/** A type alias or interface found while scanning, used to resolve references. */
export interface TypeDeclaration {
  name: string;
  /** Verbatim declaration body, collapsed to one line. */
  text: string;
  /** What the declaration is, which decides how it degrades when too long. */
  shape: "union" | "object" | "alias";
  /** For `object`: the member names, for the key-shape fallback. */
  keys?: string[];
  /** For `union`: the members, for the truncated-union fallback. */
  values?: string[];
  /** First JSDoc paragraph on the declaration. Members can inherit it. */
  description?: string;
  /** `@default` on the declaration, verbatim. Members can inherit it. */
  defaultValue?: string;
  source: SourceRef;
}

export interface ExtractResult {
  components: ComponentDoc[];
  /** Every exported type alias / interface in the file, for the symbol index. */
  declarations: TypeDeclaration[];
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type DiagnosticCode =
  | "parse-error"
  | "duplicate-component"
  | "tag-without-marker"
  | "marker-without-tag"
  | "unpaired-marker"
  | "mismatched-marker"
  | "duplicate-marker"
  | "table-drift"
  | "missing-description"
  | "type-override-used"
  | "type-too-long"
  | "unresolved-type"
  | "invalid-key"
  | "catalog-orphan-key"
  | "catalog-missing-key"
  | "catalog-stale"
  | "catalog-hand-edited"
  | "catalog-conflict"
  | "config-invalid";

export interface Diagnostic {
  severity: "error" | "warning";
  code: DiagnosticCode;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

// ---------------------------------------------------------------------------
// Source adapters — `propsmith/adapters`
// ---------------------------------------------------------------------------

export interface ExtractedScript {
  /** TypeScript source to hand to the parser. */
  code: string;
  lang: "ts" | "tsx";
  /**
   * Byte offset of `code` inside the original file. Added back when computing
   * line and column so diagnostics point at the real file.
   */
  offset: number;
}

export interface SourceAdapter {
  name: string;
  /** File extensions this adapter claims, including the dot. */
  extensions: string[];
  /**
   * Pull TypeScript out of a file. Return `null` when the file holds nothing
   * parseable (a `.svelte` with no `<script lang="ts">`, for instance).
   */
  extract(source: string, filePath: string): ExtractedScript | null;
  /** Modules whose types become an `Element Attributes` row. */
  elementAttributeModules?: string[];
  /** Tags this adapter contributes, merged under the user's own `tags`. */
  tags?: Record<string, TagRender>;
}

// ---------------------------------------------------------------------------
// i18n adapters — `propsmith/i18n/adapters`
// ---------------------------------------------------------------------------

/** locale -> key -> text */
export type Catalog = Record<string, Record<string, string>>;

/**
 * What a catalog key names.
 *
 * - `description` — a prop's description.
 * - `deprecated` — the reason text of a prop's `@deprecated`.
 * - `type` — a description inherited from a shared type, so every prop typed
 *   with it shares one message.
 * - `label` — fixed wording propsmith itself writes into a cell, such as the
 *   word introducing a deprecation notice.
 */
export type KeyKind = "description" | "deprecated" | "type" | "label";

export interface KeyContext {
  /** The component. Empty for `type`; `"propsmith"` for `label`. */
  component: string;
  /** The prop. Empty for `type`; the label's id for `label`. */
  prop: string;
  kind: KeyKind;
  /** For `type`: the declaration the text came from, e.g. `Variant`. */
  type?: string;
}

export interface I18nAdapter {
  name: string;
  locales(): { source: string; all: string[] };
  load(): Catalog;
  save(catalog: Catalog): void;
  /** The expression written into the markdown cell, e.g. `{m.the_key()}`. */
  expression(key: string): string;
  /** `null` when the key is legal, otherwise the reason it is not. */
  validateKey(key: string): string | null;
  /** Key naming. Defaults to `<component>_props_<prop>`, snake-cased. */
  key?(ctx: KeyContext): string;
  /** Where invalidated translations are parked. `{locale}` is substituted. */
  stalePath?: string;
}

// ---------------------------------------------------------------------------
// Lockfile
// ---------------------------------------------------------------------------

export interface LockEntry {
  /** `path/to/file.ts#TypeName.member` */
  source: string;
  /** Hash of the English propsmith last wrote. */
  en: string;
  /** locale -> hash of the English that translation was made from. */
  locales: Record<string, string>;
}

export interface Lockfile {
  version: 1;
  /** key -> entry, alphabetically ordered on write. */
  keys: Record<string, LockEntry>;
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

export interface Region {
  /** `Button`, `shared/Button`, or `@types` for a built-in region. */
  name: string;
  kind: "component" | "builtin";
  file: string;
  /** Offsets into the file text. */
  openStart: number;
  openEnd: number;
  /** Absent when the closing marker is missing. */
  closeStart?: number;
  closeEnd?: number;
  /** Current text between the markers, trimmed of the surrounding blank lines. */
  body: string;
  line: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type TagRender = "badge" | "column";

export type ColumnId = "name" | "type" | "default" | "description" | (string & {});

export interface OutputConfig {
  /** Referenced by `--only`. */
  name: string;
  files: string[];
  columns?: ColumnId[];
  /** `text` writes plain English; `i18n` writes the adapter's expression. */
  description?: "text" | "i18n";
  /** Overrides `types.glossary` for this output's links. */
  glossary?: string;
}

export interface TypesConfig {
  /** Max characters for an inlined definition. `0` disables inlining. */
  inlineUnder?: number;
  /** URL base for glossary links. Defaults to a same-file anchor. */
  glossary?: string;
  /** Type name -> URL, for types propsmith can never resolve. */
  links?: Record<string, string>;
  /**
   * Let an undocumented prop take the description and `@default` of the type it
   * is declared with. Defaults to `true`. `@inheritDoc` works either way.
   */
  inherit?: boolean;
}

export interface PropsmithConfig {
  sources: string[];
  ignore?: string[];
  /** Source adapters. The bare TypeScript reader is always present. */
  adapters?: SourceAdapter[];
  outputs: OutputConfig[];
  tags?: Record<string, TagRender>;
  types?: TypesConfig;
  i18n?: I18nAdapter;
  lockfile?: string;
  /** Extra modules whose types become an `Element Attributes` row. */
  elementAttributeModules?: string[];
  cwd?: string;
}

export interface ResolvedOutput {
  name: string;
  files: string[];
  columns: ColumnId[];
  description: "text" | "i18n";
  glossary?: string;
}

export interface ResolvedTypes {
  inlineUnder: number;
  links: Record<string, string>;
  inherit: boolean;
  glossary?: string;
}

/** Config with every default filled in. What modules actually receive. */
export interface ResolvedConfig {
  sources: string[];
  ignore: string[];
  adapters: SourceAdapter[];
  outputs: ResolvedOutput[];
  tags: Record<string, TagRender>;
  types: ResolvedTypes;
  i18n?: I18nAdapter;
  lockfile: string;
  elementAttributeModules: string[];
  cwd: string;
}

// ---------------------------------------------------------------------------
// Run results
// ---------------------------------------------------------------------------

export interface FileChange {
  file: string;
  region: string;
  status: "created" | "updated" | "unchanged";
  /** How many rows the table carries. Shown in the write report. */
  rows?: number;
  /** The generated markdown. Populated in `dry-run`, so it can be printed. */
  body?: string;
}

export interface CatalogChange {
  file: string;
  added: string[];
  updated: string[];
  invalidated: string[];
  removed: string[];
}

export interface RunResult {
  changes: FileChange[];
  catalog: CatalogChange[];
  diagnostics: Diagnostic[];
  /** IR, exposed by `--json`. */
  components: ComponentDoc[];
  durationMs: number;
}

export type RunMode = "write" | "dry-run" | "check";

export interface RunOptions {
  mode: RunMode;
  config: ResolvedConfig;
  /** Restrict to these component names. */
  components?: string[];
  /** Restrict to these output names. */
  only?: string[];
  /** Skip the i18n lane for this run. */
  noI18n?: boolean;
  strict?: boolean;
}
