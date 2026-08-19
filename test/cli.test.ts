/**
 * The CLI surface, exercised through `main(argv)`.
 *
 * These exist because of a bug that unit tests could never have caught: the
 * shared flags were declared on both the root command and on `check`, and
 * commander's default parsing gave everything after the subcommand name to the
 * root. `propsmith check --strict` silently did nothing. Any test that called
 * `run()` directly passed happily throughout.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli/index.js";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

const CONFIG = `export default {
  sources: ["*.types.ts"],
  outputs: [{ name: "docs", files: ["docs.md"] }],
  types: { inlineUnder: 60, glossary: "/types" },
};
`;

let cwd = "";
let origin = "";
let out = "";

beforeEach(() => {
  origin = process.cwd();
  cwd = mkdtempSync(join(tmpdir(), "propsmith-cli-"));
  cpSync(join(FIXTURES, "vanilla"), cwd, { recursive: true });
  writeFileSync(join(cwd, "propsmith.config.mjs"), CONFIG, "utf8");
  process.chdir(cwd);

  out = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(origin);
  rmSync(cwd, { recursive: true, force: true });
  process.exitCode = undefined;
});

async function cli(...args: string[]): Promise<number> {
  return await main(["node", "propsmith", ...args]);
}

describe("exit codes", () => {
  it("reports drift and exits 1, then writes and exits 0", async () => {
    expect(await cli("check")).toBe(1);
    expect(out).toContain("does not match the type");

    out = "";
    expect(await cli()).toBe(0);
    expect(readFileSync(join(cwd, "docs.md"), "utf8")).toContain("| Name");

    out = "";
    expect(await cli("check")).toBe(0);
  });

  it("exits 2 when no config can be found", async () => {
    rmSync(join(cwd, "propsmith.config.mjs"));
    expect(await cli("check")).toBe(2);
    expect(out).toContain("no config found");
  });

  it("exits 2 when --config points at nothing", async () => {
    expect(await cli("check", "--config", "missing.mjs")).toBe(2);
  });
});

describe("flags reach the subcommand", () => {
  it("--strict promotes warnings to a failure, plain check does not", async () => {
    await cli();
    out = "";

    expect(await cli("check")).toBe(0);
    expect(out).toContain("warnings");

    out = "";
    expect(await cli("check", "--strict")).toBe(1);
  });

  it("--only with an unknown name says so instead of failing obscurely", async () => {
    expect(await cli("check", "--only", "nope")).toBe(1);
    expect(out).toContain("--only nope matches nothing");
    expect(out).toContain("Known: docs");
    // The wrong answer would be a wall of "documented nowhere" errors.
    expect(out).not.toContain("has no marker in any output");
  });

  it("--component with an unknown name says so", async () => {
    expect(await cli("check", "--component", "Nope")).toBe(1);
    expect(out).toContain("--component Nope matches nothing");
  });

  it("--json prints the IR", async () => {
    expect(await cli("check", "--json")).toBe(1);
    const parsed: unknown = JSON.parse(out);
    expect(parsed).toMatchObject({ components: [{ name: "HttpClient" }] });
  });
});

describe("diagnosability of a misconfigured output", () => {
  it("names the glob that matched nothing instead of blaming the tag", async () => {
    // The failure this guards against: the marker is written correctly, but the
    // output glob never looks at the file that holds it. Without this warning
    // the only message is "add a marker to a documentation file" — pointing at
    // work already done, in a file the run never opened.
    writeFileSync(
      join(cwd, "propsmith.config.mjs"),
      CONFIG.replace('files: ["docs.md"]', 'files: ["docs/**/*.md"]'),
      "utf8",
    );

    expect(await cli("check")).toBe(1);
    expect(out).toContain('output "docs" matched no files');
    expect(out).toContain("docs/**/*.md");
    expect(out).toContain("has no marker in any output");
  });
});

describe("files written by Windows tools", () => {
  it("reads a package.json config that carries a byte order mark", async () => {
    rmSync(join(cwd, "propsmith.config.mjs"));
    const pkg = {
      name: "fixture",
      propsmith: {
        sources: ["*.types.ts"],
        outputs: [{ name: "docs", files: ["docs.md"] }],
      },
    };
    writeFileSync(join(cwd, "package.json"), `﻿${JSON.stringify(pkg, null, 2)}\n`, "utf8");

    // A BOM is not part of the document, and `JSON.parse` rejects it with a
    // message naming neither the file nor the cause.
    expect(await cli("check")).toBe(1);
    expect(out).toContain("does not match the type");
    expect(out).not.toContain("not valid JSON");
  });
});

describe("dry run", () => {
  it("prints the table and writes nothing", async () => {
    const before = readFileSync(join(cwd, "docs.md"), "utf8");

    expect(await cli("--dry-run")).toBe(0);
    expect(out).toContain("| Name");
    expect(out).toContain("`baseUrl`");
    expect(readFileSync(join(cwd, "docs.md"), "utf8")).toBe(before);
  });

  it("honours --component", async () => {
    expect(await cli("--dry-run", "--component", "HttpClient")).toBe(0);
    expect(out).toContain("HttpClient");
  });
});

describe("init", () => {
  it("scaffolds a config and refuses to overwrite one", async () => {
    rmSync(join(cwd, "propsmith.config.mjs"));

    expect(await cli("init")).toBe(0);
    const written = readFileSync(join(cwd, "propsmith.config.ts"), "utf8");
    expect(written).toContain("defineConfig");
    expect(written).toContain("sources:");

    out = "";
    expect(await cli("init")).toBe(2);
    expect(out).toContain("already exists");
  });
});
