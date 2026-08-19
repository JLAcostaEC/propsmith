/**
 * The four-way truth table, which is the whole reason the lockfile
 * exists. A fake adapter keeps this off disk — the algorithm is core, and no
 * paraglide project should be needed to test it.
 */

import { describe, expect, it } from "vitest";

import { defaultKey, snake } from "../src/i18n/key.js";
import { hashText } from "../src/i18n/lockfile.js";
import { syncCatalog } from "../src/i18n/sync.js";
import type { Catalog, I18nAdapter, Lockfile } from "../src/types.js";

function fakeAdapter(catalog: Catalog): I18nAdapter {
  return {
    name: "fake",
    locales: () => ({ source: "en", all: ["en", "es"] }),
    load: () => structuredClone(catalog),
    save: () => undefined,
    expression: (key) => `{m.${key}()}`,
    validateKey: (key) => (/^[a-zA-Z_$][\w$]*$/.test(key) ? null : "not an identifier"),
    stalePath: "./messages/{locale}.stale.json",
  };
}

const KEY = "button_props_size";
const OLD = "The size.";
const NEW = "How big the button is.";

function lockWith(en: string, es: string): Lockfile {
  return {
    version: 1,
    keys: { [KEY]: { source: "a.ts#B.size", en: hashText(en), locales: { es: hashText(es) } } },
  };
}

describe("key naming", () => {
  it("snakes every shape a component name comes in", () => {
    expect(snake("AutoSuggestBox")).toBe("auto_suggest_box");
    expect(snake("shared/Button")).toBe("shared_button");
    expect(snake("kebab-case-name")).toBe("kebab_case_name");
    expect(snake("maxItemsInView")).toBe("max_items_in_view");
  });

  it("keeps a leading digit from producing an illegal function name", () => {
    expect(snake("2Fast")).toMatch(/^_/);
  });

  it("builds the default key", () => {
    expect(
      defaultKey({ component: "AutoSuggestBox", prop: "maxItemsInView", kind: "description" }),
    ).toBe("auto_suggest_box_props_max_items_in_view");
  });

  it("gives every kind of text its own key", () => {
    const at = { component: "Button", prop: "appearance" };

    expect(defaultKey({ ...at, kind: "deprecated" })).toBe("button_props_appearance_deprecated");
    expect(defaultKey({ component: "", prop: "", kind: "type", type: "Variant" })).toBe(
      "global_types_variant",
    );
    expect(defaultKey({ component: "propsmith", prop: "deprecated", kind: "label" })).toBe(
      "propsmith_deprecated",
    );
  });
});

describe("the truth table", () => {
  const entries = { [KEY]: { english: OLD, source: "a.ts#B.size" } };

  it("row 1 — nothing changed, nothing happens", () => {
    const result = syncCatalog({
      adapter: fakeAdapter({ en: { [KEY]: OLD }, es: { [KEY]: "El tamaño." } }),
      lock: lockWith(OLD, OLD),
      entries,
    });

    expect(result.catalog.es?.[KEY]).toBe("El tamaño.");
    expect(result.stale.es ?? {}).toEqual({});
    expect(result.diagnostics.filter((d) => d.code === "catalog-stale")).toEqual([]);
  });

  it("row 2 — the JSDoc changed: English is rewritten, Spanish is parked", () => {
    const result = syncCatalog({
      adapter: fakeAdapter({ en: { [KEY]: OLD }, es: { [KEY]: "El tamaño." } }),
      lock: lockWith(OLD, OLD),
      entries: { [KEY]: { english: NEW, source: "a.ts#B.size" } },
    });

    expect(result.catalog.en?.[KEY]).toBe(NEW);
    expect(result.catalog.es?.[KEY]).toBeUndefined();
    expect(result.stale.es?.[KEY]).toBe("El tamaño.");
    expect(result.diagnostics.map((d) => d.code)).toContain("catalog-stale");
  });

  it("row 3 — en.json was hand-edited: warn, restore, leave translations alone", () => {
    const result = syncCatalog({
      adapter: fakeAdapter({
        en: { [KEY]: "Somebody fixed a typo here." },
        es: { [KEY]: "El tamaño." },
      }),
      lock: lockWith(OLD, OLD),
      entries,
    });

    expect(result.diagnostics.map((d) => d.code)).toContain("catalog-hand-edited");
    expect(result.catalog.en?.[KEY]).toBe(OLD);
    // The whole point: a valid translation is not destroyed over a typo fix.
    expect(result.catalog.es?.[KEY]).toBe("El tamaño.");
    expect(result.stale.es ?? {}).toEqual({});
  });

  it("row 4 — both changed: report the conflict, do not guess", () => {
    const result = syncCatalog({
      adapter: fakeAdapter({ en: { [KEY]: "Edited by hand." }, es: { [KEY]: "El tamaño." } }),
      lock: lockWith(OLD, OLD),
      entries: { [KEY]: { english: NEW, source: "a.ts#B.size" } },
    });

    expect(result.diagnostics.map((d) => d.code)).toContain("catalog-conflict");
    expect(result.catalog.en?.[KEY]).toBe(NEW);
  });
});

describe("catalog housekeeping", () => {
  it("adds a brand-new key and records it", () => {
    const result = syncCatalog({
      adapter: fakeAdapter({ en: {}, es: {} }),
      lock: { version: 1, keys: {} },
      entries: { [KEY]: { english: OLD, source: "a.ts#B.size" } },
    });

    expect(result.catalog.en?.[KEY]).toBe(OLD);
    expect(result.changes.some((change) => change.added.includes(KEY))).toBe(true);
    expect(result.lock.keys[KEY]?.en).toBe(hashText(OLD));
  });

  it("reports a locale missing a key rather than inventing one", () => {
    const result = syncCatalog({
      adapter: fakeAdapter({ en: { [KEY]: OLD }, es: {} }),
      lock: lockWith(OLD, OLD),
      entries: { [KEY]: { english: OLD, source: "a.ts#B.size" } },
    });

    expect(result.diagnostics.map((d) => d.code)).toContain("catalog-missing-key");
    expect(result.catalog.es?.[KEY]).toBeUndefined();
  });

  it("rejects a key the adapter cannot compile", () => {
    const result = syncCatalog({
      adapter: fakeAdapter({ en: {}, es: {} }),
      lock: { version: 1, keys: {} },
      entries: { "not-an-identifier": { english: OLD, source: "a.ts#B.size" } },
    });

    const invalid = result.diagnostics.filter((d) => d.code === "invalid-key");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.severity).toBe("error");
  });

  it("does not invalidate a translation over a pure whitespace reflow", () => {
    const result = syncCatalog({
      adapter: fakeAdapter({ en: { [KEY]: OLD }, es: { [KEY]: "El tamaño." } }),
      lock: lockWith(OLD, OLD),
      entries: { [KEY]: { english: `  The\n  size.  `, source: "a.ts#B.size" } },
    });

    expect(result.catalog.es?.[KEY]).toBe("El tamaño.");
  });
});
