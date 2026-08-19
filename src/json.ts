/**
 * JSON reading that tolerates a byte order mark.
 *
 * Every JSON propsmith reads comes from somewhere it does not control: a
 * lockfile, an inlang settings file, a message catalog, a `package.json`. On
 * Windows plenty of tools — PowerShell's `Set-Content` among them — write UTF-8
 * with a BOM by default, and `JSON.parse` rejects it with
 * `Unexpected token '﻿'`, a message that names neither the file nor the
 * real cause.
 *
 * The BOM is not part of the document. Dropping it is what every other JSON
 * reader in the ecosystem does.
 */

/** The BOM as it arrives once the bytes have been decoded as UTF-8. */
const BOM = 0xfeff;

export function stripBom(text: string): string {
  return text.charCodeAt(0) === BOM ? text.slice(1) : text;
}

/** `JSON.parse`, minus the BOM. Throws exactly what `JSON.parse` would. */
export function parseJson(text: string): unknown {
  return JSON.parse(stripBom(text)) as unknown;
}
