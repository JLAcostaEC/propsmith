/**
 * Terminal output, and the exit code that goes with it.
 *
 * No colour library: propsmith's most important output is a CI log, and a log
 * with escape codes in it is a log nobody greps.
 */

import { relative } from "node:path";

import type { Diagnostic, RunMode, RunResult } from "../types.js";

const CLEAN = 0;
const FOUND_PROBLEMS = 1;

export function reportJson(result: RunResult): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function reportRun(
  result: RunResult,
  mode: RunMode,
  strict: boolean,
  cwd: string = process.cwd(),
): number {
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  const warnings = result.diagnostics.filter((d) => d.severity === "warning");

  if (mode === "dry-run") printPreview(result, cwd);
  if (mode === "write") printWrite(result, cwd);

  printDiagnostics(result.diagnostics, cwd);

  if (result.diagnostics.length > 0) {
    line(`  ${count(errors.length, "error")} · ${count(warnings.length, "warning")}`);
    line("");
  }

  if (errors.length > 0) return FOUND_PROBLEMS;
  if (strict && warnings.length > 0) return FOUND_PROBLEMS;
  return CLEAN;
}

// ---------------------------------------------------------------------------

function printPreview(result: RunResult, cwd: string): void {
  for (const change of result.changes) {
    if (change.body === undefined) continue;
    line("");
    line(`# ${show(change.file, cwd)} — ${change.region}`);
    line("");
    process.stdout.write(change.body.endsWith("\n") ? change.body : `${change.body}\n`);
  }
  line("");
}

function printWrite(result: RunResult, cwd: string): void {
  line("");

  const width = Math.max(0, ...result.changes.map((c) => show(c.file, cwd).length));
  const nameWidth = Math.max(0, ...result.changes.map((c) => c.region.length));

  for (const change of result.changes) {
    const mark =
      change.status === "unchanged"
        ? "= unchanged"
        : change.status === "created"
          ? "+ created"
          : "~ updated";
    // A built-in region holds types, not props, and its name says which it is.
    const noun = change.region.startsWith("@") ? "type" : "prop";
    const rows = change.rows === undefined ? "" : `${count(change.rows, noun).padStart(9)}   `;
    line(
      `  ${show(change.file, cwd).padEnd(width)}   ` +
        `${change.region.padEnd(nameWidth)}   ${rows}${mark}`,
    );
  }

  let wroteCatalog = false;
  for (const entry of result.catalog) {
    wroteCatalog = true;
    const parts = [
      entry.added.length > 0 ? `+${entry.added.length} keys` : "",
      entry.updated.length > 0 ? `~${entry.updated.length} modified` : "",
      entry.invalidated.length > 0 ? `-${entry.invalidated.length} stale` : "",
      entry.removed.length > 0 ? `-${entry.removed.length} orphaned` : "",
    ].filter((part) => part !== "");
    if (parts.length === 0) continue;
    line("");
    // `CatalogChange.file` carries the locale, not a path: the sync algorithm is
    // core and has no idea where the adapter keeps its files. Label it as what
    // it is rather than run it through the path shortener.
    line(`  locale ${entry.file}   ${parts.join("  ")}`);
  }

  const touched = result.changes.filter((c) => c.status !== "unchanged").length;
  line("");
  line(
    `  ${count(result.changes.length, "region")} · ` +
      `${count(touched, "region")} written · ${result.durationMs}ms`,
  );

  if (wroteCatalog) line("  ▸ run `paraglide-js compile` to regenerate m.*");
  line("");
}

function printDiagnostics(diagnostics: readonly Diagnostic[], cwd: string): void {
  if (diagnostics.length === 0) return;
  line("");

  // Errors first: a warning under a wall of errors is noise, not information.
  const ordered = diagnostics.toSorted((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    return (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0);
  });

  for (const diagnostic of ordered) {
    const mark = diagnostic.severity === "error" ? "✗" : "⚠";
    line(`  ${mark} ${where(diagnostic, cwd)}`);
    for (const part of wrap(diagnostic.message, 88)) line(`      ${part}`);
  }

  line("");
}

function where(diagnostic: Diagnostic, cwd: string): string {
  if (diagnostic.file === undefined) return "config";
  const path = show(diagnostic.file, cwd);
  return diagnostic.line === undefined ? path : `${path}:${diagnostic.line}`;
}

function show(file: string, cwd: string): string {
  const rel = relative(cwd, file);
  const inside = rel !== "" && !rel.startsWith("..");
  return (inside ? rel : file).split("\\").join("/");
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** Wrap on spaces so a long message stays readable in a narrow CI log. */
function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((word) => word !== "");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (current === "") {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length > width) {
      lines.push(current);
      current = word;
      continue;
    }
    current += ` ${word}`;
  }
  if (current !== "") lines.push(current);
  return lines.length > 0 ? lines : [text];
}

function line(text: string): void {
  process.stdout.write(`${text}\n`);
}
