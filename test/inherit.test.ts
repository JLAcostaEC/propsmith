/**
 * Descriptions borrowed from a shared type, and the catalog keys that follow
 * from them.
 *
 * The fixture is staged into a temp directory because these run end to end:
 * the type a prop inherits from lives in another file, so nothing short of a
 * whole run — with the second index pass — proves it is found.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { resolveConfig } from "../src/config.js";
import { typeNameOf } from "../src/resolve/inherit.js";
import { run } from "../src/run.js";
import type { Catalog, I18nAdapter, PropsmithConfig, RunResult } from "../src/types.js";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function stage(): string {
  const dir = mkdtempSync(join(tmpdir(), "propsmith-inherit-"));
  temps.push(dir);
  cpSync(join(FIXTURES, "inherit"), dir, { recursive: true });
  return dir;
}

function baseConfig(): PropsmithConfig {
  return {
    sources: ["*.ts"],
    outputs: [{ name: "docs", files: ["docs.md"] }],
    types: { inlineUnder: 60 },
    lockfile: "propsmith.lock.json",
  };
}

async function execute(cwd: string, config: PropsmithConfig): Promise<RunResult> {
  const { resolved, diagnostics } = resolveConfig(config, cwd);
  expect(diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  return await run({ mode: "write", config: resolved });
}

/** The generated row for one prop, with the column padding collapsed. */
function rowFor(cwd: string, prop: string): string {
  const markdown = readFileSync(join(cwd, "docs.md"), "utf8");
  const line = markdown.split("\n").find((text) => text.includes(`\`${prop}\``));
  return (line ?? "").replace(/[ \t]+/g, " ").trim();
}

function messages(result: RunResult, code: string): string[] {
  return result.diagnostics.filter((entry) => entry.code === code).map((entry) => entry.message);
}

// ---------------------------------------------------------------------------

describe("the type a member inherits from", () => {
  it("reads a bare name, a generic and a nullable one", () => {
    expect(typeNameOf("Variant")).toBe("Variant");
    expect(typeNameOf("Options<T>")).toBe("Options");
    expect(typeNameOf("Variant | null")).toBe("Variant");
    expect(typeNameOf(" Variant  |  undefined ")).toBe("Variant");
  });

  it("refuses anything that is not one name", () => {
    expect(typeNameOf("'a' | 'b'")).toBeUndefined();
    expect(typeNameOf("(value: string) => void")).toBeUndefined();
    expect(typeNameOf("Variant[]")).toBeUndefined();
    expect(typeNameOf("{ id: string }")).toBeUndefined();
    // Splitting a union cuts this generic in half; the halves are not names.
    expect(typeNameOf("Omit<X, 'a' | 'b'>")).toBeUndefined();
  });
});

describe("inheriting a description", () => {
  it("takes the description and the default of the type the prop is declared with", async () => {
    const cwd = stage();
    await execute(cwd, baseConfig());

    expect(rowFor(cwd, "variant")).toContain("The visual style of a control.");
    expect(rowFor(cwd, "variant")).toContain('`"primary"`');
  });

  it("looks through a nullable union", async () => {
    const cwd = stage();
    await execute(cwd, baseConfig());

    expect(rowFor(cwd, "spacing")).toContain("How much space a control takes.");
  });

  it("never overwrites the prop's own sentence", async () => {
    const cwd = stage();
    await execute(cwd, baseConfig());

    expect(rowFor(cwd, "tone")).toContain("Its own sentence wins.");
    // The default is still borrowed: it is missing, not overridden.
    expect(rowFor(cwd, "tone")).toContain('`"primary"`');
  });

  it("records where the text came from, so `--json` shows it", async () => {
    const cwd = stage();
    const result = await execute(cwd, baseConfig());

    const members = result.components[0]!.members;
    const variant = members.find((member) => member.name === "variant");
    const label = members.find((member) => member.name === "label");

    expect(variant?.inheritedFrom).toBe("Variant");
    expect(label?.inheritedFrom).toBeUndefined();
  });

  it("honours `@inheritDoc <Name>` on a prop whose own type says nothing", async () => {
    const cwd = stage();
    await execute(cwd, baseConfig());

    expect(rowFor(cwd, "fallback")).toContain("The visual style of a control.");
  });

  it("reports an `@inheritDoc` that names nothing", async () => {
    const cwd = stage();
    const result = await execute(cwd, baseConfig());

    expect(messages(result, "missing-description").join("\n")).toContain(
      "@inheritDoc found no exported type named `Nowhere`",
    );
  });

  it("warns when neither the prop nor its type has a description", async () => {
    const cwd = stage();
    const result = await execute(cwd, baseConfig());
    const warnings = messages(result, "missing-description");

    expect(warnings).toContain("ButtonProps.mystery has no description");
    expect(warnings.join("\n")).toContain(
      "ButtonProps.shrug has no description, and neither does `Undocumented`",
    );
    expect(warnings.join("\n")).not.toContain("ButtonProps.variant has no description");
  });

  it("stops inheriting when `types.inherit` is false, but keeps the tag working", async () => {
    const cwd = stage();
    const config = baseConfig();
    config.types = { inlineUnder: 60, inherit: false };
    const result = await execute(cwd, config);

    expect(rowFor(cwd, "variant")).not.toContain("The visual style of a control.");
    expect(messages(result, "missing-description")).toContain(
      "ButtonProps.variant has no description",
    );
    expect(rowFor(cwd, "fallback")).toContain("The visual style of a control.");
  });
});

// ---------------------------------------------------------------------------

/** Captures what propsmith would write, so no i18n tool has to be installed. */
function fakeI18n(saved: { catalog: Catalog }): I18nAdapter {
  return {
    name: "fake",
    locales: () => ({ source: "en", all: ["en", "es"] }),
    load: () => ({ en: {}, es: {} }),
    save: (catalog) => {
      saved.catalog = catalog;
    },
    expression: (key) => `{m.${key}()}`,
    validateKey: (key) => (/^[a-zA-Z_$][\w$]*$/.test(key) ? null : "not an identifier"),
  };
}

describe("the catalog these produce", () => {
  async function withCatalog(): Promise<{ cwd: string; catalog: Catalog }> {
    const cwd = stage();
    const saved = { catalog: {} as Catalog };
    const config = baseConfig();
    config.i18n = fakeI18n(saved);
    config.outputs = [{ name: "docs", files: ["docs.md"], description: "i18n" }];
    await execute(cwd, config);
    return { cwd, catalog: saved.catalog };
  }

  it("gives an inherited description one key for every prop that shares it", async () => {
    const { catalog } = await withCatalog();

    expect(catalog.en!.global_types_variant).toBe("The visual style of a control.");
    expect(catalog.en!.global_types_density).toBe("How much space a control takes.");
    expect(catalog.en!.button_props_variant).toBeUndefined();
  });

  it("sends the @deprecated reason and its label to the catalog too", async () => {
    const { catalog } = await withCatalog();

    expect(catalog.en!.button_props_appearance_deprecated).toBe("Use `variant` instead.");
    expect(catalog.en!.propsmith_deprecated).toBe("Deprecated");
  });

  it("writes both expressions into the cell", async () => {
    const { cwd } = await withCatalog();

    expect(rowFor(cwd, "appearance")).toContain(
      "**{m.propsmith_deprecated()}:** {m.button_props_appearance_deprecated()}",
    );
    expect(rowFor(cwd, "variant")).toContain("{m.global_types_variant()}");
  });

  it("leaves an undocumented prop's cell empty rather than calling a message that has none", async () => {
    const { cwd, catalog } = await withCatalog();

    // An empty message is never written, so a cell referring to one would call
    // a function the i18n compiler never generates.
    expect(catalog.en!.button_props_mystery).toBeUndefined();
    expect(rowFor(cwd, "mystery")).not.toContain("{m.");
  });

  it("keeps English in an output that asked for text", async () => {
    const cwd = stage();
    const saved = { catalog: {} as Catalog };
    const config = baseConfig();
    config.i18n = fakeI18n(saved);
    await execute(cwd, config);

    expect(rowFor(cwd, "appearance")).toContain("**Deprecated:** Use `variant` instead.");
  });
});
