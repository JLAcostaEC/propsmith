/**
 * The paraglide / inlang adapter.
 *
 * Four things vary between i18n tools: where the catalog lives, which locales
 * exist, what expression goes into the markdown, and which keys are legal. This
 * file answers those four questions for paraglide and nothing else — the
 * staleness algorithm is core (see `../sync.ts`), because duplicating it per
 * plugin would guarantee that the plugins disagree.
 *
 * Everything it needs is already in `project.inlang/settings.json`, so none of
 * it is repeated in `propsmith.config.ts`: the locales, and the message file
 * pattern from the `plugin.inlang.messageFormat` entry.
 *
 * propsmith writes the catalog and stops. It does not run `paraglide-js
 * compile` — that is the consumer's build, and its ordering (`propsmith` ->
 * `paraglide-js compile` -> `vite`) belongs in their scripts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { parseJson } from "../../json.js";
import type { Catalog, I18nAdapter, KeyContext } from "../../types.js";
import { defaultKey } from "../key.js";

export interface ParaglideOptions {
  /** The inlang project directory, the one holding `settings.json`. */
  project?: string;
  /** Key naming. Defaults to `<component>_props_<prop>`, snake-cased. */
  key?: (ctx: KeyContext) => string;
  /** The expression written into the markdown cell. Defaults to `{m.key()}`. */
  expression?: (key: string) => string;
  /** Where invalidated translations are parked. `{locale}` is substituted. */
  stalePath?: string;
  /** Root for every relative path here. Defaults to `process.cwd()`. */
  cwd?: string;
}

/** Settings shape, as far as this adapter reads it. Every field is untrusted. */
interface InlangSettings {
  baseLocale?: unknown;
  sourceLanguageTag?: unknown;
  locales?: unknown;
  languageTags?: unknown;
  "plugin.inlang.messageFormat"?: unknown;
}

const DEFAULT_PROJECT = "./project.inlang";
const DEFAULT_STALE_PATH = "./messages/{locale}.stale.json";
const DEFAULT_PATH_PATTERN = "./messages/{locale}.json";
const MESSAGE_FORMAT_PLUGIN = "plugin.inlang.messageFormat";

/** The locale placeholder, plus the spelling inlang used before it. */
const LOCALE_PLACEHOLDER = /\{locale\}|\{languageTag\}/g;

/** A JavaScript identifier: what paraglide compiles a key into. */
const IDENTIFIER = /^[a-zA-Z_$][\w$]*$/;

/**
 * Keys inlang stores alongside the messages rather than as messages —
 * `$schema`, principally. They are never surfaced as catalog entries and never
 * removed on save.
 */
function isMetaKey(key: string): boolean {
  return key.startsWith("$");
}

/**
 * paraglide preset.
 *
 * `locales()` and `load()` both read `settings.json`, which is parsed once and
 * cached: a run is short and the file does not move under it.
 */
export function paraglide(options?: ParaglideOptions): I18nAdapter {
  const root = resolve(options?.cwd ?? process.cwd());
  const projectDirectory = resolve(root, options?.project ?? DEFAULT_PROJECT);
  const settingsPath = resolve(projectDirectory, "settings.json");
  const expression = options?.expression ?? ((key: string) => `{m.${key}()}`);

  let settings: InlangSettings | null = null;

  /**
   * Parse `settings.json`, once.
   *
   * This is the one place the adapter throws. A missing project is a
   * configuration mistake, not a document that can be repaired by guessing, and
   * the message names the exact path that was looked for so the fix is obvious.
   */
  function readSettings(): InlangSettings {
    if (settings !== null) return settings;

    if (!existsSync(settingsPath)) {
      throw new Error(
        `propsmith: the paraglide adapter could not find \`${settingsPath}\`. ` +
          "Point the adapter's `project` option at the directory that holds " +
          `\`settings.json\` — it defaults to \`${DEFAULT_PROJECT}\`, resolved against ` +
          `\`${root}\`.`,
      );
    }

    let parsed: unknown;
    try {
      parsed = parseJson(readFileSync(settingsPath, "utf8"));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`propsmith: could not read \`${settingsPath}\`: ${reason}`, { cause: error });
    }

    if (!isRecord(parsed)) {
      throw new Error(`propsmith: \`${settingsPath}\` does not contain a JSON object.`);
    }

    settings = parsed as InlangSettings;
    return settings;
  }

  /**
   * The absolute message file pattern, `{locale}` still in it.
   *
   * `pathPattern` is resolved against the directory that *holds* the project
   * folder, which is what makes the conventional `./messages/{locale}.json` land
   * next to `project.inlang/` rather than inside it.
   */
  function messagePattern(): string {
    const plugin = readSettings()[MESSAGE_FORMAT_PLUGIN];
    const raw = isRecord(plugin) ? plugin.pathPattern : undefined;
    const pattern = firstString(raw) ?? DEFAULT_PATH_PATTERN;
    return resolve(dirname(projectDirectory), pattern);
  }

  function messagePath(locale: string): string {
    return messagePattern().replace(LOCALE_PLACEHOLDER, locale);
  }

  /** The source locale first, then every other locale the project declares. */
  function readLocales(): { source: string; all: string[] } {
    const parsed = readSettings();
    const source = firstString(parsed.baseLocale ?? parsed.sourceLanguageTag) ?? "en";
    const declared = toStringArray(parsed.locales ?? parsed.languageTags);
    const all = [source];
    for (const locale of declared) {
      if (!all.includes(locale)) all.push(locale);
    }
    return { source, all };
  }

  /**
   * Which message keys `load()` handed out, per locale.
   *
   * `save` needs it to tell "this key was deliberately removed" from "this key
   * was never mine": the first is deleted, the second survives untouched.
   */
  const surfaced = new Map<string, Set<string>>();

  return {
    name: "paraglide",

    locales: readLocales,

    load(): Catalog {
      const catalog: Catalog = {};
      for (const locale of readLocales().all) {
        const messages: Record<string, string> = {};
        const keys = new Set<string>();
        for (const [key, value] of Object.entries(readJsonObject(messagePath(locale)))) {
          if (typeof value !== "string" || isMetaKey(key)) continue;
          messages[key] = value;
          keys.add(key);
        }
        catalog[locale] = messages;
        surfaced.set(locale, keys);
      }
      return catalog;
    },

    /**
     * Write every locale in `catalog`, preserving what is not in it.
     *
     * The file is re-read and merged, so `$schema`, variant objects and any
     * message this adapter could not represent as a flat string come through
     * untouched — a hand-written catalog is never destroyed by a propsmith run.
     * The one thing that *is* removed is a key `load()` surfaced and this call
     * did not get back: that is an orphan the core decided to drop, and merging
     * it back in would resurrect it on every run.
     *
     * A locale absent from `catalog` is not touched at all.
     */
    save(catalog: Catalog): void {
      for (const [locale, messages] of Object.entries(catalog)) {
        if (!isRecord(messages)) continue;

        const file = messagePath(locale);
        const next: Record<string, unknown> = readJsonObject(file);

        const previous = surfaced.get(locale);
        if (previous !== undefined) {
          for (const key of previous) {
            if (!(key in messages)) delete next[key];
          }
        }

        for (const [key, value] of Object.entries(messages)) {
          if (typeof value === "string") next[key] = value;
        }

        writeJsonObject(file, next);
      }
    },

    expression,

    validateKey(key: string): string | null {
      if (IDENTIFIER.test(key)) return null;
      return (
        `paraglide compiles every message into a function, so \`${key}\` would have to ` +
        `be callable as \`m.${key}()\`. A key must be a JavaScript identifier: a letter, ` +
        "`_` or `$` first, then letters, digits, `_` or `$`."
      );
    },

    key: options?.key ?? defaultKey,

    stalePath: resolve(root, options?.stalePath ?? DEFAULT_STALE_PATH),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A non-empty string, or the first one in an array. Anything else: `undefined`. */
function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  if (!Array.isArray(value)) return undefined;
  return (value as unknown[]).find(
    (entry): entry is string => typeof entry === "string" && entry !== "",
  );
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter(
    (entry): entry is string => typeof entry === "string" && entry !== "",
  );
}

/** The parsed object at `file`, or `{}` when it is missing or not an object. */
function readJsonObject(file: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = parseJson(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Two-space JSON, keys sorted, one trailing newline.
 *
 * An unchanged file is not rewritten, so a run that resolves to no change leaves
 * the mtimes — and `git status` — exactly as it found them. An empty object is
 * not written at all unless the file already exists: a locale with no messages
 * yet does not need an empty file created for it.
 */
function writeJsonObject(file: string, value: Record<string, unknown>): void {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) sorted[key] = value[key];

  const text = `${JSON.stringify(sorted, null, 2)}\n`;
  let existing: string | null = null;
  try {
    existing = readFileSync(file, "utf8");
  } catch {
    if (Object.keys(sorted).length === 0) return;
  }
  if (existing === text) return;

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
}
