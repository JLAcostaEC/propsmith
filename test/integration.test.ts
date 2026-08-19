/**
 * The three cases end to end: plain TypeScript, Svelte, React.
 *
 * Each fixture is copied into a temp directory first, because `write` is the
 * only mode that touches disk and the assertions that matter are about what it
 * put there — including running it twice and getting identical bytes.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { reactAdapter, svelteAdapter } from "../src/adapters/index.js";
import { resolveConfig } from "../src/config.js";
import { assertNoHtml } from "../src/render/escape.js";
import { run } from "../src/run.js";
import type { PropsmithConfig, RunMode, RunResult } from "../src/types.js";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function stage(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), `propsmith-${fixture}-`));
  temps.push(dir);
  cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  return dir;
}

async function execute(cwd: string, config: PropsmithConfig, mode: RunMode): Promise<RunResult> {
  const { resolved, diagnostics } = resolveConfig(config, cwd);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return await run({ mode, config: resolved });
}

function errorsOf(result: RunResult): string[] {
  return result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
}

/**
 * Assert on content, not on padding.
 *
 * Tables are emitted aligned so a consumer's formatter has nothing to change,
 * which means every cell carries trailing spaces. Collapsing whitespace on both
 * sides keeps these assertions about what the table says.
 */
function squash(text: string): string {
  return text.replace(/[ \t]+/g, " ");
}

function bodyOf(result: RunResult, region: string): string {
  return squash(result.changes.find((c) => c.region === region)?.body ?? "");
}

// ---------------------------------------------------------------------------

const vanillaConfig = (): PropsmithConfig => ({
  sources: ["*.types.ts"],
  outputs: [{ name: "docs", files: ["docs.md"] }],
  types: { inlineUnder: 60, glossary: "/types" },
  lockfile: "propsmith.lock.json",
});

const svelteConfig = (): PropsmithConfig => ({
  sources: ["*.svelte", "types.ts"],
  adapters: [svelteAdapter()],
  outputs: [{ name: "site", files: ["docs.svx"] }],
  types: { inlineUnder: 60, glossary: "/types" },
});

const reactConfig = (): PropsmithConfig => ({
  sources: ["*.tsx"],
  adapters: [reactAdapter()],
  outputs: [{ name: "docs", files: ["docs.md"] }],
  types: { inlineUnder: 60 },
});

describe("vanilla TypeScript, no framework", () => {
  const config = vanillaConfig;

  it("renders every documented member and nothing else", async () => {
    const cwd = stage("vanilla");
    const result = await execute(cwd, config(), "dry-run");

    expect(errorsOf(result)).toEqual([]);

    const table = bodyOf(result, "HttpClient");

    expect(table).toContain("`baseUrl`");
    // A local union short enough to inline arrives as its values, not its name.
    expect(table).toContain('`"never"` &#124; `"always"` &#124; `"on-5xx"`');
    expect(table).toContain("`30000`");
    // Only the first paragraph reaches the cell.
    expect(table).toContain("How the client reacts to a failed request.");
    expect(table).not.toContain("second paragraph");
    // `@internal` removes the member entirely.
    expect(table).not.toContain("__pool");
    // `@deprecated` strikes the name and states the reason inline, never a <br>.
    expect(table).toContain("~~`headers`~~");
    expect(table).toContain("**Deprecated:**");
    // `@see` wins over resolution for that member.
    expect(table).toContain("https://day.js.org/docs/en/parse/parse");
  });

  it("routes a type too long to inline into the glossary region", async () => {
    const cwd = stage("vanilla");
    const result = await execute(cwd, config(), "dry-run");

    const table = bodyOf(result, "HttpClient");
    const glossary = bodyOf(result, "@types");

    expect(table).toContain("/types#backoffpolicy");
    expect(glossary).toContain("BackoffPolicy");
    expect(glossary).toContain("initialDelayMs");
  });

  it("warns about an unresolvable type with no link", async () => {
    const cwd = stage("vanilla");
    const result = await execute(cwd, config(), "dry-run");

    const unresolved = result.diagnostics.filter((d) => d.code === "unresolved-type");
    expect(unresolved.map((d) => d.message).join(" ")).toContain("Dayjs");
  });

  it("writes, is idempotent, and then reports no drift", async () => {
    const cwd = stage("vanilla");
    const docs = join(cwd, "docs.md");
    const before = readFileSync(docs, "utf8");

    await execute(cwd, config(), "write");
    const first = readFileSync(docs, "utf8");
    expect(first).not.toEqual(before);
    expect(squash(first)).toContain("| Name | Type | Default | Description |");

    await execute(cwd, config(), "write");
    expect(readFileSync(docs, "utf8")).toEqual(first);

    const checked = await execute(cwd, config(), "check");
    expect(checked.diagnostics.filter((d) => d.code === "table-drift")).toEqual([]);
  });

  it("ignores a marker inside a fenced code block", async () => {
    const cwd = stage("vanilla");
    await execute(cwd, config(), "write");
    const written = readFileSync(join(cwd, "docs.md"), "utf8");

    // The fenced pair is still an empty, untouched pair.
    expect(written).toContain("<!-- props:SomethingElse -->\n<!-- /props:SomethingElse -->");
  });
});

// ---------------------------------------------------------------------------

describe("Svelte", () => {
  const config = svelteConfig;

  it("reads the props type out of the module script", async () => {
    const cwd = stage("svelte");
    const result = await execute(cwd, config(), "dry-run");

    expect(errorsOf(result)).toEqual([]);

    const table = bodyOf(result, "Button");
    expect(table).toContain("`size`");
    // `Sizes` lives in types.ts, which carries no tag at all — the on-demand
    // second pass is what makes it resolvable.
    expect(table).toContain('`"small"` &#124; `"medium"` &#124; `"large"`');
    expect(table).toContain("`false`");
    expect(table).not.toContain("__group");
  });

  it("renders @bindable as a badge, not an HTML tag", async () => {
    const cwd = stage("svelte");
    const result = await execute(cwd, config(), "dry-run");
    const table = bodyOf(result, "Button");

    expect(table).toContain("_bindable_");
    expect(table).not.toContain("<sup>");
  });

  it("summarises the intersection with svelte/elements as one row", async () => {
    const cwd = stage("svelte");
    const result = await execute(cwd, config(), "dry-run");
    const table = bodyOf(result, "Button");

    expect(table).toContain("Element Attributes");
  });

  it("writes and stays byte-identical on a second run", async () => {
    const cwd = stage("svelte");
    await execute(cwd, config(), "write");
    const first = readFileSync(join(cwd, "docs.svx"), "utf8");
    await execute(cwd, config(), "write");
    expect(readFileSync(join(cwd, "docs.svx"), "utf8")).toEqual(first);
  });
});

// ---------------------------------------------------------------------------

describe("React", () => {
  const config = reactConfig;

  it("parses TSX and keeps generics verbatim", async () => {
    const cwd = stage("react");
    const result = await execute(cwd, config(), "dry-run");

    // The fixture's lone `<!-- props:List -->` is an unpaired marker on purpose.
    // `dry-run` reports what `write` would do, and `write` completes it, so this
    // run has nothing to report at all.
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const list = bodyOf(result, "List");
    expect(list).toContain("`items`");
    expect(list).toContain("`T[]`");
    expect(list).toContain("`0`");
  });

  it("expands a Pick intersection into its literal keys, inside code spans", async () => {
    const cwd = stage("react");
    const result = await execute(cwd, config(), "dry-run");
    const card = bodyOf(result, "Card");

    expect(card).toContain("`className`");
    expect(card).toContain("`id`");
    // The origin carries a generic. Inside a code span that is literal text;
    // bare, it would open an HTML tag, which is what assertNoHtml rejects.
    expect(card).toContain("`HTMLAttributes<HTMLDivElement>`");
    expect(() => assertNoHtml(card, "Card")).not.toThrow();
  });

  it("completes a lone opening marker on write, and flags it on check", async () => {
    const cwd = stage("react");

    const checked = await execute(cwd, config(), "check");
    expect(checked.diagnostics.some((d) => d.code === "unpaired-marker")).toBe(true);

    await execute(cwd, config(), "write");
    const written = readFileSync(join(cwd, "docs.md"), "utf8");
    expect(written).toContain("<!-- /props:List -->");

    const again = await execute(cwd, config(), "check");
    expect(again.diagnostics.filter((d) => d.code === "table-drift")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("the lockfile is committable", () => {
  it("records paths relative to the project, with forward slashes", async () => {
    const cwd = stage("vanilla");
    const catalog: Record<string, Record<string, string>> = { en: {}, es: {} };

    await execute(
      cwd,
      {
        ...vanillaConfig(),
        outputs: [{ name: "docs", files: ["docs.md"], description: "i18n" }],
        i18n: {
          name: "fake",
          locales: () => ({ source: "en", all: ["en", "es"] }),
          load: () => structuredClone(catalog),
          save: () => undefined,
          expression: (key) => `{m.${key}()}`,
          validateKey: () => null,
        },
      },
      "write",
    );

    const lock: unknown = JSON.parse(readFileSync(join(cwd, "propsmith.lock.json"), "utf8"));
    const sources = Object.values((lock as { keys: Record<string, { source: string }> }).keys).map(
      (entry) => entry.source,
    );

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      // An absolute path here differs on every checkout and every CI runner,
      // and a backslash differs between Windows and everywhere else. Either
      // turns a tracked file into a permanent merge conflict.
      expect(source).not.toContain("\\");
      expect(source).not.toMatch(/^([A-Za-z]:|\/)/);
      // A label's English is propsmith's own wording and has no member behind it.
      if (source === "propsmith#labels") continue;
      expect(source).toMatch(/^options\.types\.ts#HttpClientOptions\./);
    }
  });
});

describe("drift detection survives a formatter", () => {
  it("does not treat realigned table padding as a change", async () => {
    const cwd = stage("vanilla");
    const config: PropsmithConfig = {
      sources: ["*.types.ts"],
      outputs: [{ name: "docs", files: ["docs.md"] }],
      types: { inlineUnder: 60, glossary: "/types" },
    };

    await execute(cwd, config, "write");
    const docs = join(cwd, "docs.md");

    // Squeeze every cell, the way a formatter with different settings would.
    const squeezed = readFileSync(docs, "utf8")
      .split("\n")
      .map((line) =>
        line.trim().startsWith("|")
          ? `|${line
              .trim()
              .slice(1, -1)
              .split("|")
              .map((cell) => cell.trim())
              .join("|")}|`
          : line,
      )
      .join("\n");
    writeFileSync(docs, squeezed, "utf8");

    const checked = await execute(cwd, config, "check");
    expect(checked.diagnostics.filter((d) => d.code === "table-drift")).toEqual([]);
  });

  it("completes a lone opening marker without failing the run", async () => {
    const cwd = stage("vanilla");
    const docs = join(cwd, "docs.md");
    writeFileSync(docs, "# HttpClient\n\n<!-- props:HttpClient -->\n", "utf8");

    const config: PropsmithConfig = {
      sources: ["*.types.ts"],
      outputs: [{ name: "docs", files: ["docs.md"] }],
      types: { inlineUnder: 60, links: { Dayjs: "https://day.js.org" } },
    };

    // `write` repairs it, so reporting it would fail the run over something the
    // same run just fixed.
    const written = await execute(cwd, config, "write");
    expect(written.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(readFileSync(docs, "utf8")).toContain("<!-- /props:HttpClient -->");

    // `check` fixes nothing, so there it stays an error.
    const again = await execute(cwd, config, "check");
    expect(again.diagnostics.filter((d) => d.code === "unpaired-marker")).toEqual([]);

    writeFileSync(docs, "# HttpClient\n\n<!-- props:HttpClient -->\n", "utf8");
    const checked = await execute(cwd, config, "check");
    expect(checked.diagnostics.map((d) => d.code)).toContain("unpaired-marker");
  });

  it("names the props that drifted, so the report is actionable", async () => {
    const cwd = stage("vanilla");
    const config: PropsmithConfig = {
      sources: ["*.types.ts"],
      outputs: [{ name: "docs", files: ["docs.md"] }],
      types: { inlineUnder: 60, glossary: "/types" },
    };

    await execute(cwd, config, "write");
    const docs = join(cwd, "docs.md");

    // Delete one row, and rename another prop's row to one that no longer exists.
    const edited = readFileSync(docs, "utf8")
      .split("\n")
      .filter((line) => !line.includes("`baseUrl`"))
      .map((line) => line.replace("`retry`", "`retries`"))
      .join("\n");
    writeFileSync(docs, edited, "utf8");

    const checked = await execute(cwd, config, "check");
    const drift = checked.diagnostics.find((d) => d.code === "table-drift");

    expect(drift?.message).toContain("2 props with no row: baseUrl, retry");
    expect(drift?.message).toContain("1 row with no prop: retries");
  });
});
