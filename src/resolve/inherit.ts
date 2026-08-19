/**
 * Descriptions inherited from a shared type.
 *
 * A design system keeps its vocabulary in one file:
 *
 * ```ts
 * /** The visual style. @default "primary" *\/
 * export type Variant = "primary" | "ghost" | "danger";
 *
 * export type ButtonProps = { variant?: Variant };
 * ```
 *
 * `Variant` is already documented, so repeating the sentence on every prop
 * typed with it is duplication that goes stale one copy at a time. An
 * undocumented prop therefore takes the description — and the `@default` — of
 * the type it is declared with, and `@inheritDoc` asks for the same thing
 * explicitly, optionally naming a different type.
 *
 * This runs after the symbol index is complete, because the type usually lives
 * in another file, and before the catalog and the tables are built, so both see
 * the same text.
 */

import type { ComponentDoc, Diagnostic, MemberDoc, ResolvedTypes, SourceRef } from "../types.js";
import type { SymbolIndex } from "./index.js";

export interface InheritInput {
  components: readonly ComponentDoc[];
  index: SymbolIndex;
  types: ResolvedTypes;
}

export interface InheritResult {
  /** The same components, with inherited text filled in. */
  components: ComponentDoc[];
  diagnostics: Diagnostic[];
}

/** A bare name, possibly qualified: `Variant`, `Theme.Variant`. */
const BARE_NAME = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
/** A generic reference: `Options<T>`. The base name is what gets looked up. */
const GENERIC_NAME = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*<(.*)>$/;
/** Union members that say "absent", not "some other type". */
const NULLISH = new Set(["null", "undefined", "never", "void"]);

/**
 * Fill in every description and default a member can inherit, and report the
 * members that end up with neither.
 *
 * Members are only rewritten when something was actually inherited, so an
 * unaffected component comes back as the very same object.
 */
export function inheritDocs(input: InheritInput): InheritResult {
  const { components, index, types } = input;
  const diagnostics: Diagnostic[] = [];

  /** One member can belong to two components; report it once. */
  const reported = new Set<string>();
  const report = (severity: Diagnostic["severity"], message: string, at: SourceRef): void => {
    const key = `${severity}:${at.file}:${at.line}:${at.column}:${message}`;
    if (reported.has(key)) return;
    reported.add(key);
    diagnostics.push({ severity, code: "missing-description", message, ...at });
  };

  const out = components.map((component) => ({
    ...component,
    members: component.members.map((member) =>
      resolveMember(member, component, index, types, report),
    ),
  }));

  return { components: out, diagnostics };
}

type Report = (severity: Diagnostic["severity"], message: string, at: SourceRef) => void;

function resolveMember(
  member: MemberDoc,
  component: ComponentDoc,
  index: SymbolIndex,
  types: ResolvedTypes,
  report: Report,
): MemberDoc {
  const where = `${component.typeName}.${member.name}`;
  const asked = member.inheritDoc !== undefined;
  const wanted = member.description === "" || member.defaultValue === undefined;

  // Nothing to fill, or automatic inheritance is off and nothing asked for it.
  if (!wanted || (!asked && !types.inherit)) {
    if (member.description === "") report("warning", `${where} has no description`, member.source);
    return member;
  }

  const name = typeof member.inheritDoc === "string" ? member.inheritDoc : typeNameOf(member.type);

  if (name === undefined) {
    if (member.description === "") report("warning", `${where} has no description`, member.source);
    return member;
  }

  const declaration = index.get(name);
  if (declaration === undefined) {
    if (asked) {
      report(
        "warning",
        `${where}: @inheritDoc found no exported type named \`${name}\`. ` +
          "Only exported declarations are indexed",
        member.source,
      );
    } else if (member.description === "") {
      report("warning", `${where} has no description`, member.source);
    }
    return member;
  }

  const description = member.description === "" ? (declaration.description ?? "") : "";
  const defaultValue = member.defaultValue === undefined ? (declaration.defaultValue ?? "") : "";

  if (description === "" && defaultValue === "") {
    if (member.description === "") {
      report(
        "warning",
        `${where} has no description, and neither does \`${name}\` — document one of the two`,
        member.source,
      );
    }
    return member;
  }

  return {
    ...member,
    ...(description === "" ? {} : { description, descriptionFull: description }),
    ...(defaultValue === "" ? {} : { defaultValue }),
    ...(description === "" ? {} : { inheritedFrom: name }),
  };
}

/**
 * The named type a member is declared with, or `undefined` when its type is not
 * one name.
 *
 * `Variant` and `Options<T>` qualify; `Variant | null` does too, because the
 * nullability is not what carries the documentation. Anything else — a literal
 * union, a function type, an array, an inline object — has no single
 * declaration to inherit from.
 */
export function typeNameOf(typeText: string): string | undefined {
  const parts = typeText
    .replace(/\s+/g, " ")
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part !== "" && !NULLISH.has(part));

  if (parts.length !== 1) return undefined;
  const text = parts[0] as string;

  if (BARE_NAME.test(text)) return text;

  const generic = GENERIC_NAME.exec(text);
  // A split union can leave a generic in halves; a mismatched count says so.
  if (generic && count(text, "<") === count(text, ">")) return generic[1];

  return undefined;
}

function count(text: string, char: string): number {
  let total = 0;
  for (const value of text) {
    if (value === char) total += 1;
  }
  return total;
}
