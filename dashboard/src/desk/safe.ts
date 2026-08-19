/**
 * Readers for fields that may be absent from a payload.
 *
 * A response can be missing a field for reasons that have nothing to do with a
 * bug in the caller: an older API build, or — more often — a cached response
 * persisted before the field existed being replayed on mount. The screen should
 * show a dash and carry on, never throw.
 *
 * Note that `data?.a.b` does not protect against this. Optional chaining
 * short-circuits the whole chain only when `data` itself is nullish; if `data`
 * is present and `a` is missing, reading `b` still throws.
 */
export function optionalNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A count for display: the number, or a dash when it was not reported. */
export function countLabel(value: number | null | undefined): string {
  const parsed = optionalNumber(value);
  return parsed === null ? '—' : String(parsed);
}

/** `3 / 10`, degrading to `3 / —` when the limit is missing. */
export function ratioLabel(value: number | null | undefined, limit: number | null | undefined): string {
  return `${countLabel(value)} / ${countLabel(limit)}`;
}

/** True only when both sides are known and the value has reached the limit. */
export function atLeast(value: number | null | undefined, limit: number | null | undefined): boolean {
  const left = optionalNumber(value);
  const right = optionalNumber(limit);
  return left !== null && right !== null && left >= right;
}

export function optionalText(value: string | null | undefined): string {
  return typeof value === 'string' ? value : '';
}
