/**
 * Two verbs and a scaffold.
 *
 * `--dry-run` is a modifier of the default write rather than a third verb,
 * because it answers "what would writing do", not a different question.
 */

import { Command, Option } from "commander";

import { loadConfig, resolveConfig } from "../config.js";
import { run } from "../run.js";
import type { RunMode, RunOptions } from "../types.js";
import { init } from "./init.js";
import { reportJson, reportRun } from "./report.js";

const EXIT_CLEAN = 0;
const EXIT_PROBLEMS = 1;
const EXIT_MISUSE = 2;

const NAME = typeof __PKG_NAME__ === "string" ? __PKG_NAME__ : "propsmith";
const VERSION = typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0";
const DESCRIPTION =
  typeof __PKG_DESCRIPTION__ === "string"
    ? __PKG_DESCRIPTION__
    : "Generate props tables from TypeScript types into markdown";

interface SharedFlags {
  component?: string[];
  only?: string[];
  i18n?: boolean;
  config?: string;
  strict?: boolean;
  json?: boolean;
  dryRun?: boolean;
}

export async function main(argv: string[] = process.argv): Promise<number> {
  const program = new Command();

  // The same flags are declared on the root and on `check`. Without this, the
  // root's copy swallows everything after the subcommand name and `check
  // --strict` silently does nothing. Positional parsing gives options after a
  // subcommand to that subcommand, which is what the help text promises.
  program.enablePositionalOptions();

  program
    .name(NAME.replace(/^@[^/]+\//, ""))
    .description(DESCRIPTION)
    .version(VERSION, "-v, --version")
    .showHelpAfterError();

  const shared = (command: Command): Command =>
    command
      .option("--component <name>", "restrict to one component (repeatable)", collect, [])
      .option("--only <output>", "restrict to one named output (repeatable)", collect, [])
      .addOption(new Option("--no-i18n", "skip the catalog lane for this run"))
      .option("--config <path>", "path to the config file")
      .option("--strict", "treat warnings as failures")
      .option("--json", "print the run result as JSON");

  shared(program)
    .option("--dry-run", "print what would be written, touch nothing")
    .action(async (flags: SharedFlags) => {
      process.exitCode = await execute(flags.dryRun === true ? "dry-run" : "write", flags);
    });

  shared(
    program.command("check").description("report drift without writing; exits non-zero on failure"),
  ).action(async (flags: SharedFlags) => {
    process.exitCode = await execute("check", flags);
  });

  program
    .command("init")
    .description("scaffold propsmith.config.ts from what this project already looks like")
    .action(async () => {
      const result = await init(process.cwd());
      for (const line of result.lines) {
        process.stdout.write(`  ${result.written === null ? "!" : "✓"} ${line}\n`);
      }
      if (result.written !== null) process.stdout.write("\n  next: propsmith --dry-run\n");
      process.exitCode = result.written === null ? EXIT_MISUSE : EXIT_CLEAN;
    });

  try {
    await program.parseAsync(argv);
  } catch (error) {
    process.stderr.write(`propsmith: ${message(error)}\n`);
    return EXIT_MISUSE;
  }

  return typeof process.exitCode === "number" ? process.exitCode : EXIT_CLEAN;
}

async function execute(mode: RunMode, flags: SharedFlags): Promise<number> {
  const cwd = process.cwd();

  const loaded = await loadConfig(cwd, flags.config);
  if (loaded.config === null) {
    for (const diagnostic of loaded.diagnostics) {
      process.stderr.write(`propsmith: ${diagnostic.message}\n`);
    }
    if (loaded.diagnostics.length === 0) {
      process.stderr.write(
        "propsmith: no config found. Run `propsmith init`, or point at one with --config\n",
      );
    }
    return EXIT_MISUSE;
  }

  const { resolved, diagnostics } = resolveConfig(loaded.config, cwd);
  const fatal = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (fatal.length > 0) {
    for (const diagnostic of fatal) process.stderr.write(`propsmith: ${diagnostic.message}\n`);
    return EXIT_MISUSE;
  }

  // Commander seeds a repeatable option with `[]`, and an empty list must mean
  // "no restriction", not "restrict to nothing".
  const options: RunOptions = {
    mode,
    config: resolved,
    components: some(flags.component),
    only: some(flags.only),
    noI18n: flags.i18n === false,
    strict: flags.strict === true,
  };

  try {
    const result = await run(options);
    result.diagnostics.unshift(...diagnostics);

    if (flags.json === true) {
      reportJson(result);
      return result.diagnostics.some((d) => d.severity === "error") ? EXIT_PROBLEMS : EXIT_CLEAN;
    }

    return reportRun(result, mode, flags.strict === true, cwd);
  } catch (error) {
    process.stderr.write(`propsmith: ${message(error)}\n`);
    return EXIT_MISUSE;
  }
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function some(values: string[] | undefined): string[] | undefined {
  return values !== undefined && values.length > 0 ? values : undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
