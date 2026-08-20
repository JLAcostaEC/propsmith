import type { AriaProps, ButtonGenerics } from "./tokens.js";

/** Everything the rendered element itself accepts. */
export type PolymorphicProps<T> = {
  as: T;
  children: unknown;
};

/** @propsmith Polymorphic */
export type PolymorphicButtonProps = {
  /**
   * What the button renders as.
   *
   * The declared type is widened by the component's own generic, so the table
   * has to be told what the reader actually gets.
   *
   * @type {ButtonGenerics}
   */
  generic?: unknown;

  /** The tags accepted inline. @type {'button' | 'a' | 'div'} */
  literal?: unknown;

  /** Layout override. @type A CSS length */
  width?: number | string;
} &
  /** The element's own props. @type {PolymorphicProps<'span'>} */
  Omit<PolymorphicProps<"span">, "children"> &
  Omit<AriaProps, "describedBy">;
