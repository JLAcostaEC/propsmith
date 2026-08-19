/**
 * The symbol index.
 *
 * propsmith resolves type references syntactically, never with the TypeScript
 * checker: every exported alias and interface met while scanning is filed here
 * by name, and `renderType` asks for one by name when it meets a reference it
 * would otherwise print bare.
 *
 * The index is a flat, global namespace — the join between a reference and a
 * declaration is the name, never the path — so a later declaration of a name
 * replaces an earlier one.
 */

import type { TypeDeclaration } from "../types.js";

export interface SymbolIndex {
  /** Resolve a bare type name to its declaration, or undefined. */
  get(name: string): TypeDeclaration | undefined;
  add(decls: readonly TypeDeclaration[]): void;
}

/**
 * Build an index over zero or more declarations.
 *
 * Duplicate names are not an error here — the last declaration added wins, so
 * a caller may keep adding files as it discovers them.
 */
export function createSymbolIndex(decls?: readonly TypeDeclaration[]): SymbolIndex {
  const byName = new Map<string, TypeDeclaration>();

  const add = (next: readonly TypeDeclaration[]): void => {
    for (const decl of next) {
      byName.set(decl.name, decl);
    }
  };

  if (decls) add(decls);

  return {
    get: (name: string): TypeDeclaration | undefined => byName.get(name),
    add,
  };
}
