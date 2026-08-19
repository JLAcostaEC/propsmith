/**
 * Discovery — the glob pass, plus the substring pre-filter that keeps the
 * parser off the thousands of files that have nothing to say.
 *
 * Read every file the globs match, then skip it entirely unless its text
 * contains `@propsmith`. Reading and substring-matching is milliseconds;
 * parsing is not.
 */

import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { glob } from "tinyglobby";
import type { ResolvedConfig, ResolvedOutput, SourceAdapter } from "./types.js";

/** The tag that makes a file worth parsing. */
const MARKER_TAG = "@propsmith";

/**
 * Files are read in parallel, but not all at once — a wide glob over a big
 * monorepo will otherwise open thousands of handles and hit EMFILE.
 */
const READ_CONCURRENCY = 64;

export interface DiscoveredFile {
  /** Absolute path, in the platform's own separator. */
  path: string;
  /** Raw file text, exactly as it is on disk. */
  source: string;
  /** The adapter whose `extensions` claimed this file. */
  adapter: SourceAdapter;
}

export interface DiscoverOptions {
  /**
   * Replaces the default `@propsmith` substring pre-filter.
   *
   * The symbol index needs a second pass over the same globs with a wider net
   * — every file that declares an exported type, not only the tagged ones — so
   * the filter is a parameter rather than a hardcoded `includes`.
   */
  filter?: (source: string, path: string) => boolean;
}

export interface DiscoveredTarget {
  output: ResolvedOutput;
  /** Absolute path, in the platform's own separator. */
  path: string;
  /** Raw file text, exactly as it is on disk. */
  source: string;
}

/**
 * Every source file worth handing to the extractor.
 *
 * Sorted by path, so two runs over an unchanged tree produce identical output.
 * A file whose extension no adapter claims is skipped silently — that is what
 * lets `sources` be a wide glob without the config having to enumerate every
 * extension the project happens to contain.
 */
export async function discoverSources(
  config: ResolvedConfig,
  options: DiscoverOptions = {},
): Promise<DiscoveredFile[]> {
  const filter = options.filter ?? defaultFilter;
  const paths = await globFiles(config.sources, config);

  const found = await mapWithConcurrency(paths, async (path) => {
    const adapter = adapterFor(config.adapters, path);
    if (adapter === null) return null;

    const source = await readText(path);
    if (source === null) return null;
    if (!filter(source, path)) return null;

    return { path, source, adapter } satisfies DiscoveredFile;
  });

  return found.toSorted((a, b) => comparePaths(a.path, b.path));
}

/**
 * Every documentation file an output points at, paired with that output.
 *
 * `outputNames` restricts the run to the named outputs (`--only`); an unknown
 * name simply matches nothing. One file matched by two outputs yields two
 * entries — they carry different column sets, so they are different jobs.
 */
export async function discoverTargets(
  config: ResolvedConfig,
  outputNames?: string[],
): Promise<DiscoveredTarget[]> {
  const wanted = outputNames === undefined ? null : new Set(outputNames);
  const outputs =
    wanted === null ? config.outputs : config.outputs.filter((output) => wanted.has(output.name));

  const groups = await Promise.all(
    outputs.map(async (output) => {
      const paths = await globFiles(output.files, config);
      return await mapWithConcurrency(paths, async (path) => {
        const source = await readText(path);
        if (source === null) return null;
        return { output, path, source } satisfies DiscoveredTarget;
      });
    }),
  );

  return groups.flat().toSorted((a, b) => {
    const byPath = comparePaths(a.path, b.path);
    return byPath === 0 ? comparePaths(a.output.name, b.output.name) : byPath;
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function defaultFilter(source: string): boolean {
  return source.includes(MARKER_TAG);
}

async function globFiles(patterns: string[], config: ResolvedConfig): Promise<string[]> {
  if (patterns.length === 0) return [];

  const matches = await glob(patterns, {
    cwd: config.cwd,
    absolute: true,
    ignore: config.ignore,
    onlyFiles: true,
  });

  // tinyglobby hands back POSIX separators on every platform; `resolve` puts
  // them back into the shape the rest of the tool compares and prints.
  return [...new Set(matches.map((match) => resolve(match)))];
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    // The file vanished between the glob and the read, or is unreadable.
    // Neither is worth failing a whole run over.
    return null;
  }
}

function adapterFor(adapters: SourceAdapter[], path: string): SourceAdapter | null {
  const ext = extname(path).toLowerCase();
  if (ext === "") return null;

  for (const adapter of adapters) {
    for (const claimed of adapter.extensions ?? []) {
      if (typeof claimed !== "string") continue;
      const normalised = claimed.startsWith(".") ? claimed : `.${claimed}`;
      if (normalised.toLowerCase() === ext) return adapter;
    }
  }

  return null;
}

/** Locale-independent, so the order does not change with the machine. */
function comparePaths(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

async function mapWithConcurrency<T>(
  items: string[],
  worker: (item: string) => Promise<T | null>,
): Promise<T[]> {
  const results: (T | null)[] = Array.from({ length: items.length }, () => null);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(READ_CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      // Sequential by design: this is the concurrency limiter, and the whole
      // point is that each runner takes the next item only once it is free.
      // oxlint-disable-next-line no-await-in-loop
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);

  return results.filter((result): result is T => result !== null);
}
