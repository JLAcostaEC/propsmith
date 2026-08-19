/** Shared across the Svelte fixture, resolvable and short. */
export type Sizes = "small" | "medium" | "large";

/** Too long for a cell; belongs in the glossary. */
export type ButtonAnimation = {
  duration: number;
  easing: string;
  delay: number;
  fill: "none" | "forwards" | "both";
};
