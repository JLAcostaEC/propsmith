/**
 * Extraction: TypeScript source in, IR out.
 *
 * Every case is an inline source string, because what is under test is what the
 * author wrote — no file, no type checker, no config resolution.
 */

import { describe, expect, it } from "vitest";

import type { ExtractInput } from "../src/extract/index.js";
import { extractFile } from "../src/extract/index.js";
import { assertNoHtml } from "../src/render/escape.js";
import type { ComponentDoc, ExtractResult, MemberDoc } from "../src/types.js";

const FILE = "/src/props.ts";

/** `extractFile` with the boring fields filled in. */
function extract(code: string, overrides: Partial<ExtractInput> = {}): ExtractResult {
  return extractFile({
    filePath: FILE,
    code,
    lang: "ts",
    offset: 0,
    originalSource: code,
    tags: {},
    elementAttributeModules: [],
    ...overrides,
  });
}

/** The single component the source declares. */
function sole(code: string, overrides: Partial<ExtractInput> = {}): ComponentDoc {
  const { components } = extract(code, overrides);
  expect(components).toHaveLength(1);
  return components[0]!;
}

/** The parts of a member list two declaration forms must agree on. */
function shapeOf(component: ComponentDoc): unknown[] {
  return component.members.map((entry) => [
    entry.name,
    entry.type,
    entry.optional,
    entry.description,
  ]);
}

function member(component: ComponentDoc, name: string): MemberDoc {
  const found = component.members.find((candidate) => candidate.name === name);
  expect(found, `no member named ${name}`).toBeDefined();
  return found!;
}

// ---------------------------------------------------------------------------

describe("what becomes a component", () => {
  it("promotes only the tagged type, but records both as declarations", () => {
    const { components, declarations } = extract(`
      /** @propsmith Button */
      export type ButtonProps = {
        /** The label. */
        label: string;
      };

      export type FooProps = {
        /** Unrelated. */
        foo: string;
      };
    `);

    expect(components.map((component) => component.name)).toEqual(["Button"]);
    // The untagged type is still indexed: that is what lets a member of another
    // component whose type is `FooProps` resolve to a definition.
    expect(declarations.map((declaration) => declaration.name)).toEqual([
      "ButtonProps",
      "FooProps",
    ]);
  });

  it("emits one component per @propsmith tag, sharing the members", () => {
    const { components } = extract(`
      /**
       * A button.
       *
       * @propsmith Button
       * @propsmith IconButton
       */
      export type ButtonProps = {
        /** The label. */
        label: string;
      };
    `);

    expect(components.map((component) => component.name)).toEqual(["Button", "IconButton"]);
    expect(components.map((component) => component.typeName)).toEqual([
      "ButtonProps",
      "ButtonProps",
    ]);
    expect(components[0]!.members).toEqual(components[1]!.members);
    // Equal content, separate arrays: one component's rendering must never be
    // able to mutate the other's.
    expect(components[0]!.members).not.toBe(components[1]!.members);
  });

  it("keeps a namespaced component name whole", () => {
    const component = sole(`
      /** @propsmith shared/Button */
      export type ButtonProps = {
        /** The label. */
        label: string;
      };
    `);

    expect(component.name).toBe("shared/Button");
    expect(component.typeName).toBe("ButtonProps");
  });

  it("documents an unexported type without indexing it", () => {
    const { components, declarations } = extract(`
      /** @propsmith Button */
      type ButtonProps = {
        /** The label. */
        label: string;
      };
    `);

    expect(components.map((component) => component.name)).toEqual(["Button"]);
    expect(declarations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("members", () => {
  it("records optional and readonly, in declaration order", () => {
    const component = sole(`
      /** @propsmith Button */
      export interface ButtonProps {
        /** The label. */
        label: string;
        /** Whether it is disabled. */
        disabled?: boolean;
        /** The generated id. */
        readonly id: string;
      }
    `);

    expect(component.members.map((entry) => entry.name)).toEqual(["label", "disabled", "id"]);
    expect(component.members.map((entry) => entry.optional)).toEqual([false, true, false]);
    expect(component.members.map((entry) => entry.readonly)).toEqual([false, false, true]);
    expect(member(component, "label").type).toBe("string");
  });

  it("keeps the type verbatim, collapsed to one line", () => {
    const component = sole(`
      /** @propsmith Button */
      export interface ButtonProps {
        /** The size. */
        size:
          | "small"
          | "medium";
      }
    `);

    // Verbatim means verbatim: the leading pipe the author wrote survives.
    expect(member(component, "size").type).toBe('| "small" | "medium"');
  });

  it("rebuilds a method signature into a usable function type", () => {
    const component = sole(`
      /** @propsmith List */
      export interface ListProps<T> {
        /** Called when a row is chosen. */
        onSelect?(item: T): void;
      }
    `);

    const onSelect = member(component, "onSelect");
    expect(onSelect.type).toBe("(item: T) => void");
    expect(onSelect.optional).toBe(true);
    expect(onSelect.readonly).toBe(false);
  });

  it("skips an index signature entirely", () => {
    const component = sole(`
      /** @propsmith Button */
      export interface ButtonProps {
        /** The label. */
        label: string;
        [key: string]: unknown;
      }
    `);

    expect(component.members.map((entry) => entry.name)).toEqual(["label"]);
  });

  it("unquotes a quoted key", () => {
    const component = sole(`
      /** @propsmith Button */
      export interface ButtonProps {
        /** An attribute that is not an identifier. */
        'quoted-key'?: string;
      }
    `);

    expect(component.members.map((entry) => entry.name)).toEqual(["quoted-key"]);
    expect(member(component, "quoted-key").optional).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("generics and declaration forms", () => {
  it("captures type parameters verbatim, constraint and default included", () => {
    const component = sole(`
      /** @propsmith List */
      export type ListProps<T, K extends keyof T = keyof T> = {
        /** The rows. */
        items: T[];
        /** The column to sort by. */
        sortBy?: K;
      };
    `);

    expect(component.typeParameters).toEqual(["T", "K extends keyof T = keyof T"]);
    expect(member(component, "items").type).toBe("T[]");
  });

  it("reads an interface exactly as it reads a type alias", () => {
    const body = `
      /** The label. */
      label: string;
      /** Whether it is disabled. */
      disabled?: boolean;
    `;
    const fromInterface = sole(`
      /** @propsmith Button */
      export interface ButtonProps {${body}}
    `);
    const fromAlias = sole(`
      /** @propsmith Button */
      export type ButtonProps = {${body}};
    `);

    expect(shapeOf(fromInterface)).toEqual(shapeOf(fromAlias));
    expect(shapeOf(fromInterface)).toEqual([
      ["label", "string", false, "The label."],
      ["disabled", "boolean", true, "Whether it is disabled."],
    ]);
  });
});

// ---------------------------------------------------------------------------

describe("@internal", () => {
  it("removes an internal member", () => {
    const component = sole(`
      /** @propsmith Button */
      export interface ButtonProps {
        /** The label. */
        label: string;
        /**
         * The shared pool.
         * @internal
         */
        __pool?: unknown;
      }
    `);

    expect(component.members.map((entry) => entry.name)).toEqual(["label"]);
  });

  it("removes the whole component, but leaves the declaration indexed", () => {
    const { components, declarations } = extract(`
      /**
       * Not for public use.
       * @propsmith Button
       * @internal
       */
      export interface ButtonProps {
        /** The label. */
        label: string;
      }
    `);

    expect(components).toEqual([]);
    expect(declarations.map((declaration) => declaration.name)).toEqual(["ButtonProps"]);
  });
});

// ---------------------------------------------------------------------------

describe("tags", () => {
  it("lands @default, @see and @type in their own fields", () => {
    const component = sole(`
      /** @propsmith Button */
      export interface ButtonProps {
        /**
         * The size.
         * @default "medium"
         * @see https://example.com/sizes
         */
        size?: string;
        /**
         * The click handler.
         * @type (event: MouseEvent) => void
         */
        onClick?: unknown;
      }
    `);

    const size = member(component, "size");
    expect(size.defaultValue).toBe('"medium"');
    expect(size.see).toBe("https://example.com/sizes");

    const onClick = member(component, "onClick");
    expect(onClick.typeOverride).toBe("(event: MouseEvent) => void");
    // The override is recorded beside the real type, never in place of it.
    expect(onClick.type).toBe("unknown");
  });

  it("reads @deprecated as its reason, or as true when bare", () => {
    const component = sole(`
      /** @propsmith Button */
      export interface ButtonProps {
        /**
         * The old headers.
         * @deprecated use \`headerList\` instead
         */
        headers?: string;
        /**
         * The old label.
         * @deprecated
         */
        caption?: string;
        /** The current label. */
        label?: string;
      }
    `);

    expect(member(component, "headers").deprecated).toBe("use `headerList` instead");
    expect(member(component, "caption").deprecated).toBe(true);
    expect(member(component, "label").deprecated).toBeUndefined();
  });

  it("carries an undeclared tag into flags without duplicating the structural ones", () => {
    const component = sole(`
      /** @propsmith Button */
      export interface ButtonProps {
        /**
         * The size.
         * @default "medium"
         * @see https://example.com/sizes
         * @experimental sizing is not final
         */
        size?: string;
      }
    `);

    const size = member(component, "size");
    // A tag propsmith has never heard of still reaches a custom renderer, while
    // the tags with a field of their own are not carried twice.
    expect(size.flags).toEqual({ experimental: "sizing is not final" });
    expect(size.defaultValue).toBe('"medium"');
  });

  it("turns a bare declared tag into true, and a declared structural tag into a flag too", () => {
    const component = sole(
      `
      /** @propsmith Button */
      export interface ButtonProps {
        /**
         * The value.
         * @bindable
         */
        value?: string;
        /**
         * The old label.
         * @deprecated use \`value\`
         */
        caption?: string;
      }
    `,
      { tags: { bindable: "badge", deprecated: "column" } },
    );

    expect(member(component, "value").flags).toEqual({ bindable: true });
    // Declaring `deprecated` is how you get the column as well as the
    // strikethrough, so here it is allowed into flags on purpose.
    expect(member(component, "caption").flags).toEqual({ deprecated: "use `value`" });
    expect(member(component, "caption").deprecated).toBe("use `value`");
  });
});

// ---------------------------------------------------------------------------

describe("intersections and heritage", () => {
  it("expands Pick into its literal keys", () => {
    const component = sole(`
      /** @propsmith Card */
      export type CardProps = {
        /** The body. */
        children: unknown;
      } & Pick<FSInput, 'a' | 'b'>;
    `);

    expect(component.extras).toHaveLength(1);
    expect(component.extras[0]!.kind).toBe("pick");
    expect(component.extras[0]!.keys).toEqual(["a", "b"]);
    expect(component.extras[0]!.origin).toBe("FSInput");
    expect(component.extras[0]!.label).toBe("`a`, `b` from `FSInput`");
  });

  it("expands Omit the same way", () => {
    const component = sole(`
      /** @propsmith Card */
      export type CardProps = {
        /** The body. */
        children: unknown;
      } & Omit<FSInput, 'a'>;
    `);

    expect(component.extras[0]!.kind).toBe("omit");
    expect(component.extras[0]!.keys).toEqual(["a"]);
  });

  it("reads the element out of an attributes type's name", () => {
    const component = sole(`
      /** @propsmith Button */
      export type ButtonProps = {
        /** The label. */
        label: string;
      } & HTMLButtonAttributes;
    `);

    expect(component.extras[0]!.kind).toBe("element-attributes");
    expect(component.extras[0]!.element).toBe("button");
    expect(component.extras[0]!.label).toBe("Element Attributes (`button`)");
  });

  it("prefers the type argument over the name when naming the element", () => {
    const component = sole(`
      /** @propsmith Card */
      export type CardProps = {
        /** The body. */
        children: unknown;
      } & HTMLAttributes<HTMLDivElement>;
    `);

    expect(component.extras[0]!.kind).toBe("element-attributes");
    expect(component.extras[0]!.element).toBe("div");
  });

  it("treats a type from a configured module as element attributes", () => {
    // `ButtonHTMLAttributes` is React's spelling, which the name test alone does
    // not recognise — only knowing it came from `react` makes this row.
    const code = `
      import type { ButtonHTMLAttributes } from "react";

      /** @propsmith Button */
      export type ButtonProps = {
        /** The label. */
        label: string;
      } & ButtonHTMLAttributes;
    `;

    const configured = sole(code, { elementAttributeModules: ["react"] });
    expect(configured.extras[0]!.kind).toBe("element-attributes");
    expect(configured.extras[0]!.element).toBe("button");

    const unconfigured = sole(code);
    expect(unconfigured.extras[0]!.kind).toBe("reference");
  });

  it("falls back to a reference for anything else", () => {
    const component = sole(`
      /** @propsmith Card */
      export type CardProps = {
        /** The body. */
        children: unknown;
      } & Themed;
    `);

    expect(component.extras[0]!.kind).toBe("reference");
    expect(component.extras[0]!.origin).toBe("Themed");
    expect(component.extras[0]!.label).toBe("`Themed`");
  });

  it("reads an interface's extends clause as branches", () => {
    const component = sole(`
      /** @propsmith Card */
      export interface CardProps extends Themed, HTMLAttributes<HTMLDivElement> {
        /** The body. */
        children: unknown;
      }
    `);

    expect(component.extras.map((extra) => extra.kind)).toEqual([
      "reference",
      "element-attributes",
    ]);
    expect(component.extras[1]!.element).toBe("div");
  });

  it("keeps every type name in a label inside a code span", () => {
    const component = sole(`
      /** @propsmith Card */
      export type CardProps = {
        /** The body. */
        children: unknown;
      } & Pick<HTMLAttributes<HTMLDivElement>, 'className' | 'id'> &
        HTMLAttributes<HTMLDivElement> &
        Themed;
    `);

    for (const extra of component.extras) {
      // Bare, `HTMLAttributes<HTMLDivElement>` opens an HTML tag — the one thing
      // propsmith promises never to emit.
      expect(() => assertNoHtml(extra.label, "Card")).not.toThrow();
    }
    expect(component.extras[0]!.label).toContain("`HTMLAttributes<HTMLDivElement>`");
  });
});

// ---------------------------------------------------------------------------

describe("declarations", () => {
  it("reads a union as its values", () => {
    const { declarations } = extract(`
      export type Sizes =
        | "small"
        | "medium";
    `);

    expect(declarations[0]!.shape).toBe("union");
    expect(declarations[0]!.values).toEqual(['"small"', '"medium"']);
    expect(declarations[0]!.text).toBe('| "small" | "medium"');
    expect(declarations[0]!.keys).toBeUndefined();
  });

  it("reads an object as its keys, collapsed to one line", () => {
    const { declarations } = extract(`
      export interface BackoffPolicy {
        /** Where it starts. */
        initialDelayMs: number;
        /** How fast it grows. */
        factor: number;
      }
    `);

    expect(declarations[0]!.shape).toBe("object");
    expect(declarations[0]!.keys).toEqual(["initialDelayMs", "factor"]);
    expect(declarations[0]!.text).toBe(
      "{ /** Where it starts. */ initialDelayMs: number; /** How fast it grows. */ factor: number; }",
    );
    expect(declarations[0]!.values).toBeUndefined();
  });

  it("reads anything else as an alias", () => {
    const { declarations } = extract(`
      export type Handler = (event: Event) => void;
    `);

    expect(declarations[0]!.shape).toBe("alias");
    expect(declarations[0]!.text).toBe("(event: Event) => void");
    expect(declarations[0]!.keys).toBeUndefined();
    expect(declarations[0]!.values).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("diagnostics", () => {
  it("leaves an undocumented member to the run, which can still inherit one", () => {
    const { components, diagnostics } = extract(`
      /** @propsmith Button */
      export interface ButtonProps {
        /** The label. */
        label: string;
        disabled?: boolean;
      }
    `);

    // The type a prop borrows its description from usually lives in another
    // file, so only a run with the whole symbol index can say it has none.
    expect(diagnostics).toEqual([]);
    expect(components[0]!.members[1]!.description).toBe("");
  });

  it("stays quiet about a type that is not a component", () => {
    const { diagnostics } = extract(`
      export interface ButtonProps {
        disabled?: boolean;
      }
    `);

    expect(diagnostics).toEqual([]);
  });

  it("reports every @type override", () => {
    const { diagnostics } = extract(`
      /** @propsmith Button */
      export interface ButtonProps {
        /**
         * The click handler.
         * @type (event: MouseEvent) => void
         */
        onClick?: unknown;
        /**
         * The size.
         * @type "small" | "medium"
         */
        size?: string;
      }
    `);

    const overrides = diagnostics.filter((entry) => entry.code === "type-override-used");
    expect(overrides.map((entry) => entry.message)).toEqual([
      "ButtonProps.onClick overrides its type with @type",
      "ButtonProps.size overrides its type with @type",
    ]);
  });

  it("turns a syntax error into a diagnostic instead of throwing", () => {
    const broken = "export type Broken = {\n  label: string\n";

    expect(() => extract(broken)).not.toThrow();

    const { components, declarations, diagnostics } = extract(broken);
    expect(components).toEqual([]);
    expect(declarations).toEqual([]);
    expect(diagnostics.map((entry) => [entry.code, entry.severity])).toEqual([
      ["parse-error", "error"],
    ]);
    expect(diagnostics[0]!.file).toBe(FILE);
  });
});

// ---------------------------------------------------------------------------

describe("offset", () => {
  /**
   * A `.svelte` file's script is handed over on its own, so without the offset
   * every diagnostic would point at the top of the file instead of the real line.
   */
  const script = [
    "/** @propsmith Button */",
    "export interface ButtonProps {",
    "  /** The label. */",
    "  label: string;",
    "}",
    "",
  ].join("\n");
  const svelte = `<script lang="ts" module>\n${script}</script>\n\n<button>hi</button>\n`;

  it("points at the line in the original file, not in the extracted script", () => {
    const component = sole(script, {
      filePath: "/src/Button.svelte",
      offset: svelte.indexOf(script),
      originalSource: svelte,
    });

    expect(component.source).toEqual({ file: "/src/Button.svelte", line: 3, column: 8 });
    expect(member(component, "label").source).toEqual({
      file: "/src/Button.svelte",
      line: 5,
      column: 3,
    });
  });

  it("points one line higher with no offset, which is what the offset corrects", () => {
    const component = sole(script);

    expect(component.source.line).toBe(2);
    expect(member(component, "label").source.line).toBe(4);
  });
});
