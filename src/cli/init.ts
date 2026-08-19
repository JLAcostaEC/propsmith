/**
 * Scaffold a config from what the project already looks like.
 *
 * The difference between "I installed this and it works" and "I installed this
 * and now I read the manual" is one command, so it detects rather than asks.
 */

import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { glob } from "tinyglobby";

import { parseJson } from "../json.js";

const CONFIG_NAME = "propsmith.config.ts";

/** Wide enough to notice, narrow enough not to walk a monorepo's build output. */
const SCAN_IGNORE = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.svelte-kit/**"];

export interface InitResult {
  written: string | null;
  lines: string[];
}

export async function init(cwd: string): Promise<InitResult> {
  const lines: string[] = [];
  const target = join(cwd, CONFIG_NAME);

  if (existsSync(target)) {
    return {
      written: null,
      lines: [`${CONFIG_NAME} already exists — delete it first, or edit it by hand`],
    };
  }

  const framework = detectFramework(cwd);
  if (framework === "svelte") lines.push("detected Svelte (svelte.config)");
  else if (framework === "react") lines.push("detected React (package.json dependencies)");
  else lines.push("no framework detected — using the plain TypeScript adapter");

  const paraglide = detectParaglide(cwd);
  if (paraglide !== null) {
    lines.push(
      `detected paraglide (${paraglide.project} — locales: ${paraglide.locales.join(", ")})`,
    );
  }

  const sourceDirs = await findDirs(
    cwd,
    ["**/*.{ts,tsx,svelte}"],
    "@propsmith",
    lines,
    "tagged type",
  );
  const targetDirs = await findDirs(cwd, ["**/*.{md,mdx,svx}"], "<!-- props:", lines, "marker");

  const contents = template({ framework, paraglide: paraglide !== null, sourceDirs, targetDirs });
  await writeFile(target, contents, "utf8");
  lines.push(`wrote ${CONFIG_NAME}`);

  return { written: target, lines };
}

// ---------------------------------------------------------------------------

function detectFramework(cwd: string): "svelte" | "react" | null {
  if (existsSync(join(cwd, "svelte.config.js")) || existsSync(join(cwd, "svelte.config.ts"))) {
    return "svelte";
  }

  const pkg = readJson(join(cwd, "package.json"));
  if (pkg === null) return null;
  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
    ...(pkg.peerDependencies as Record<string, string> | undefined),
  };
  if ("svelte" in deps) return "svelte";
  if ("react" in deps) return "react";
  return null;
}

function detectParaglide(cwd: string): { project: string; locales: string[] } | null {
  const project = join(cwd, "project.inlang");
  const settings = readJson(join(project, "settings.json"));
  if (settings === null) return null;

  const locales = Array.isArray(settings.locales)
    ? (settings.locales as string[])
    : Array.isArray(settings.languageTags)
      ? (settings.languageTags as string[])
      : [];

  return { project: relative(cwd, join(project, "settings.json")).split("\\").join("/"), locales };
}

/**
 * The directories worth putting in a glob, derived from where matches actually
 * are. Guessing `src/lib/components` would be wrong for half the projects this
 * is meant to serve.
 */
async function findDirs(
  cwd: string,
  patterns: string[],
  needle: string,
  lines: string[],
  noun: string,
): Promise<string[]> {
  const paths = await glob(patterns, { cwd, absolute: true, ignore: SCAN_IGNORE, dot: false });
  const hits: string[] = [];

  for (const path of paths) {
    try {
      if (readFileSync(path, "utf8").includes(needle)) hits.push(path);
    } catch {
      // Unreadable during a scan is not worth failing over.
    }
  }

  if (hits.length === 0) {
    lines.push(`found no files containing a ${noun}`);
    return [];
  }

  lines.push(`found ${hits.length} file${hits.length === 1 ? "" : "s"} with a ${noun}`);
  return [...new Set(hits.map((path) => relative(cwd, dirname(path)).split("\\").join("/")))]
    .filter((dir) => dir !== "")
    .toSorted();
}

/** The shallowest common prefix, so one glob covers a whole tree. */
function rootOf(dirs: readonly string[], fallback: string): string {
  if (dirs.length === 0) return fallback;
  const first = dirs[0]!.split("/")[0];
  return first === undefined || first === "" ? fallback : first;
}

function template(input: {
  framework: "svelte" | "react" | null;
  paraglide: boolean;
  sourceDirs: string[];
  targetDirs: string[];
}): string {
  const { framework, paraglide, sourceDirs, targetDirs } = input;

  const imports = ['import { defineConfig } from "@jlacostaec/propsmith";'];
  const adapters: string[] = [];

  if (framework === "svelte") {
    imports.push('import { svelteAdapter } from "@jlacostaec/propsmith/adapters";');
    adapters.push("svelteAdapter()");
  } else if (framework === "react") {
    imports.push('import { reactAdapter } from "@jlacostaec/propsmith/adapters";');
    adapters.push("reactAdapter()");
  }
  if (paraglide) {
    imports.push('import { paraglide } from "@jlacostaec/propsmith/i18n/adapters";');
  }

  const sourceRoot = rootOf(sourceDirs, "src");
  const targetRoot = rootOf(targetDirs, "docs");
  const extensions =
    framework === "svelte" ? "{ts,svelte}" : framework === "react" ? "{ts,tsx}" : "ts";

  const body = [
    `  sources: ["${sourceRoot}/**/*.${extensions}"],`,
    `  ignore: ["**/*.{test,spec}.ts", "**/*.stories.*"],`,
    "",
    "  outputs: [",
    "    {",
    '      name: "docs",',
    `      files: ["${targetRoot}/**/*.md"],`,
    '      columns: ["name", "type", "default", "description"],',
    `      description: "${paraglide ? "i18n" : "text"}",`,
    "    },",
    "  ],",
    "",
    "  types: {",
    "    inlineUnder: 60,",
    `    glossary: "/${targetRoot}/types",`,
    "    links: {},",
    "  },",
  ];

  if (adapters.length > 0) body.splice(2, 0, `  adapters: [${adapters.join(", ")}],`, "");
  if (paraglide) {
    body.push("", '  i18n: paraglide({ project: "./project.inlang" }),');
  }

  return `${imports.join("\n")}\n\nexport default defineConfig({\n${body.join("\n")}\n});\n`;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed = parseJson(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
