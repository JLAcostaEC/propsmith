/**
 * The programmatic API.
 *
 * Source adapters live at `@jlacostaec/propsmith/adapters` and i18n adapters at
 * `@jlacostaec/propsmith/i18n/adapters`, so neither is pulled in by a config
 * that does not use them.
 */

export { DEFAULT_COLUMNS, defineConfig, loadConfig, resolveConfig } from "./config.js";
export { DEFAULT_EXTRAS_LABELS } from "./render/extras.js";
export { discoverSources, discoverTargets } from "./discovery.js";
export { extractFile } from "./extract/index.js";
export { run } from "./run.js";

export type {
  Catalog,
  CatalogChange,
  ColumnId,
  ComponentDoc,
  Diagnostic,
  DiagnosticCode,
  ExtractResult,
  ExtractedScript,
  ExtraRow,
  ExtrasConfig,
  ExtrasLabels,
  FileChange,
  I18nAdapter,
  KeyContext,
  KeyKind,
  LockEntry,
  Lockfile,
  MemberDoc,
  OutputConfig,
  PropsmithConfig,
  Region,
  ResolvedConfig,
  ResolvedExtras,
  ResolvedOutput,
  ResolvedTypes,
  RunMode,
  RunOptions,
  RunResult,
  SourceAdapter,
  SourceRef,
  TagRender,
  TypeDeclaration,
  TypesConfig,
} from "./types.js";
