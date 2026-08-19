import type { Dayjs } from "dayjs";

/**
 * Retry policy applied to a failed request.
 *
 * Short enough to be inlined straight into the table.
 */
export type Retry = "never" | "always" | "on-5xx";

/** Long enough to need the glossary rather than a cell. */
export type BackoffPolicy = {
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  jitter: boolean;
};

/** @propsmith HttpClient */
export type HttpClientOptions = {
  /** Base URL every request is resolved against. */
  baseUrl: string;

  /**
   * How the client reacts to a failed request.
   *
   * This second paragraph exists to prove only the first one reaches the table.
   */
  retry?: Retry;

  /** @default 30000 */
  timeoutMs?: number;

  /** How long to wait between retries. */
  backoff?: BackoffPolicy;

  /** Clock used for expiry checks. @see https://day.js.org/docs/en/parse/parse */
  now?: Dayjs;

  /** Deadline for the whole request, including retries. */
  deadline?: Dayjs;

  /**
   * Extra headers merged into every request.
   * @deprecated Use `defaultHeaders` instead. Removed in 3.0.
   */
  headers?: Record<string, string>;

  /** @default {} */
  defaultHeaders?: Record<string, string>;

  /**
   * Connection pool shared between clients.
   * @internal
   */
  __pool?: unknown;

  /** Called once per completed request. */
  onSettled?(status: number, elapsedMs: number): void;
};
