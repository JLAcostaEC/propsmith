import { describe, expect, it } from "vitest";

import { replaceRegions, scanRegions } from "../src/markers/index.js";

const FILE = "docs.md";

function scan(source: string) {
  return scanRegions(FILE, source);
}

describe("scanning", () => {
  it("finds a paired region and its body", () => {
    const { regions, diagnostics } = scan(
      "# T\n\n<!-- props:Button -->\n\nrow\n\n<!-- /props:Button -->\n",
    );

    expect(diagnostics).toEqual([]);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.name).toBe("Button");
    expect(regions[0]!.kind).toBe("component");
    expect(regions[0]!.body).toBe("row");
  });

  it("accepts tight markers, namespaces and built-in regions", () => {
    const { regions } = scan(
      "<!--props:shared/Button-->\n<!--/props:shared/Button-->\n" +
        "<!-- props:@types -->\n<!-- /props:@types -->\n",
    );

    expect(regions.map((r) => [r.name, r.kind])).toEqual([
      ["shared/Button", "component"],
      ["@types", "builtin"],
    ]);
  });

  it("is blind to markers inside a fenced code block", () => {
    const source =
      "````md\n```md\n<!-- props:Fake -->\n```\n````\n\n~~~\n<!-- props:AlsoFake -->\n~~~\n";
    const { regions, diagnostics } = scan(source);

    expect(regions).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it("reports an unpaired opening marker but still returns the region", () => {
    const { regions, diagnostics } = scan("<!-- props:Button -->\n\ntext after\n");

    expect(diagnostics.map((d) => d.code)).toEqual(["unpaired-marker"]);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.closeStart).toBeUndefined();
  });

  it("reports a mismatched close and a duplicate open", () => {
    expect(scan("<!-- props:A -->\n<!-- /props:B -->\n").diagnostics.map((d) => d.code)).toContain(
      "mismatched-marker",
    );
    expect(
      scan(
        "<!-- props:A -->\n<!-- /props:A -->\n<!-- props:A -->\n<!-- /props:A -->\n",
      ).diagnostics.map((d) => d.code),
    ).toContain("duplicate-marker");
  });
});

const filled = (eol: string): string =>
  ["<!-- props:A -->", "", "| a |", "| - |", "", "<!-- /props:A -->", ""].join(eol);

describe("writing", () => {
  it("is idempotent on LF and on CRLF, preserving the file's endings", () => {
    for (const eol of ["\n", "\r\n"]) {
      const source = filled(eol);
      const region = scan(source).regions[0]!;
      const once = replaceRegions(source, [{ region, body: "| a |\n| - |" }]);

      expect(once.changed).toBe(false);
      expect(once.text).toBe(source);
      if (eol === "\r\n") expect(once.text).toContain("\r\n");
    }
  });

  it("preserves a missing trailing newline", () => {
    const source = "<!-- props:A -->\n\nold\n\n<!-- /props:A -->";
    const region = scan(source).regions[0]!;
    const result = replaceRegions(source, [{ region, body: "new" }]);

    expect(result.changed).toBe(true);
    expect(result.text.endsWith("\n")).toBe(false);
    expect(result.text).toContain("new");
  });

  it("completes a lone opening marker without swallowing what follows", () => {
    const source = "<!-- props:A -->\n\nprose that must survive\n";
    const region = scan(source).regions[0]!;
    const result = replaceRegions(source, [{ region, body: "| a |" }]);

    expect(result.text).toContain("<!-- /props:A -->");
    expect(result.text).toContain("prose that must survive");
  });

  it("applies several regions in one file", () => {
    const source =
      "<!-- props:A -->\n\nx\n\n<!-- /props:A -->\n\n<!-- props:B -->\n\ny\n\n<!-- /props:B -->\n";
    const { regions } = scan(source);
    const result = replaceRegions(
      source,
      regions.map((region) => ({ region, body: `${region.name}!` })),
    );

    expect(result.text).toContain("A!");
    expect(result.text).toContain("B!");
  });
});
