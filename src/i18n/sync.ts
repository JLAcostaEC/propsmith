/**
 * The staleness algorithm.
 *
 * This is core, not per-adapter: an adapter only knows how to read,
 * write and speak its tool's syntax, and duplicating the hardest code in the
 * project across every plugin would guarantee that they disagree.
 *
 * Three texts are alive at once — the English in the JSDoc (**A**), the English
 * in the catalog (**B**), and the translation (**C**) — and the question that
 * matters, *was C translated from the English that is there now?*, is answerable
 * from neither A nor B alone. The lockfile answers it, which turns one bit into
 * the four-way table below:
 *
 * | A vs `lock.en` | B vs `lock.en` | meaning              | action                                |
 * | -------------- | -------------- | -------------------- | ------------------------------------- |
 * | =              | =              | nothing changed      | nothing                               |
 * | ≠              | =              | the JSDoc changed    | rewrite B, invalidate translations     |
 * | =              | ≠              | B was hand-edited    | warn, restore B, leave translations   |
 * | ≠              | ≠              | both changed         | conflict: report, restore B, invalidate |
 *
 * Row three is the whole argument for the lockfile. Comparing A against B
 * directly collapses it into row two and does the opposite of the right thing:
 * it destroys a good translation over someone's typo fix in the catalog.
 *
 * {@link syncCatalog} is pure. It calls `adapter.load()` and returns everything
 * that should be written; the runner decides whether this is a `write`, a
 * `--dry-run` or a `check` and writes nothing in the last two.
 */

import type {
  Catalog,
  CatalogChange,
  Diagnostic,
  DiagnosticCode,
  I18nAdapter,
  LockEntry,
  Lockfile,
} from "../types.js";
import { hashText } from "./lockfile.js";

/** One documented member, as the extractor produced it. */
export interface SyncEntry {
  /** The English description, verbatim from the JSDoc. */
  english: string;
  /** `path/to/file.ts#TypeName.member`, for diagnostics and the lockfile. */
  source: string;
}

export interface SyncInput {
  adapter: I18nAdapter;
  lock: Lockfile;
  /** key -> { english, source } for every documented member, freshly extracted. */
  entries: Record<string, SyncEntry>;
}

export interface SyncOutput {
  catalog: Catalog;
  lock: Lockfile;
  /** locale -> key -> value parked because its English changed. */
  stale: Record<string, Record<string, string>>;
  changes: CatalogChange[];
  diagnostics: Diagnostic[];
}

/**
 * Reconcile the catalog with freshly extracted English.
 *
 * Returns the catalog to save, the lockfile to write, the translations to park
 * in the stale files, a per-locale change summary and every diagnostic the run
 * produced. Nothing is written and neither `input.lock` nor the object returned
 * by `adapter.load()` is mutated.
 *
 * An entry whose English is blank is skipped: an empty message is worse than no
 * message, and an undocumented member is already reported by the extractor as
 * `missing-description`. Its lockfile entry is preserved so the state survives
 * until the JSDoc comes back.
 */
export function syncCatalog(input: SyncInput): SyncOutput {
  const { adapter, entries } = input;

  const loaded = adapter.load();
  const { source, all } = collectLocales(adapter, loaded);
  const catalog = cloneCatalog(loaded, all);

  const priorKeys = input.lock.keys ?? {};
  const nextKeys: Record<string, LockEntry> = {};

  const stale: Record<string, Record<string, string>> = {};
  const diagnostics: Diagnostic[] = [];
  const changes = newChanges(all);

  /** Keys that reached the catalog this run, for the missing-translation pass. */
  const owned: string[] = [];
  /** key -> locales parked this run, so they are not also reported as missing. */
  const parked = new Map<string, Set<string>>();

  // -- every documented member ----------------------------------------------

  for (const key of Object.keys(entries).toSorted()) {
    const entry = entries[key];
    const prior = priorKeys[key];

    const reason = adapter.validateKey(key);
    if (reason !== null) {
      diagnostics.push(
        diagnostic(
          "error",
          "invalid-key",
          `\`${key}\` is not a legal key for the ${adapter.name} catalog: ${reason} ` +
            "The member is skipped; give it a key through the adapter's `key` option.",
          entry.source,
        ),
      );
      if (prior !== undefined) nextKeys[key] = prior;
      continue;
    }

    const english = entry.english;
    if (english.trim() === "") {
      if (prior !== undefined) nextKeys[key] = prior;
      continue;
    }

    const englishHash = hashText(english);
    const current = catalog[source][key];

    // The two comparisons the table is built from. A source value that is
    // missing entirely counts as changed: deleting it by hand is an edit.
    const jsdocChanged = prior !== undefined && englishHash !== prior.en;
    const catalogMatchesLock =
      prior !== undefined && current !== undefined && hashText(current) === prior.en;

    let invalidate = false;

    if (prior === undefined) {
      // Brand new, or a key adopted from a catalog written before propsmith.
      // Existing translations are taken at face value — see `lockedLocales`.
    } else if (!jsdocChanged && catalogMatchesLock) {
      // Row one. Nothing to do, and in particular nothing to rewrite: the hash
      // ignores whitespace, so a reflowed catalog value is left as the author
      // last saw it.
      nextKeys[key] = {
        source: entry.source,
        en: prior.en,
        locales: lockedLocales(catalog, all, source, key, prior, englishHash),
      };
      owned.push(key);
      continue;
    } else if (jsdocChanged && catalogMatchesLock) {
      // Row two: the JSDoc moved and the catalog is exactly what propsmith left.
      invalidate = true;
    } else if (!jsdocChanged && !catalogMatchesLock) {
      // Row three: the catalog was edited by hand. It is generated output, so
      // the JSDoc wins — but the translations were made from an English that has
      // not moved, so they are still valid and are left alone.
      diagnostics.push(
        diagnostic(
          "warning",
          "catalog-hand-edited",
          `\`${key}\`: the ${source} catalog was edited by hand, but it is generated — ` +
            "the JSDoc is the source of truth, so the English has been restored. " +
            "Move the edit into the prop's JSDoc. Translations were left alone.",
          entry.source,
        ),
      );
    } else {
      // Row four: both moved. The JSDoc still wins, but the divergence is
      // reported rather than quietly resolved.
      diagnostics.push(
        diagnostic(
          "warning",
          "catalog-conflict",
          `\`${key}\`: the JSDoc and the ${source} catalog have both changed since the ` +
            "last run. The JSDoc wins; check that nothing was lost from the catalog.",
          entry.source,
        ),
      );
      invalidate = true;
    }

    // -- write the English ---------------------------------------------------

    if (current === undefined) {
      changes[source].added.push(key);
    } else if (current !== english) {
      changes[source].updated.push(key);
    }
    catalog[source][key] = english;

    // -- park translations made from an English that has moved ---------------

    if (invalidate) {
      for (const locale of all) {
        if (locale === source) continue;
        const value = catalog[locale][key];
        if (value === undefined) continue;
        // A translation already made from the new English survives; that is the
        // whole reason `locales` records a hash per locale instead of one bit.
        if (prior !== undefined && prior.locales[locale] === englishHash) continue;

        (stale[locale] ??= {})[key] = value;
        delete catalog[locale][key];
        changes[locale].invalidated.push(key);
        ensureSet(parked, key).add(locale);

        diagnostics.push(
          diagnostic(
            "warning",
            "catalog-stale",
            `\`${key}\`: the ${locale} translation was made from an earlier English text. ` +
              "It has been moved to the stale file for review.",
            entry.source,
          ),
        );
      }
    }

    nextKeys[key] = {
      source: entry.source,
      en: englishHash,
      locales: lockedLocales(catalog, all, source, key, prior, englishHash),
    };
    owned.push(key);
  }

  // -- keys propsmith owns that no member produces any more -------------------

  for (const key of Object.keys(priorKeys).toSorted()) {
    if (key in entries) continue;
    const prior = priorKeys[key];

    diagnostics.push(
      diagnostic(
        "warning",
        "catalog-orphan-key",
        `\`${key}\` is owned by propsmith but no documented prop produces it any more — ` +
          "removed from the catalog. If the prop was renamed, the new key was added " +
          "in the same run and the translation has to be carried over by hand.",
        prior.source,
      ),
    );

    for (const locale of all) {
      if (catalog[locale][key] === undefined) continue;
      delete catalog[locale][key];
      changes[locale].removed.push(key);
    }
  }

  // -- translations that were never made -------------------------------------

  for (const key of owned) {
    for (const locale of all) {
      if (locale === source) continue;
      if (catalog[locale][key] !== undefined) continue;
      // Already reported as stale a moment ago; saying it twice helps nobody.
      if (parked.get(key)?.has(locale) === true) continue;

      diagnostics.push(
        diagnostic(
          "warning",
          "catalog-missing-key",
          `\`${key}\` has no ${locale} translation. It is left missing on purpose: ` +
            `paraglide resolves the fallback to ${source} at compile time, so writing ` +
            "the English into it would hide the gap instead of showing it.",
          entries[key].source,
        ),
      );
    }
  }

  // -- assemble ---------------------------------------------------------------

  const lock: Lockfile = { version: 1, keys: nextKeys };

  return {
    catalog,
    lock,
    stale,
    changes: all.map((locale) => changes[locale]).filter(hasChange),
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The locales to work over: the adapter's, plus any the catalog holds that it
 * did not declare, with the source locale first.
 *
 * An undeclared locale is kept rather than ignored so that removing an orphan
 * key removes it there too, instead of leaving a message the adapter cannot see.
 */
function collectLocales(adapter: I18nAdapter, loaded: Catalog): { source: string; all: string[] } {
  const reported = adapter.locales();
  const source =
    typeof reported.source === "string" && reported.source !== "" ? reported.source : "en";
  const declared = Array.isArray(reported.all) ? reported.all : [];
  const all = [source];
  for (const locale of [...declared, ...Object.keys(loaded)]) {
    if (typeof locale !== "string" || locale === "") continue;
    if (!all.includes(locale)) all.push(locale);
  }
  return { source, all };
}

/** A deep copy with an entry for every locale, so nothing indexes `undefined`. */
function cloneCatalog(loaded: Catalog, all: readonly string[]): Catalog {
  const catalog: Catalog = {};
  for (const locale of all) {
    const messages = loaded[locale];
    const copy: Record<string, string> = {};
    if (isRecord(messages)) {
      for (const [key, value] of Object.entries(messages)) {
        if (typeof value === "string") copy[key] = value;
      }
    }
    catalog[locale] = copy;
  }
  return catalog;
}

function newChanges(all: readonly string[]): Record<string, CatalogChange> {
  const changes: Record<string, CatalogChange> = {};
  for (const locale of all) {
    // `file` carries the locale: a pure function has no path, and every adapter
    // keys its catalog files by locale. A runner that knows the adapter's path
    // pattern is free to rewrite it before reporting.
    changes[locale] = { file: locale, added: [], updated: [], invalidated: [], removed: [] };
  }
  return changes;
}

function hasChange(change: CatalogChange): boolean {
  return (
    change.added.length > 0 ||
    change.updated.length > 0 ||
    change.invalidated.length > 0 ||
    change.removed.length > 0
  );
}

/**
 * `locales` for one lockfile entry: for every locale that still holds a
 * translation, the hash of the English it was made from.
 *
 * A translation with no recorded hash — one that predates propsmith, or that a
 * translator added between runs — is recorded against the current English. The
 * alternative is to declare every hand-added translation stale the moment it
 * appears, which would make the stale file useless as a review queue.
 */
function lockedLocales(
  catalog: Catalog,
  all: readonly string[],
  source: string,
  key: string,
  prior: LockEntry | undefined,
  englishHash: string,
): Record<string, string> {
  const locales: Record<string, string> = {};
  for (const locale of all) {
    if (locale === source) continue;
    if (catalog[locale][key] === undefined) continue;
    locales[locale] = prior?.locales[locale] ?? englishHash;
  }
  return locales;
}

/** `path/to/file.ts#TypeName.member` -> `path/to/file.ts`. */
function fileOf(source: string): string | undefined {
  const hash = source.indexOf("#");
  const file = hash === -1 ? source : source.slice(0, hash);
  return file === "" ? undefined : file;
}

function diagnostic(
  severity: "error" | "warning",
  code: DiagnosticCode,
  message: string,
  source: string,
): Diagnostic {
  const result: Diagnostic = { severity, code, message };
  const file = fileOf(source);
  if (file !== undefined) result.file = file;
  return result;
}

function ensureSet(map: Map<string, Set<string>>, key: string): Set<string> {
  let set = map.get(key);
  if (set === undefined) {
    set = new Set<string>();
    map.set(key, set);
  }
  return set;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
