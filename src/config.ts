/**
 * Config authoring, loading and resolution.
 *
 * `loadConfig` finds and imports the user's config file, `resolveConfig` fills
 * in every default and reports what is unusable, and `defineConfig` exists only
 * so the authored file gets type checking.
 *
 * Nothing here throws on bad input: a config can arrive from a `package.json`
 * key, so every field is treated as untrusted and turned into a diagnostic
 * rather than an exception.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import type {
  ColumnId,
  Diagnostic,
  OutputConfig,
  PropsmithConfig,
  ResolvedConfig,
  ResolvedOutput,
  ResolvedTypes,
  SourceAdapter,
  TagRender,
} from "./types.js";
import { typescriptAdapter } from "./adapters/typescript.js";
import { parseJson } from "./json.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** The column set every output starts from. */
export const DEFAULT_COLUMNS: ColumnId[] = ["name", "type", "default", "description"];

/** Always appended to whatever the user put in `ignore`. */
const DEFAULT_IGNORE = ["**/node_modules/**", "**/dist/**"];

const DEFAULT_INLINE_UNDER = 60;

const DEFAULT_LOCKFILE = "propsmith.lock.json";

/** Looked for in this order, directly under `cwd`. */
const CONFIG_FILENAMES = ["propsmith.config.ts", "propsmith.config.js", "propsmith.config.mjs"];

/** `.ts`, `.mts`, `.cts` — the files Node can only import with type stripping. */
const TYPESCRIPT_FILE = /\.[cm]?ts$/i;

/**
 * The bare TypeScript reader, in every resolved config so a project with no
 * framework at all still has an adapter that claims its files.
 *
 * One instance, built from the published factory rather than declared a second
 * time here — two definitions of "the default adapter" is one too many.
 */
const defaultAdapter: SourceAdapter = typescriptAdapter();

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

/** Identity, for the types. `export default defineConfig({ … })`. */
export function defineConfig(config: PropsmithConfig): PropsmithConfig {
  return config;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Fill in every default and report what is unusable.
 *
 * A `ResolvedConfig` always comes back, even when the diagnostics contain
 * errors, so a caller can report every problem in one pass instead of failing
 * on the first. Paths are left exactly as the author wrote them — globs stay
 * relative — and only `cwd` is made absolute.
 */
export function resolveConfig(
  config: PropsmithConfig,
  cwd: string,
): { resolved: ResolvedConfig; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];

  // -- sources ---------------------------------------------------------------

  const sources = toStringArray(config.sources);
  if (sources.length === 0) {
    diagnostics.push(
      configError(
        "`sources` is empty or missing — propsmith needs at least one glob, " +
          'for example sources: ["src/**/*.{ts,tsx}"].',
      ),
    );
  }

  // -- ignore ----------------------------------------------------------------

  const ignore = unique([...toStringArray(config.ignore), ...DEFAULT_IGNORE]);

  // -- adapters --------------------------------------------------------------

  const adapters = toAdapterArray(config.adapters);
  if (!adapters.some((adapter) => adapter.name === defaultAdapter.name)) {
    adapters.push(defaultAdapter);
  }

  // -- tags ------------------------------------------------------------------
  // Adapter tags sit *under* the user's, so a user's `bindable: "column"` beats
  // the adapter's `bindable: "badge"` on a key collision.

  const tags: Record<string, TagRender> = {};
  for (const adapter of adapters) {
    Object.assign(tags, toTagRecord(adapter.tags));
  }
  Object.assign(tags, toTagRecord(config.tags));

  const tagColumns: ColumnId[] = Object.entries(tags)
    .filter(([, render]) => render === "column")
    .map(([id]) => id);

  // -- element attribute modules --------------------------------------------

  const elementAttributeModules = unique([
    ...toStringArray(config.elementAttributeModules),
    ...adapters.flatMap((adapter) => toStringArray(adapter.elementAttributeModules)),
  ]);

  // -- types -----------------------------------------------------------------

  let inlineUnder = DEFAULT_INLINE_UNDER;
  const rawInlineUnder = config.types?.inlineUnder;
  if (typeof rawInlineUnder === "number" && Number.isFinite(rawInlineUnder)) {
    if (rawInlineUnder < 0) {
      diagnostics.push(
        configError(
          `\`types.inlineUnder\` is ${rawInlineUnder}; it cannot be negative. ` +
            "Use 0 to disable inlining entirely.",
        ),
      );
    } else {
      inlineUnder = rawInlineUnder;
    }
  }

  const types: ResolvedTypes = {
    inlineUnder,
    links: toStringRecord(config.types?.links),
    inherit: config.types?.inherit !== false,
  };
  const glossary = config.types?.glossary;
  if (isNonEmptyString(glossary)) {
    types.glossary = glossary;
  }

  // -- outputs ---------------------------------------------------------------

  const rawOutputs = (Array.isArray(config.outputs) ? config.outputs : []) as unknown[];
  if (rawOutputs.length === 0) {
    diagnostics.push(
      configError(
        "`outputs` is empty or missing — propsmith needs at least one output, " +
          'for example outputs: [{ name: "docs", files: ["docs/**/*.md"] }].',
      ),
    );
  }

  const outputs: ResolvedOutput[] = [];
  const seenNames = new Set<string>();

  for (const entry of rawOutputs) {
    if (typeof entry !== "object" || entry === null) {
      diagnostics.push(configError("every entry in `outputs` must be an object."));
      continue;
    }
    const output = entry as OutputConfig;

    const name = isNonEmptyString(output.name) ? output.name : "";
    const label = name === "" ? "(unnamed)" : name;

    if (name === "") {
      diagnostics.push(configError("every output needs a `name` — it is what `--only` refers to."));
    } else if (seenNames.has(name)) {
      diagnostics.push(
        configError(`duplicate output name \`${name}\` — output names must be unique.`),
      );
    }
    seenNames.add(name);

    const files = toStringArray(output.files);
    if (files.length === 0) {
      diagnostics.push(
        configError(`output \`${label}\` has no \`files\` — it needs at least one glob.`),
      );
    }

    const description: "text" | "i18n" = output.description === "i18n" ? "i18n" : "text";
    if (description === "i18n" && config.i18n === undefined) {
      diagnostics.push(
        configError(
          `output \`${label}\` has \`description: "i18n"\` while \`config.i18n\` is undefined.`,
        ),
      );
    }

    const declaredColumns = toStringArray(output.columns);

    const resolvedOutput: ResolvedOutput = {
      name,
      files,
      columns: withTagColumns(
        declaredColumns.length > 0 ? declaredColumns : DEFAULT_COLUMNS,
        tagColumns,
      ),
      description,
    };

    const outputGlossary = isNonEmptyString(output.glossary) ? output.glossary : types.glossary;
    if (outputGlossary !== undefined) {
      resolvedOutput.glossary = outputGlossary;
    }

    outputs.push(resolvedOutput);
  }

  // -- assemble --------------------------------------------------------------

  const resolved: ResolvedConfig = {
    sources,
    ignore,
    adapters,
    outputs,
    tags,
    types,
    lockfile: isNonEmptyString(config.lockfile) ? config.lockfile : DEFAULT_LOCKFILE,
    elementAttributeModules,
    cwd: isNonEmptyString(config.cwd) ? resolve(cwd, config.cwd) : resolve(cwd),
  };

  if (config.i18n !== undefined) {
    resolved.i18n = config.i18n;
  }

  return { resolved, diagnostics };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

interface LoadedConfig {
  config: PropsmithConfig | null;
  path: string | null;
  diagnostics: Diagnostic[];
}

/**
 * Find and import the config.
 *
 * Looks for `explicitPath` when given, then `propsmith.config.ts`, `.js` and
 * `.mjs` under `cwd`, then a `"propsmith"` key in `package.json`. Returns a
 * null config instead of throwing, so the caller decides whether a missing
 * config is fatal — `init` does not care, `check` does.
 */
export async function loadConfig(cwd: string, explicitPath?: string): Promise<LoadedConfig> {
  const diagnostics: Diagnostic[] = [];
  const root = resolve(cwd);

  if (isNonEmptyString(explicitPath)) {
    const file = isAbsolute(explicitPath) ? explicitPath : resolve(root, explicitPath);
    if (!existsSync(file)) {
      diagnostics.push(configError(`config file not found: ${explicitPath}`, file));
      return { config: null, path: null, diagnostics };
    }
    return await importConfig(file, diagnostics);
  }

  const conventional = CONFIG_FILENAMES.map((filename) => resolve(root, filename)).find((file) =>
    existsSync(file),
  );
  if (conventional !== undefined) {
    return await importConfig(conventional, diagnostics);
  }

  const packagePath = resolve(root, "package.json");
  if (existsSync(packagePath)) {
    const fromPackage = readPackageConfig(packagePath);
    if (fromPackage !== null) {
      return { config: fromPackage, path: packagePath, diagnostics };
    }
  }

  return { config: null, path: null, diagnostics };
}

async function importConfig(file: string, diagnostics: Diagnostic[]): Promise<LoadedConfig> {
  if (file.toLowerCase().endsWith("package.json")) {
    const fromPackage = readPackageConfig(file);
    if (fromPackage === null) {
      diagnostics.push(configError(`\`${file}\` has no \`"propsmith"\` key.`, file));
      return { config: null, path: file, diagnostics };
    }
    return { config: fromPackage, path: file, diagnostics };
  }

  let namespace: Record<string, unknown>;
  try {
    namespace = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  } catch (error) {
    diagnostics.push(configError(importFailure(file, error), file));
    return { config: null, path: file, diagnostics };
  }

  const exported = namespace.default === undefined ? namespace : namespace.default;
  if (typeof exported !== "object" || exported === null || Array.isArray(exported)) {
    diagnostics.push(
      configError(
        `\`${file}\` did not export a config object — ` +
          "it should `export default defineConfig({ … })`.",
        file,
      ),
    );
    return { config: null, path: file, diagnostics };
  }

  return { config: exported as PropsmithConfig, path: file, diagnostics };
}

function importFailure(file: string, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  if (TYPESCRIPT_FILE.test(file)) {
    return (
      `could not import \`${file}\`: Node refused to load a TypeScript config. ` +
      "Importing one relies on native type stripping, which is only on by default " +
      `from Node 22.18 onwards (this process is ${process.version}). Either move to ` +
      "a newer Node, or rename the file to `propsmith.config.mjs` and write it in " +
      `plain JavaScript. (${reason})`
    );
  }
  return `could not import \`${file}\`: ${reason}`;
}

function readPackageConfig(packagePath: string): PropsmithConfig | null {
  let text: string;
  try {
    text = readFileSync(packagePath, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = parseJson(text);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;

  const value = (parsed as Record<string, unknown>).propsmith;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  return value as PropsmithConfig;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function configError(message: string, file?: string): Diagnostic {
  const diagnostic: Diagnostic = { severity: "error", code: "config-invalid", message };
  if (file !== undefined) diagnostic.file = file;
  return diagnostic;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter(isNonEmptyString);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function toAdapterArray(value: unknown): SourceAdapter[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter(
    (adapter): adapter is SourceAdapter => typeof adapter === "object" && adapter !== null,
  );
}

function toTagRecord(value: unknown): Record<string, TagRender> {
  const out: Record<string, TagRender> = {};
  if (typeof value !== "object" || value === null) return out;
  for (const [key, render] of Object.entries(value as Record<string, unknown>)) {
    if (render === "badge" || render === "column") out[key] = render;
  }
  return out;
}

function toStringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof value !== "object" || value === null) return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

/** Appends every `column`-rendered tag that is not already in the list. */
function withTagColumns(columns: ColumnId[], tagColumns: ColumnId[]): ColumnId[] {
  const out = [...columns];
  for (const id of tagColumns) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
