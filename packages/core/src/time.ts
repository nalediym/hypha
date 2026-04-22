/**
 * Timestamp helpers. All times in Hypha are ISO 8601 UTC strings.
 *
 * Hypha is bitemporal. Four timestamps live on every stored record:
 *   - tx_created:     when Hypha first recorded the fact (system time)
 *   - tx_invalidated: when Hypha retracted or superseded it. NULL = currently believed.
 *   - valid_from:     when the fact started being true in the real world
 *   - valid_to:       when the fact stopped being true. NULL = still true.
 *
 * Adapters provide `at` (primary event time). The Store fills the bitemporal
 * quartet: tx_created = now, valid_from = at (unless adapter specifies otherwise).
 */

export type Iso8601 = string & { readonly __brand: 'Iso8601' };

export function now(): Iso8601 {
  return new Date().toISOString() as Iso8601;
}

export function iso(d: Date | string | number): Iso8601 {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${String(d)}`);
  }
  return date.toISOString() as Iso8601;
}

export function toEpochMs(t: Iso8601): number {
  return Date.parse(t);
}

export function fromEpochMs(ms: number): Iso8601 {
  return new Date(ms).toISOString() as Iso8601;
}

export interface TimeRange {
  from: Iso8601;
  to: Iso8601;
}

/**
 * Bitemporal coordinate for time-travel queries.
 *   - asOf:    transaction-time cutoff ("what did Hypha know on date X?")
 *   - validAt: valid-time point ("what was true on date Y?")
 * Both omitted = "currently believed, right now" — the default.
 */
export interface BitemporalCoord {
  asOf?: Iso8601;
  validAt?: Iso8601;
}
