/** The tags a polymorphic button is allowed to render as. */
export type ButtonGenerics = "button" | "a" | "div";

/** The aria plumbing every control shares. */
export type AriaProps = {
  role: string;
  label: string;
  describedBy: string;
};
