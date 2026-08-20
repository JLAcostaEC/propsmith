/**
 * One extraction pass, three modes.
 *
 * `dry-run` and `check` never touch disk; `write` is the only mode that does.
 * Everything else about the pipeline is identical between them, which is the
 * point: `check` fails on exactly what `write` would have changed.
 */

import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { discoverSources, discoverTargets, type DiscoveredTarget } from "./discovery.js";
import { extractFile } from "./extract/index.js";
import { parseJson } from "./json.js";
import { defaultKey, DEPRECATED_LABEL, LABEL_NAMESPACE } from "./i18n/key.js";
import { readLockfile, writeLockfile } from "./i18n/lockfile.js";
import { syncCatalog } from "./i18n/sync.js";
import { scanRegions } from "./markers/scan.js";
import { replaceRegions } from "./markers/write.js";
import { alignTable, sameContent } from "./render/align.js";
import { assertNoHtml, codeSpan } from "./render/escape.js";
import { renderGlossary, type GlossaryEntry } from "./render/glossary.js";
import { renderTable, type Deprecation } from "./render/table.js";
import { createSymbolIndex, type SymbolIndex } from "./resolve/index.js";
import { inheritDocs } from "./resolve/inherit.js";
import { renderType } from "./resolve/render-type.js";
import type {
  Catalog,
  CatalogChange,
  ComponentDoc,
  Diagnostic,
  FileChange,
  KeyContext,
  Lockfile,
  MemberDoc,
  Region,
  ResolvedConfig,
  ResolvedOutput,
  RunOptions,
  RunResult,
  TypeDeclaration,
} from "./types.js";

/** The built-in region that collects every type a table could not inline. */
const GLOSSARY_REGION = "@types";

/**
 * What the lockfile records as the origin of a label.
 *
 * Every other key comes from a file and a member; a label's English is
 * propsmith's own wording, so it says so rather than blaming someone's source.
 */
const LABEL_SOURCE = "propsmith#labels";

/** Type names conventionally start with a capital; good enough to seed a lookup. */
const TYPE_NAME = /\b[A-Z][A-Za-z0-9_]*\b/g;

export async function run(options: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const { config, mode } = options;
  const diagnostics: Diagnostic[] = [];

  const { components, declarations } = await extractAll(config, diagnostics);
  const found = filterComponents(components, options.components);
  checkFilter(options.components, components.flatMap(namesOf), "--component", diagnostics);

  const index = createSymbolIndex(declarations);
  await expandIndex(index, found, config, declarations);

  // Inheritance runs on a complete index — the type a prop borrows its
  // description from usually lives in another file — and before anything is
  // rendered, so the catalog and the tables see the same text.
  const inherited = inheritDocs({ components: found, index, types: config.types });
  diagnostics.push(...inherited.diagnostics);
  const selected = inherited.components;

  // An empty `only` restricts nothing — a caller that filtered down to no names
  // meant "all outputs", not "no outputs".
  const only = options.only === undefined || options.only.length === 0 ? undefined : options.only;
  checkFilter(
    only,
    config.outputs.map((output) => output.name),
    "--only",
    diagnostics,
  );

  const targets = await discoverTargets(config, only);
  checkOutputsMatched(config, only, targets, diagnostics);
  const jobs = collectRegions(targets, mode, diagnostics);

  // With `--only` in play the run deliberately sees a subset of the outputs, so
  // "this type has no marker anywhere" is a conclusion it is not entitled to.
  crossCheck(selected, jobs, diagnostics, only === undefined);

  const i18n = options.noI18n === true ? undefined : config.i18n;
  const catalogState =
    i18n === undefined ? null : prepareCatalog(config, selected, index, diagnostics);

  const rendered = renderAll(selected, jobs, index, config, catalogState, diagnostics);

  const changes = detectChanges(jobs, rendered, mode, diagnostics);

  if (mode === "write") {
    await applyWrites(jobs, rendered, config, catalogState, config.cwd);
  }

  return {
    changes,
    catalog: catalogState?.changes ?? [],
    diagnostics,
    components: selected,
    durationMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

async function extractAll(
  config: ResolvedConfig,
  diagnostics: Diagnostic[],
): Promise<{ components: ComponentDoc[]; declarations: TypeDeclaration[] }> {
  const files = await discoverSources(config);
  const components: ComponentDoc[] = [];
  const declarations: TypeDeclaration[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    const script = file.adapter.extract(file.source, file.path);
    if (script === null) continue;

    const result = extractFile({
      filePath: file.path,
      code: script.code,
      lang: script.lang,
      offset: script.offset,
      originalSource: file.source,
      tags: config.tags,
      elementAttributeModules: config.elementAttributeModules,
      extras: config.types.extras,
    });

    diagnostics.push(...result.diagnostics);
    declarations.push(...result.declarations);

    for (const component of result.components) {
      const previous = seen.get(component.name);
      if (previous !== undefined) {
        diagnostics.push({
          severity: "error",
          code: "duplicate-component",
          message:
            `two types claim @propsmith ${component.name}: ${previous} and ${file.path}. ` +
            `Namespace one of them, e.g. @propsmith shared/${component.name}`,
          file: file.path,
          line: component.source.line,
          column: component.source.column,
        });
        continue;
      }
      seen.set(component.name, file.path);
      components.push(component);
    }
  }

  return { components, declarations };
}

function filterComponents(components: ComponentDoc[], wanted?: string[]): ComponentDoc[] {
  if (wanted === undefined || wanted.length === 0) return components;
  const set = new Set(wanted);
  return components.filter((component) => set.has(component.name) || set.has(component.typeName));
}

/**
 * The second index pass: only when a name is actually missing.
 *
 * The first pass sees only files carrying `@propsmith`, so a shared
 * `type Sizes = …` in a file that documents nothing is invisible to it. Rather
 * than parse the whole tree on the chance it might be needed, look up exactly
 * the names that came up short.
 */
async function expandIndex(
  index: SymbolIndex,
  components: readonly ComponentDoc[],
  config: ResolvedConfig,
  already: readonly TypeDeclaration[],
): Promise<void> {
  const missing = new Set<string>();
  for (const component of components) {
    for (const member of component.members) {
      // A `@type {X}` override is resolved like a declared type, so the names
      // in it have to be looked for in the same pass.
      const text =
        member.typeOverrideKind === "type" && member.typeOverride !== undefined
          ? `${member.type} ${member.typeOverride}`
          : member.type;
      for (const name of text.match(TYPE_NAME) ?? []) {
        if (index.get(name) === undefined) missing.add(name);
      }
      // `@inheritDoc Variant` may name a type the member's own text never
      // mentions, and it is the one name the author asked for by hand.
      const asked = member.inheritDoc;
      if (typeof asked === "string" && index.get(asked) === undefined) missing.add(asked);
    }
  }
  if (missing.size === 0) return;

  const names = [...missing].map(escapeRegExp).join("|");
  const declares = new RegExp(`\\b(?:type|interface|enum)\\s+(?:${names})\\b`);
  const parsed = new Set(already.map((declaration) => declaration.source.file));

  const files = await discoverSources(config, {
    filter: (source, path) => !parsed.has(path) && declares.test(source),
  });

  for (const file of files) {
    const script = file.adapter.extract(file.source, file.path);
    if (script === null) continue;
    const result = extractFile({
      filePath: file.path,
      code: script.code,
      lang: script.lang,
      offset: script.offset,
      originalSource: file.source,
      tags: config.tags,
      elementAttributeModules: config.elementAttributeModules,
      extras: config.types.extras,
    });
    index.add(result.declarations);
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A path fit to be committed.
 *
 * The lockfile is a tracked file, so an absolute `C:\Users\jorge\…` in it would
 * differ on every checkout and every CI runner, and the separator would differ
 * between Windows and everywhere else. Either alone turns the lockfile into a
 * permanent merge conflict. Relative to the project root, forward slashes.
 */
function portablePath(file: string, cwd: string): string {
  const rel = relative(cwd, file);
  const inside = rel !== "" && !rel.startsWith("..");
  return (inside ? rel : file).split("\\").join("/");
}

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

interface RegionJob {
  path: string;
  output: ResolvedOutput;
  region: Region;
  source: string;
}

/**
 * Scan every target file for regions.
 *
 * A lone opening marker is an invitation rather than a mistake: `write` inserts
 * the closing marker and the table, and `dry-run` reports what `write` would do.
 * Reporting it in those modes would fail the run over something the same run
 * just repaired — so the scanner's `unpaired-marker` is a `check` finding only.
 * A marker naming no tagged type is still reported, by `crossCheck`.
 */
function collectRegions(
  targets: DiscoveredTarget[],
  mode: RunOptions["mode"],
  diagnostics: Diagnostic[],
): RegionJob[] {
  const jobs: RegionJob[] = [];
  const claimed = new Map<string, string>();

  for (const target of targets) {
    const owner = claimed.get(target.path);
    if (owner !== undefined && owner !== target.output.name) {
      diagnostics.push({
        severity: "warning",
        code: "config-invalid",
        message:
          `${target.path} is matched by outputs "${owner}" and "${target.output.name}"; ` +
          `"${owner}" wins. Narrow one output's files glob`,
        file: target.path,
      });
      continue;
    }
    claimed.set(target.path, target.output.name);

    const scan = scanRegions(target.path, target.source);
    diagnostics.push(
      ...(mode === "check"
        ? scan.diagnostics
        : scan.diagnostics.filter((entry) => entry.code !== "unpaired-marker")),
    );
    for (const region of scan.regions) {
      jobs.push({ path: target.path, output: target.output, region, source: target.source });
    }
  }

  return jobs;
}

/** A component answers to its `@propsmith` name and to its declared type name. */
function namesOf(component: ComponentDoc): string[] {
  return [component.name, component.typeName];
}

/**
 * A filter name that matches nothing is a typo, and saying so beats the wall of
 * downstream errors it would otherwise cause.
 */
function checkFilter(
  wanted: readonly string[] | undefined,
  known: readonly string[],
  flag: string,
  diagnostics: Diagnostic[],
): void {
  if (wanted === undefined) return;
  const set = new Set(known);
  for (const name of wanted) {
    if (set.has(name)) continue;
    diagnostics.push({
      severity: "error",
      code: "config-invalid",
      message:
        `${flag} ${name} matches nothing. ` +
        (known.length > 0
          ? `Known: ${[...set].toSorted().join(", ")}`
          : "Nothing was found at all"),
    });
  }
}

/**
 * An output whose glob matches nothing documents nothing.
 *
 * Silence here is expensive: every tagged type then reports `tag-without-marker`
 * — "add a marker to a documentation file" — while the marker is already there,
 * in a file the glob never looked at. The run blames the tag for a mistake in
 * the config. Say which glob came back empty instead.
 */
function checkOutputsMatched(
  config: ResolvedConfig,
  only: readonly string[] | undefined,
  targets: readonly DiscoveredTarget[],
  diagnostics: Diagnostic[],
): void {
  const considered =
    only === undefined ? config.outputs : config.outputs.filter((o) => only.includes(o.name));
  const matched = new Set(targets.map((target) => target.output.name));

  for (const output of considered) {
    if (matched.has(output.name)) continue;
    diagnostics.push({
      severity: "warning",
      code: "config-invalid",
      message:
        `output "${output.name}" matched no files: ${output.files.join(", ")} ` +
        `(relative to ${config.cwd}). Nothing can be documented into it, so every tagged ` +
        `type will be reported as having no marker`,
    });
  }
}

function crossCheck(
  components: readonly ComponentDoc[],
  jobs: readonly RegionJob[],
  diagnostics: Diagnostic[],
  allOutputs: boolean,
): void {
  const marked = new Set(
    jobs.filter((job) => job.region.kind === "component").map((job) => job.region.name),
  );

  for (const component of components) {
    if (marked.has(component.name) || !allOutputs) continue;
    diagnostics.push({
      severity: "error",
      code: "tag-without-marker",
      message:
        `@propsmith ${component.name} has no marker in any output. ` +
        `Add <!-- props:${component.name} --> to a documentation file`,
      file: component.source.file,
      line: component.source.line,
      column: component.source.column,
    });
  }

  const known = new Set(components.map((component) => component.name));
  for (const job of jobs) {
    if (job.region.kind !== "component" || known.has(job.region.name)) continue;
    diagnostics.push({
      severity: "error",
      code: "marker-without-tag",
      message:
        `marker <!-- props:${job.region.name} --> has no type tagged ` +
        `@propsmith ${job.region.name}`,
      file: job.path,
      line: job.region.line,
    });
  }
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/**
 * The catalog keys one prop owns.
 *
 * Both are absent when there is no text behind them: an empty message is never
 * written, so a cell that referred to one would call a function the i18n
 * compiler never generates.
 */
interface PropKeys {
  /** The description. Shared with other props when it was inherited. */
  description?: string;
  /** The `@deprecated` reason, when the tag carries one. */
  deprecated?: string;
}

interface CatalogState {
  /** component name -> prop name -> keys */
  keys: Map<string, Map<string, PropKeys>>;
  /** The word introducing a deprecation notice. Absent when nothing is deprecated. */
  labelKey?: string;
  expression: (key: string) => string;
  changes: CatalogChange[];
  catalog: Catalog;
  /** locale -> key -> the value parked because its English changed. */
  stale: Record<string, Record<string, string>>;
  lock: Lockfile;
  lockPath: string;
}

function prepareCatalog(
  config: ResolvedConfig,
  components: readonly ComponentDoc[],
  index: SymbolIndex,
  diagnostics: Diagnostic[],
): CatalogState | null {
  const adapter = config.i18n;
  if (adapter === undefined) return null;

  const keyOf = (ctx: KeyContext): string =>
    adapter.key === undefined ? defaultKey(ctx) : adapter.key(ctx);

  const keys = new Map<string, Map<string, PropKeys>>();
  const entries: Record<string, { english: string; source: string }> = {};
  let labelKey: string | undefined;

  for (const component of components) {
    const perProp = new Map<string, PropKeys>();

    for (const member of component.members) {
      const at = `${portablePath(component.source.file, config.cwd)}#${component.typeName}.${member.name}`;
      const inheritedFrom = member.inheritedFrom;

      // A description borrowed from a shared type is one message, not one per
      // prop: every prop typed `Variant` says the same thing, so translating it
      // once is the point of borrowing it.
      const description =
        inheritedFrom === undefined
          ? keyOf({ component: component.name, prop: member.name, kind: "description" })
          : keyOf({ component: "", prop: "", kind: "type", type: inheritedFrom });

      const declaration = inheritedFrom === undefined ? undefined : index.get(inheritedFrom);
      const propKeys: PropKeys = {};

      if (member.description.trim() !== "") {
        entries[description] = {
          english: member.description,
          source:
            declaration === undefined
              ? at
              : `${portablePath(declaration.source.file, config.cwd)}#${inheritedFrom}`,
        };
        propKeys.description = description;
      }

      const reason = typeof member.deprecated === "string" ? member.deprecated : "";
      if (reason !== "") {
        const key = keyOf({ component: component.name, prop: member.name, kind: "deprecated" });
        if (key === description) {
          diagnostics.push({
            severity: "error",
            code: "invalid-key",
            message:
              `${component.name}.${member.name}: the adapter's \`key\` returned \`${key}\` for ` +
              "both the description and the @deprecated reason. Return a distinct key per " +
              "`kind`, or the two texts overwrite each other in the catalog",
            file: member.source.file,
            line: member.source.line,
            column: member.source.column,
          });
        } else {
          entries[key] = { english: reason, source: at };
          propKeys.deprecated = key;
        }
      }

      if (member.deprecated !== undefined && labelKey === undefined) {
        // The notice reads "**Deprecated:** …", so the word itself is part of
        // the cell and has to be translatable too.
        labelKey = keyOf({
          component: LABEL_NAMESPACE,
          prop: DEPRECATED_LABEL,
          kind: "label",
        });
        entries[labelKey] = { english: "Deprecated", source: LABEL_SOURCE };
      }

      perProp.set(member.name, propKeys);
    }

    keys.set(component.name, perProp);
  }

  const lockPath = resolve(config.cwd, config.lockfile);
  const result = syncCatalog({ adapter, lock: readLockfile(lockPath), entries });
  diagnostics.push(...result.diagnostics);

  return {
    keys,
    ...(labelKey === undefined ? {} : { labelKey }),
    expression: (key) => adapter.expression(key),
    changes: result.changes,
    catalog: result.catalog,
    stale: result.stale,
    lock: result.lock,
    lockPath,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderAll(
  components: readonly ComponentDoc[],
  jobs: readonly RegionJob[],
  index: SymbolIndex,
  config: ResolvedConfig,
  catalog: CatalogState | null,
  diagnostics: Diagnostic[],
): Map<RegionJob, string> {
  const byName = new Map(components.map((component) => [component.name, component]));
  const out = new Map<RegionJob, string>();
  const glossaryNeeded = new Set<string>();

  for (const job of jobs) {
    if (job.region.kind === "builtin") continue;

    const component = byName.get(job.region.name);
    if (component === undefined) continue;

    const body = renderComponent(
      component,
      job.output,
      index,
      config,
      catalog,
      diagnostics,
      glossaryNeeded,
    );
    out.set(job, body);
  }

  // The glossary comes last, so it sees every type the tables could not inline.
  const entries: GlossaryEntry[] = [];
  for (const name of [...glossaryNeeded].toSorted()) {
    const declaration = index.get(name);
    if (declaration !== undefined) entries.push({ name, text: declaration.text });
  }

  for (const job of jobs) {
    if (job.region.kind !== "builtin") continue;
    if (job.region.name !== GLOSSARY_REGION) {
      diagnostics.push({
        severity: "error",
        code: "marker-without-tag",
        message: `unknown built-in region <!-- props:${job.region.name} -->; only ${GLOSSARY_REGION} exists`,
        file: job.path,
        line: job.region.line,
      });
      continue;
    }
    out.set(job, renderGlossary(entries));
  }

  return out;
}

function renderComponent(
  component: ComponentDoc,
  output: ResolvedOutput,
  index: SymbolIndex,
  config: ResolvedConfig,
  catalog: CatalogState | null,
  diagnostics: Diagnostic[],
  glossaryNeeded: Set<string>,
): string {
  const glossary = output.glossary ?? config.types.glossary;

  const renderTypeCell = (member: MemberDoc): string => {
    const override = member.typeOverride;
    // `@type A CSS length` is prose standing in for a type: printed as written,
    // save for the pipe splitting every cell needs to survive the table.
    if (override !== undefined && member.typeOverrideKind !== "type") return codeSpan(override);

    // `@type {ButtonGenerics}` is a type the author wrote instead of the
    // declared one, so it earns everything a declared type gets: resolution,
    // the glossary, `types.links`, and the same warnings when it comes short.
    const result = renderType(override ?? member.type, {
      index,
      types: config.types,
      glossary,
      see: member.see,
    });

    for (const name of result.glossaryNeeded) glossaryNeeded.add(name);

    for (const name of result.unresolved) {
      diagnostics.push({
        severity: "warning",
        code: "unresolved-type",
        message:
          `${component.name}.${member.name}: \`${name}\` could not be resolved and is not in ` +
          `types.links — the cell is plain text`,
        file: member.source.file,
        line: member.source.line,
        column: member.source.column,
      });
    }

    for (const name of result.tooLong) {
      diagnostics.push({
        severity: "warning",
        code: "type-too-long",
        message:
          `${component.name}.${member.name}: \`${name}\` is longer than ` +
          `${config.types.inlineUnder} characters and there is no glossary to link it to. ` +
          `Add <!-- props:${GLOSSARY_REGION} --> or shorten the type`,
        file: member.source.file,
        line: member.source.line,
        column: member.source.column,
      });
    }

    return result.markdown;
  };

  const localized = output.description === "i18n" && catalog !== null;

  const renderDescriptionCell = (member: MemberDoc): string => {
    if (!localized) return member.description;
    const key = catalog?.keys.get(component.name)?.get(member.name)?.description;
    return key === undefined ? member.description : catalog!.expression(key);
  };

  /**
   * A deprecation notice is two texts — the word and the reason — and both are
   * read by the same person, so an output that translates its descriptions
   * translates these too.
   */
  const renderDeprecation = (member: MemberDoc): Deprecation => {
    const reason = typeof member.deprecated === "string" ? member.deprecated : "";
    if (!localized) return { label: "Deprecated", reason };

    const keys = catalog?.keys.get(component.name)?.get(member.name);
    return {
      label: catalog?.labelKey === undefined ? "Deprecated" : catalog.expression(catalog.labelKey),
      reason: keys?.deprecated === undefined ? reason : catalog!.expression(keys.deprecated),
    };
  };

  const table = renderTable({
    component,
    columns: output.columns,
    tags: config.tags,
    renderTypeCell,
    renderDescriptionCell,
    renderDeprecation,
  });

  const aligned = alignTable(table);
  assertNoHtml(aligned, `${component.name} (${output.name})`);
  return aligned;
}

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

function detectChanges(
  jobs: readonly RegionJob[],
  rendered: Map<RegionJob, string>,
  mode: RunOptions["mode"],
  diagnostics: Diagnostic[],
): FileChange[] {
  const changes: FileChange[] = [];

  for (const job of jobs) {
    const body = rendered.get(job);
    if (body === undefined) continue;

    // Padding is not content: a table realigned by prettier or oxfmt still says
    // the same thing, and treating that as drift would fail CI forever.
    const status =
      job.region.closeStart === undefined
        ? "created"
        : sameContent(job.region.body, body)
          ? "unchanged"
          : "updated";

    changes.push({
      file: job.path,
      region: job.region.name,
      status,
      rows: countRows(body, job.region.kind),
      // Only `dry-run` prints the markdown, so only it pays for carrying it.
      ...(mode === "dry-run" ? { body } : {}),
    });

    if (mode === "check" && status !== "unchanged") {
      diagnostics.push({
        severity: "error",
        code: "table-drift",
        message:
          status === "created"
            ? `<!-- props:${job.region.name} --> has no closing marker and no table`
            : `<!-- props:${job.region.name} --> does not match the type${driftDetail(job, body)}`,
        file: job.path,
        line: job.region.line,
      });
    }
  }

  return changes;
}

/** How many names a drift message lists before it says "and N more". */
const MAX_LISTED_PROPS = 6;

/**
 * Which props the committed table is missing, and which of its rows no longer
 * have a prop behind them.
 *
 * "The table does not match the type" is true but useless: the reader still has
 * to diff two tables by eye to find out what moved. Both lists come from the
 * Name column of the two bodies, so a description edit — which changes no name
 * — correctly produces neither.
 */
function driftDetail(job: RegionJob, body: string): string {
  const column = job.output.columns.indexOf("name");
  if (column === -1) return "";

  const before = new Set(propNames(job.region.body, column));
  const after = propNames(body, column);

  const added = after.filter((name) => !before.has(name));
  const removed = [...before].filter((name) => !after.includes(name));

  const parts: string[] = [];
  if (added.length > 0) parts.push(`${count(added, "prop")} with no row: ${list(added)}`);
  if (removed.length > 0) parts.push(`${count(removed, "row")} with no prop: ${list(removed)}`);

  return parts.length === 0 ? "" : ` — ${parts.join("; ")}`;
}

/** A cell that is one code span, struck through or not: a prop name, unwrapped. */
const NAME_CELL = /^(?:~~)?`+\s*(.+?)\s*`+(?:~~)?$/;

/**
 * The prop names in one rendered table.
 *
 * A cell that is not a bare code span — `Element Attributes (`button`)` — is a
 * summary row rather than a prop, and is skipped.
 */
function propNames(table: string, column: number): string[] {
  const names: string[] = [];
  const rows = table.split("\n").filter((line) => line.trim().startsWith("|"));

  for (const row of rows.slice(2)) {
    // The border pipes leave an empty first field, so the columns are 1-based.
    const cell = (row.split("|")[column + 1] ?? "").trim();
    const name = NAME_CELL.exec(cell)?.[1];
    if (name !== undefined && !name.includes("`")) names.push(name);
  }

  return names;
}

function count(items: readonly string[], noun: string): string {
  return `${items.length} ${noun}${items.length === 1 ? "" : "s"}`;
}

function list(names: readonly string[]): string {
  const shown = names.slice(0, MAX_LISTED_PROPS).join(", ");
  return names.length > MAX_LISTED_PROPS
    ? `${shown} and ${names.length - MAX_LISTED_PROPS} more`
    : shown;
}

/**
 * What the region holds, for the write report.
 *
 * A component region is measured in table rows past the header and its
 * separator; the glossary has no table at all, so it is measured in the type
 * headings it collected. Counting its (nonexistent) rows reported `0 props`
 * on a region that had just been filled.
 */
function countRows(body: string, kind: Region["kind"]): number {
  if (kind === "builtin") {
    return body.split("\n").filter((line) => line.startsWith("### ")).length;
  }
  const rows = body.split("\n").filter((line) => line.trim().startsWith("|"));
  return Math.max(0, rows.length - 2);
}

// ---------------------------------------------------------------------------
// Writing — the only place that touches disk
// ---------------------------------------------------------------------------

async function applyWrites(
  jobs: readonly RegionJob[],
  rendered: Map<RegionJob, string>,
  config: ResolvedConfig,
  catalog: CatalogState | null,
  cwd: string,
): Promise<void> {
  const byFile = new Map<string, { source: string; edits: { region: Region; body: string }[] }>();

  for (const job of jobs) {
    const body = rendered.get(job);
    if (body === undefined) continue;
    const entry = byFile.get(job.path) ?? { source: job.source, edits: [] };
    entry.edits.push({ region: job.region, body });
    byFile.set(job.path, entry);
  }

  await Promise.all(
    [...byFile].map(async ([path, { source, edits }]) => {
      const result = replaceRegions(source, edits);
      if (result.changed) await writeFile(path, result.text, "utf8");
    }),
  );

  if (catalog === null) return;

  const adapter = config.i18n;
  if (adapter !== undefined) adapter.save(catalog.catalog);
  await writeStale(adapter, catalog, cwd);
  writeLockfile(catalog.lockPath, catalog.lock);
}

/**
 * Park invalidated translations rather than deleting them.
 *
 * The previous wording is what a translator edits from, and the presence of a
 * key in this file is the review queue — so an existing stale file is merged
 * into, never replaced.
 */
async function writeStale(
  adapter: ResolvedConfig["i18n"],
  catalog: CatalogState,
  cwd: string,
): Promise<void> {
  const pattern = adapter?.stalePath;
  if (pattern === undefined) return;

  await Promise.all(
    Object.entries(catalog.stale)
      .filter(([, values]) => Object.keys(values).length > 0)
      .map(async ([locale, values]) => {
        const path = resolve(cwd, pattern.replace("{locale}", locale));
        const merged = { ...readJsonObject(path), ...values };
        const sorted = Object.fromEntries(
          Object.entries(merged).toSorted(([a], [b]) => (a < b ? -1 : 1)),
        );
        await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
      }),
  );
}

function readJsonObject(path: string): Record<string, string> {
  try {
    const parsed = parseJson(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}
