/**
 * Labels for the summary rows an intersection produces.
 *
 * An intersection branch is not a prop, so its Name cell is *editorial*: the
 * reader is told what the branch contributes, not what the author typed. That
 * wording is the one piece of propsmith's output that is prose rather than
 * type text, so it is a template — the defaults below are English, and a
 * project that documents in another language, or simply words it differently,
 * replaces them through `types.extras.labels`.
 *
 * Two rules hold whatever the template says:
 *
 * - **Values go inside code spans, templates do not.** A type name is code and
 *   is rendered as such; the words around it are prose.
 * - **`Omit` is not `Pick` spelled differently.** `Pick` names the keys it
 *   keeps, so listing them *is* the row. `Omit` names the keys it removes, and
 *   what survives cannot be known syntactically — the row therefore leads with
 *   the origin and reads the keys as a subtraction.
 */

import type { ExtrasLabels } from "../types.js";
import { codeSpan, oneLine } from "./escape.js";

/** What a template may interpolate. A missing value renders as nothing. */
export interface ExtraLabelValues {
  /** The literal keys of a `Pick` / `Omit`, unquoted. */
  keys?: readonly string[];
  /** The type the keys are taken from, or the referenced type. */
  origin?: string;
  /** The DOM element an attributes type documents. */
  element?: string;
  /** The branch, verbatim as the author wrote it. */
  text?: string;
}

/**
 * The wording used when `types.extras.labels` says nothing.
 *
 * `Omit`'s phrasing is the whole reason this module exists: it used to borrow
 * `Pick`'s, which told the reader that `children` was what the branch
 * contributed when in fact it is the one thing it does not.
 */
export const DEFAULT_EXTRAS_LABELS: ExtrasLabels = {
  pick: "{keys} from {origin}",
  omit: "{origin} without {keys}",
  elementAttributes: "Element Attributes ({element})",
};

/** Which placeholders each template can actually fill. Config validates against this. */
export const EXTRAS_PLACEHOLDERS: Record<keyof ExtrasLabels, readonly string[]> = {
  pick: ["keys", "origin", "text"],
  omit: ["keys", "origin", "text"],
  elementAttributes: ["element", "origin", "text"],
};

/** `{keys}`, `{origin}`, `{element}`, `{text}`. */
const PLACEHOLDER = /\{(\w+)\}/g;

/** A parenthesised group whose content vanished with its placeholder. */
const EMPTY_PARENTHESES = /\(\s*\)/g;

/**
 * Fill a template, code-spanning every value.
 *
 * A placeholder with no value leaves nothing behind, and the parentheses that
 * were wrapping it — `Element Attributes ()` for an attributes type whose
 * element could not be read — go with it. A placeholder this module does not
 * know is left as written, so a typo is visible in the output instead of
 * silently swallowing the row.
 */
export function formatExtraLabel(template: string, values: ExtraLabelValues): string {
  const filled = template.replace(PLACEHOLDER, (match, name: string) => {
    const value = valueOf(name, values);
    return value === undefined ? match : value;
  });

  return tidy(filled);
}

function valueOf(name: string, values: ExtraLabelValues): string | undefined {
  switch (name) {
    case "keys": {
      const keys = values.keys ?? [];
      const spans: string[] = [];
      for (const key of keys) {
        const span = codeSpan(key);
        if (span !== "") spans.push(span);
      }
      return spans.join(", ");
    }
    case "origin":
      return codeSpan(values.origin ?? "");
    case "element":
      return codeSpan(values.element ?? "");
    case "text":
      return codeSpan(values.text ?? "");
    default:
      return undefined;
  }
}

function tidy(label: string): string {
  return oneLine(label.replace(EMPTY_PARENTHESES, ""));
}
