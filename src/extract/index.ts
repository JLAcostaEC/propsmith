/**
 * Extraction: TypeScript source in, IR out.
 *
 * The file is parsed once with oxc; nothing here consults the type checker, so
 * a type is only ever what the author wrote. Every exported type alias and
 * interface is recorded for the symbol index, and the ones carrying
 * `@propsmith <Name>` additionally become components.
 */

import { parseSync } from "oxc-parser";
import type {
  PropertyKey as KeyNode,
  TSInterfaceDeclaration,
  TSInterfaceHeritage,
  TSMethodSignature,
  TSPropertySignature,
  TSSignature,
  TSType,
  TSTypeAliasDeclaration,
  TSTypeParameterInstantiation,
} from "oxc-parser";
import type {
  ComponentDoc,
  Diagnostic,
  ExtraRow,
  ExtractResult,
  ExtrasLabels,
  MemberDoc,
  ResolvedExtras,
  SourceRef,
  TagRender,
  TypeDeclaration,
} from "../types.js";
import { codeSpan } from "../render/escape.js";
import {
  DEFAULT_EXTRAS_LABELS,
  type ExtraLabelValues,
  formatExtraLabel,
} from "../render/extras.js";
import { attachComments, type ParsedJSDoc } from "./jsdoc.js";

export interface ExtractInput {
  /** Absolute path of the file the code came from. */
  filePath: string;
  /** TypeScript source, already unwrapped by a source adapter. */
  code: string;
  lang: "ts" | "tsx";
  /** Offset of `code` inside the original file, added back for line numbers. */
  offset: number;
  /** The untouched file text, used for line and column computation. */
  originalSource: string;
  /** Configured custom tags, by tag name. */
  tags: Record<string, TagRender>;
  /** Modules whose types become an `Element Attributes` row. */
  elementAttributeModules: string[];
  /** Wording of the summary rows an intersection produces. Defaults to English. */
  extras?: ResolvedExtras;
}

/**
 * Tags propsmith understands itself, each with a dedicated field on `MemberDoc`.
 *
 * They are kept out of `flags` so the same fact is not carried twice — unless
 * the author has also declared one in `tags`, which is how you get `@deprecated`
 * as a column as well as a strikethrough.
 */
const STRUCTURAL_TAGS = new Set([
  "propsmith",
  "default",
  "see",
  "type",
  "deprecated",
  "internal",
  "inheritDoc",
  "inheritdoc",
]);

/** `@inheritDoc`, in the two spellings TSDoc and JSDoc use for it. */
const INHERIT_TAGS = ["inheritDoc", "inheritdoc"] as const;

/** A type whose name alone says it carries DOM attributes. */
const ELEMENT_ATTRIBUTES = /^(?:HTML|SVG)\w*Attributes$/;
/** `HTMLButtonElement` -> `Button`, `SVGElement` -> ``. */
const DOM_INTERFACE = /^(?:HTML|SVG)(\w*)Element$/;
/** `HTMLButtonAttributes` -> `Button`, `HTMLAttributes` -> ``. */
const PREFIXED_ATTRIBUTES = /^(?:HTML|SVG)(\w*)Attributes$/;
/** React's spelling: `ButtonHTMLAttributes` -> `Button`. */
const SUFFIXED_ATTRIBUTES = /^(\w+?)(?:HTML|SVG)Attributes$/;

/** DOM interface names that do not lowercase into their tag name. */
const ELEMENT_ALIASES: Record<string, string> = {
  anchor: "a",
  dlist: "dl",
  image: "img",
  olist: "ol",
  paragraph: "p",
  quote: "blockquote",
  tablecaption: "caption",
  tablecell: "td",
  tablerow: "tr",
  ulist: "ul",
};

type TypeDecl = TSTypeAliasDeclaration | TSInterfaceDeclaration;
/** An intersection branch or an interface heritage clause. */
type Branch = TSType | TSInterfaceHeritage;

/** Whitespace of any kind, collapsed to a single space. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripQuotes(text: string): string {
  return text.replace(/^['"`]/, "").replace(/['"`]$/, "");
}

/** Offsets of every line start, for turning an offset into a line and column. */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = source.indexOf("\n"); index !== -1; index = source.indexOf("\n", index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}

/** Parenthesised types are transparent for everything this module decides. */
function unwrap(node: TSType): TSType {
  let current = node;
  while (current.type === "TSParenthesizedType") current = current.typeAnnotation;
  return current;
}

/**
 * `typeArguments` on current oxc, `typeParameters` on older ESTree emitters.
 * Read whichever is present.
 */
function typeArguments(node: Branch): TSTypeParameterInstantiation | null {
  const bag = node as {
    typeArguments?: TSTypeParameterInstantiation | null;
    typeParameters?: TSTypeParameterInstantiation | null;
  };
  return bag.typeArguments ?? bag.typeParameters ?? null;
}

/** The member's name, unquoted. */
function memberName(key: KeyNode, code: string): string {
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal") return String(key.value);
  return stripQuotes(oneLine(code.slice(key.start, key.end)));
}

/**
 * A method signature carries no type annotation, so its type is rebuilt from
 * its own span: `onSelect?(item: T): void` reads as `(item: T) => void`.
 */
function methodType(member: TSMethodSignature, code: string): string {
  const returns = member.returnType;
  if (member.kind === "get" && returns) {
    return oneLine(code.slice(returns.typeAnnotation.start, returns.typeAnnotation.end));
  }

  const parenthesis = code.indexOf("(", member.key.end);
  const start = member.typeParameters ? member.typeParameters.start : parenthesis;
  if (start < 0) return oneLine(code.slice(member.start, member.end)).replace(/[;,]$/, "");
  if (!returns) return oneLine(code.slice(start, member.end)).replace(/[;,]$/, "");

  const head = oneLine(code.slice(start, returns.start));
  const tail = oneLine(code.slice(returns.typeAnnotation.start, returns.typeAnnotation.end));
  return `${head} => ${tail}`;
}

/** A `@type` text and how it asked to be read. */
interface TypeTag {
  /** The text, braces removed. */
  text: string;
  /** `true` for `@type {X}` — TypeScript, to be resolved like a declared type. */
  braced: boolean;
}

/**
 * Read a `@type` text.
 *
 * JSDoc has always written a type inside braces, and that is the distinction
 * propsmith needs: `@type {ButtonGenerics}` is a type — resolve it, split its
 * union, link it — while `@type A CSS length` is the prose escape hatch and is
 * printed as written. An object literal therefore doubles its braces, exactly
 * as JSDoc's record syntax does: `@type {{ id: string }}`.
 *
 * Only a `{` closed by the very last character counts, so `{a} | {b}` is prose
 * rather than a half-stripped type.
 */
function unbrace(text: string): TypeTag {
  if (!text.startsWith("{") || !wrapsWholeText(text)) return { text, braced: false };
  return { text: oneLine(text.slice(1, -1)), braced: true };
}

/** Whether the leading `{` of the text is closed by its very last character. */
function wrapsWholeText(text: string): boolean {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return index === text.length - 1;
      if (depth < 0) return false;
    }
  }
  return false;
}

/** The string literals of a `Pick` / `Omit` key list, verbatim without quotes. */
function literalKeys(node: TSType, code: string): string[] {
  const list = node.type === "TSUnionType" ? node.types : [node];
  const keys: string[] = [];
  for (const item of list) {
    if (item.type !== "TSLiteralType") continue;
    const literal = item.literal;
    if (literal.type === "Literal" && typeof literal.value === "string") {
      keys.push(literal.value);
      continue;
    }
    keys.push(stripQuotes(oneLine(code.slice(item.start, item.end))));
  }
  return keys;
}

/** `Button` -> `button`, with the handful of DOM names that need a map. */
function elementName(word: string): string | undefined {
  if (word === "") return undefined;
  const lowered = word.toLowerCase();
  return ELEMENT_ALIASES[lowered] ?? lowered;
}

/**
 * The element an attributes type documents. The type argument wins
 * (`HTMLAttributes<HTMLDivElement>` -> `div`); with no argument the name is
 * read instead (`HTMLButtonAttributes` -> `button`).
 */
function elementOf(
  name: string,
  args: TSTypeParameterInstantiation | null,
  code: string,
): string | undefined {
  const first = args?.params[0];
  if (first) {
    const text = oneLine(code.slice(first.start, first.end));
    const dom = DOM_INTERFACE.exec(text);
    if (dom) return elementName(dom[1]);
  }
  const prefixed = PREFIXED_ATTRIBUTES.exec(name);
  if (prefixed) return elementName(prefixed[1]);
  const suffixed = SUFFIXED_ATTRIBUTES.exec(name);
  if (suffixed) return elementName(suffixed[1]);
  return undefined;
}

/** Everything `toExtraRow` needs that is the same for every branch in a file. */
interface ExtraRowContext {
  code: string;
  /** Local name -> module it was imported from. */
  modules: Map<string, string>;
  elementAttributeModules: string[];
  labels: ExtrasLabels;
  /** Origin type name -> label, from `types.extras.origins`. */
  origins: Record<string, string>;
}

/**
 * Turn one intersection branch or heritage clause into a summary row.
 *
 * Three things can decide the Name cell, in this order: a `@type` written on
 * the branch itself, a label configured for the origin type, and the template
 * for the kind of row it is. The first is the author naming this one row by
 * hand, which nothing should override.
 *
 * Every type name in a label goes inside a code span. A bare
 * `HTMLAttributes<HTMLDivElement>` in live markdown opens an HTML tag, which is
 * exactly what propsmith promises never to emit — and a bare `|` from a
 * `Pick`'s key union would split the cell.
 */
function toExtraRow(branch: Branch, doc: ParsedJSDoc | undefined, ctx: ExtraRowContext): ExtraRow {
  const { code } = ctx;
  const text = oneLine(code.slice(branch.start, branch.end));
  // The branch's own sentence, which the row has a Description cell for.
  const note = doc?.summary ?? "";
  const written = writtenLabel(doc);

  const nameNode =
    branch.type === "TSInterfaceHeritage"
      ? branch.expression
      : branch.type === "TSTypeReference"
        ? branch.typeName
        : null;
  if (!nameNode) {
    return withNote({ kind: "reference", label: written ?? codeSpan(text) }, note);
  }

  const name = oneLine(code.slice(nameNode.start, nameNode.end));
  const parts = name.split(".");
  const head = parts[0];
  const last = parts[parts.length - 1];
  const args = typeArguments(branch);

  if ((last === "Pick" || last === "Omit") && args && args.params.length >= 2) {
    const kind = last === "Pick" ? "pick" : "omit";
    const origin = oneLine(code.slice(args.params[0].start, args.params[0].end));
    const keys = literalKeys(args.params[1], code);
    // `Pick<X, K>` behind a type parameter has no keys to name, so the branch
    // speaks for itself rather than reading `from X` with a gap in front of it.
    const template = keys.length > 0 ? ctx.labels[kind] : "{text}";
    const values = { keys, origin, text };
    const label =
      written ?? configuredLabel(ctx.origins, origin, values) ?? formatExtraLabel(template, values);
    return withNote({ kind, label, keys, origin }, note);
  }

  const module = ctx.modules.get(head);
  const fromModule = module !== undefined && ctx.elementAttributeModules.includes(module);
  if (fromModule || ELEMENT_ATTRIBUTES.test(last)) {
    const element = elementOf(last, args, code);
    const values = { element, origin: name, text };
    const label =
      written ??
      configuredLabel(ctx.origins, name, values) ??
      formatExtraLabel(ctx.labels.elementAttributes, values);
    return withNote(
      {
        kind: "element-attributes",
        label,
        ...(element ? { element } : {}),
        origin: name,
      },
      note,
    );
  }

  const values = { origin: name, text };
  return withNote(
    {
      kind: "reference",
      label: written ?? configuredLabel(ctx.origins, name, values) ?? codeSpan(text),
      origin: name,
    },
    note,
  );
}

function withNote(row: ExtraRow, note: string): ExtraRow {
  return note === "" ? row : { ...row, note };
}

/**
 * The label an author wrote on the branch: `@type` on a JSDoc block attached to
 * it. Braces are accepted and stripped, so `@type {X}` reads the same here as
 * on a member, and the text is code-spanned because a `@type` names a type. For
 * a label that is prose, use `types.extras.origins`.
 */
function writtenLabel(doc: ParsedJSDoc | undefined): string | undefined {
  const tag = oneLine(doc?.tags.type?.[0] ?? "");
  if (tag === "") return undefined;
  return codeSpan(unbrace(tag).text);
}

/**
 * The label configured for an origin type, looked up by the text as written
 * (`PolymorphicProps<'span'>`) and then by the bare name, so one entry covers
 * every instantiation. The value is a template like any other, which is what
 * lets it be prose, a rewording, or both.
 */
function configuredLabel(
  origins: Record<string, string>,
  origin: string,
  values: ExtraLabelValues,
): string | undefined {
  const base = origin.split("<")[0].trim();
  for (const key of base === origin ? [origin] : [origin, base]) {
    // `hasOwn`, because the config is a plain object and a type could in
    // principle be named after something on `Object.prototype`.
    if (!Object.hasOwn(origins, key)) continue;
    const template = origins[key];
    if (template.trim() !== "") return formatExtraLabel(template, values);
  }
  return undefined;
}

interface Analysis {
  /** Property and method signatures, in declaration order. */
  members: TSSignature[];
  branches: Branch[];
  shape: TypeDeclaration["shape"];
  /** Span of the declaration body, for the verbatim `text`. */
  bodyStart: number;
  bodyEnd: number;
  /** For a union: the members, verbatim. */
  values?: string[];
}

/** Read the structure of one declaration: what supplies members, what does not. */
function analyze(declaration: TypeDecl, code: string): Analysis {
  if (declaration.type === "TSInterfaceDeclaration") {
    return {
      members: declaration.body.body,
      branches: declaration.extends,
      shape: "object",
      bodyStart: declaration.body.start,
      bodyEnd: declaration.body.end,
    };
  }

  const annotation = declaration.typeAnnotation;
  const body = unwrap(annotation);
  const base = { bodyStart: annotation.start, bodyEnd: annotation.end };

  if (body.type === "TSTypeLiteral") {
    return { ...base, members: body.members, branches: [], shape: "object" };
  }
  if (body.type === "TSUnionType") {
    return {
      ...base,
      members: [],
      branches: [],
      shape: "union",
      values: body.types.map((member) => oneLine(code.slice(member.start, member.end))),
    };
  }
  if (body.type === "TSIntersectionType") {
    const members: TSSignature[] = [];
    const branches: Branch[] = [];
    for (const part of body.types) {
      const branch = unwrap(part);
      if (branch.type === "TSTypeLiteral") members.push(...branch.members);
      else branches.push(branch);
    }
    return { ...base, members, branches, shape: "alias" };
  }
  if (body.type === "TSTypeReference") {
    return { ...base, members: [], branches: [body], shape: "alias" };
  }
  return { ...base, members: [], branches: [], shape: "alias" };
}

/**
 * The `@inheritDoc` target: the type named after the tag, or `true` when the
 * tag is bare and the member's own type is the target.
 *
 * `{@link Foo}` braces are stripped, because that is how TSDoc spells the
 * reference and an editor renders it either way.
 */
function inheritTag(doc: ParsedJSDoc | undefined): string | true | undefined {
  for (const tag of INHERIT_TAGS) {
    const raw = doc?.tags[tag]?.[0];
    if (raw === undefined) continue;
    const text = oneLine(raw)
      .replace(/^\{\s*@link\s+/, "")
      .replace(/\}$/, "");
    const name = text.split(/[\s,;]/)[0] ?? "";
    return name === "" ? true : name;
  }
  return undefined;
}

/** Signatures that can become a row: index and call signatures cannot. */
function isDocumentable(member: TSSignature): member is TSPropertySignature | TSMethodSignature {
  return member.type === "TSPropertySignature" || member.type === "TSMethodSignature";
}

/** A declaration and everything read off it in the first pass. */
interface Collected {
  declaration: TypeDecl;
  /** The node a JSDoc block attaches to: the `export` statement, or the declaration. */
  docNode: { start: number; end: number };
  exported: boolean;
  analysis: Analysis;
}

export function extractFile(input: ExtractInput): ExtractResult {
  const { filePath, code, lang, offset, originalSource, tags, elementAttributeModules } = input;
  const extras = input.extras ?? { labels: DEFAULT_EXTRAS_LABELS, origins: {} };
  const components: ComponentDoc[] = [];
  const declarations: TypeDeclaration[] = [];
  const diagnostics: Diagnostic[] = [];

  const starts = lineStarts(originalSource);
  const locate = (start: number): SourceRef => {
    const target = Math.max(0, start + offset);
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= target) low = middle;
      else high = middle - 1;
    }
    return { file: filePath, line: low + 1, column: target - starts[low] + 1 };
  };
  const at = (start: number): Pick<Diagnostic, "file" | "line" | "column"> => {
    const source = locate(start);
    return { file: source.file, line: source.line, column: source.column };
  };

  const parsed = parseSync(filePath, code, { lang });
  const body = parsed.program.body;

  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    const rest = parsed.errors.length - 1;
    diagnostics.push({
      severity: body.length === 0 ? "error" : "warning",
      code: "parse-error",
      message: rest > 0 ? `${first.message} (and ${rest} more parse errors)` : first.message,
      ...at(first.labels[0]?.start ?? 0),
    });
    if (body.length === 0) return { components, declarations, diagnostics };
  }

  // Local name -> module it was imported from, for the element-attributes test.
  const modules = new Map<string, string>();
  for (const statement of body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers)
      modules.set(specifier.local.name, statement.source.value);
  }

  const collected: Collected[] = [];
  for (const statement of body) {
    if (statement.type === "ExportNamedDeclaration") {
      const declaration = statement.declaration;
      if (!declaration) continue;
      if (
        declaration.type !== "TSTypeAliasDeclaration" &&
        declaration.type !== "TSInterfaceDeclaration"
      ) {
        continue;
      }
      collected.push({
        declaration,
        docNode: statement,
        exported: true,
        analysis: analyze(declaration, code),
      });
      continue;
    }
    if (
      statement.type === "TSTypeAliasDeclaration" ||
      statement.type === "TSInterfaceDeclaration"
    ) {
      collected.push({
        declaration: statement,
        docNode: statement,
        exported: false,
        analysis: analyze(statement, code),
      });
    }
  }

  // A branch can carry a JSDoc block of its own — the only way to name one
  // summary row by hand, and to give it a Description cell.
  const docTargets: Array<{ start: number }> = [];
  for (const entry of collected) {
    docTargets.push(entry.docNode);
    for (const member of entry.analysis.members) docTargets.push(member);
    for (const branch of entry.analysis.branches) docTargets.push(branch);
  }
  const docs = attachComments(docTargets, parsed.comments, code);

  for (const entry of collected) {
    const { declaration, analysis } = entry;
    const typeName = declaration.id.name;
    const typeDoc = docs.get(entry.docNode);
    const internalType = typeDoc !== undefined && typeDoc.tags.internal !== undefined;

    const members: MemberDoc[] = [];
    const memberDiagnostics: Diagnostic[] = [];
    for (const member of analysis.members) {
      if (!isDocumentable(member)) continue;
      const doc: ParsedJSDoc | undefined = docs.get(member);
      if (doc?.tags.internal) continue;

      const name = memberName(member.key, code);
      const annotation = member.type === "TSPropertySignature" ? member.typeAnnotation : null;
      const type =
        member.type === "TSMethodSignature"
          ? methodType(member, code)
          : annotation
            ? oneLine(code.slice(annotation.typeAnnotation.start, annotation.typeAnnotation.end))
            : "";

      // Every tag that is not structural lands here, declared in `tags` or not.
      // A configured tag is what the table renders; an unknown one is carried
      // anyway, so a custom renderer can use a tag propsmith has never heard of
      // without the author having to declare it first.
      const flags: Record<string, string | true> = {};
      for (const [tag, values] of Object.entries(doc?.tags ?? {})) {
        if (STRUCTURAL_TAGS.has(tag) && !(tag in tags)) continue;
        const first = values[0];
        if (first === undefined) continue;
        const text = oneLine(first);
        flags[tag] = text === "" ? true : text;
      }

      const defaultValue = oneLine(doc?.tags.default?.[0] ?? "");
      const see = oneLine(doc?.tags.see?.[0] ?? "");
      // `@type {X}` is TypeScript to resolve; `@type X` is prose to print.
      const typeTag = oneLine(doc?.tags.type?.[0] ?? "");
      const override = typeTag === "" ? null : unbrace(typeTag);
      const deprecated = doc?.tags.deprecated?.[0];
      const inherit = inheritTag(doc);
      const source = locate(member.start);

      members.push({
        name,
        optional: member.optional,
        readonly: member.type === "TSPropertySignature" ? member.readonly : false,
        type,
        description: doc?.summary ?? "",
        descriptionFull: doc?.full ?? "",
        ...(defaultValue === "" ? {} : { defaultValue }),
        ...(deprecated === undefined ? {} : { deprecated: oneLine(deprecated) || true }),
        ...(see === "" ? {} : { see }),
        ...(override === null
          ? {}
          : {
              typeOverride: override.text,
              typeOverrideKind: override.braced ? ("type" as const) : ("text" as const),
            }),
        ...(inherit === undefined ? {} : { inheritDoc: inherit }),
        flags,
        source,
      });

      // A member with no description is not reported here: it may still inherit
      // one from the type it is declared with, and only the run — which has the
      // symbol index, and so every file — can know whether it did.
      if (doc?.tags.type) {
        memberDiagnostics.push({
          severity: "warning",
          code: "type-override-used",
          message: `${typeName}.${name} overrides its type with @type`,
          ...at(member.start),
        });
      }
    }

    if (entry.exported) {
      // The declaration's own JSDoc, so a prop typed `variant?: Variant` can
      // take the description and the default that `Variant` already carries.
      const typeDefault = oneLine(typeDoc?.tags.default?.[0] ?? "");
      declarations.push({
        name: typeName,
        text: oneLine(code.slice(analysis.bodyStart, analysis.bodyEnd)),
        shape: analysis.shape,
        ...(analysis.shape === "object" ? { keys: members.map((member) => member.name) } : {}),
        ...(analysis.values ? { values: analysis.values } : {}),
        ...(typeDoc?.summary ? { description: typeDoc.summary } : {}),
        ...(typeDefault === "" ? {} : { defaultValue: typeDefault }),
        source: locate(declaration.start),
      });
    }

    const names = typeDoc?.tags.propsmith;
    if (!names || internalType) continue;

    const extraRows = analysis.branches.map((branch) =>
      toExtraRow(branch, docs.get(branch), {
        code,
        modules,
        elementAttributeModules,
        labels: extras.labels,
        origins: extras.origins,
      }),
    );
    const typeParameters =
      declaration.typeParameters?.params.map((parameter) =>
        oneLine(code.slice(parameter.start, parameter.end)),
      ) ?? [];
    const source = locate(declaration.start);

    let documented = false;
    for (const raw of names) {
      const name = oneLine(raw).split(" ")[0];
      if (name === "") {
        diagnostics.push({
          severity: "error",
          code: "config-invalid",
          message: `@propsmith on ${typeName} needs a component name`,
          ...at(declaration.start),
        });
        continue;
      }
      if (name.startsWith("@")) {
        diagnostics.push({
          severity: "error",
          code: "config-invalid",
          message: `@propsmith ${name} is not a valid component name — "@" is reserved for built-in regions`,
          ...at(declaration.start),
        });
        continue;
      }
      components.push({
        name,
        typeName,
        typeParameters,
        members: members.slice(),
        extras: extraRows.slice(),
        source,
      });
      documented = true;
    }

    if (documented) diagnostics.push(...memberDiagnostics);
  }

  return { components, declarations, diagnostics };
}
