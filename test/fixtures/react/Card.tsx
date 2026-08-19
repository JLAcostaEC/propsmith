import type { HTMLAttributes, ReactNode } from "react";

/** Short enough to inline. */
export type Elevation = "flat" | "raised" | "floating";

/** @propsmith Card */
export type CardProps = {
  /** Heading shown at the top of the card. */
  title: string;

  /** How far the card appears to sit above the page. */
  elevation?: Elevation;

  /** Body content. */
  children?: ReactNode;

  /** @default false */
  interactive?: boolean;
} & Pick<HTMLAttributes<HTMLDivElement>, "className" | "id">;

/**
 * Generic on purpose: printing the type parameters verbatim is one of the three
 * hard cases the extractor has to survive.
 *
 * @propsmith List
 */
export type ListProps<T, K extends keyof T = keyof T> = {
  /** The rows to render. */
  items: T[];

  /** Which field identifies a row. */
  key?: K;

  /** Called when a row is chosen. */
  onSelect?(item: T, index: number): void;

  /** @default 0 */
  overscan?: number;
};

export function Card(props: CardProps): ReactNode {
  return props.children;
}
