import type { Density, Undocumented, Variant } from "./tokens.js";

/** @propsmith Button */
export type ButtonProps = {
  /** The text on the button. */
  label: string;

  variant?: Variant;

  spacing?: Density | null;

  /** Its own sentence wins. */
  tone?: Variant;

  /** @inheritDoc Variant */
  fallback?: string;

  /** @inheritDoc Nowhere */
  broken?: string;

  shrug?: Undocumented;

  mystery?: string;

  /**
   * Visual style of the button.
   * @deprecated Use `variant` instead.
   */
  appearance?: string;
};
