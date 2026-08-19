/**
 * `propsmith.lock.json` — hashing, reading and writing.
 *
 * Three texts are alive at once: the English in the JSDoc, the
 * English in the catalog, and the translation. Only the lockfile records the
 * fourth thing nobody else knows — *which* English a translation was made from —
 * so it is the one file here that cannot be recomputed from source. That is why
 * it is committed, why every map in it is written in alphabetical order, and why
 * a merge conflict inside `locales` is resolved by keeping both sides.
 *
 * A missing or unreadable lockfile is never an error. The worst it costs is one
 * run that re-adopts what it finds; throwing would make a first run impossible.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseJson } from "../json.js";
import type { LockEntry, Lockfile } from "../types.js";

/** How many hex characters of the digest are kept. */
const HASH_LENGTH = 8;

/**
 * A short, stable fingerprint of a description.
 *
 * Whitespace is normalised first — trimmed, then every run collapsed to a single
 * space — so re-wrapping a JSDoc paragraph to a new print width produces the
 * same hash. Reflowing a comment is not a content change, and treating it as one
 * would throw away every translation in the project over a formatting pass.
 *
 * Eight hex characters is 32 bits. The comparison is always scoped to a single
 * key, so a collision would have to happen between two successive texts of the
 * *same* description; the failure mode is one missed invalidation, not a corrupt
 * catalog.
 */
export function hashText(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, HASH_LENGTH);
}

/** A lockfile that owns nothing yet. */
function emptyLockfile(): Lockfile {
  return { version: 1, keys: {} };
}

/**
 * Read the lockfile at `path`.
 *
 * Missing, unparseable, of an unknown version, or structurally wrong in any part
 * all degrade to an empty lockfile rather than an exception, and individual
 * malformed entries are dropped while the rest survive.
 */
export function readLockfile(path: string): Lockfile {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return emptyLockfile();
  }

  let parsed: unknown;
  try {
    parsed = parseJson(text);
  } catch {
    return emptyLockfile();
  }

  if (!isRecord(parsed)) return emptyLockfile();
  if (parsed.version !== 1) return emptyLockfile();

  const lock = emptyLockfile();

  if (isRecord(parsed.keys)) {
    for (const [key, value] of Object.entries(parsed.keys)) {
      const entry = toLockEntry(value);
      if (entry !== null) lock.keys[key] = entry;
    }
  }

  return lock;
}

/**
 * Write the lockfile at `path`, creating its directory when it is missing.
 *
 * Two-space JSON, every object's keys in alphabetical order, one trailing
 * newline, `\n` line endings on every platform. The ordering is the whole point:
 * this file is committed and merged, and a stable order keeps a conflict down to
 * the lines that actually changed.
 */
export function writeLockfile(path: string, lock: Lockfile): void {
  const directory = dirname(path);
  if (directory !== "" && directory !== ".") mkdirSync(directory, { recursive: true });
  writeFileSync(path, `${JSON.stringify(sortDeep(lock), null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringRecord(value: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

/** `null` when the value is not a usable {@link LockEntry}. */
function toLockEntry(value: unknown): LockEntry | null {
  if (!isRecord(value)) return null;
  if (typeof value.source !== "string" || typeof value.en !== "string") return null;
  return {
    source: value.source,
    en: value.en,
    locales: isRecord(value.locales) ? toStringRecord(value.locales) : {},
  };
}

/** Every object's keys in alphabetical order, arrays left in their own order. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) out[key] = sortDeep(value[key]);
  return out;
}
