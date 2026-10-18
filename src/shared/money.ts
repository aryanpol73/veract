// src/shared/money.ts
// Integer minor-unit (cents) helpers. Floating-point math on currency is forbidden.

export class MoneyError extends Error {
  override readonly name = "MoneyError";
}

const USD_DECIMAL_RE = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;
const MAX_SAFE_BIG = BigInt(Number.MAX_SAFE_INTEGER);

/** Asserts a value is a non-negative safe integer number of cents. */
export function assertCents(value: unknown, label = "cents"): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MoneyError(`${label} must be a non-negative safe integer, received: ${String(value)}`);
  }
}

/**
 * Parses a USD decimal string into integer cents without touching floats.
 * Accepts "10", "10.0", "10.00". Rejects negatives, exponents, >2 decimals, leading zeros.
 */
export function usdStringToCents(input: string): number {
  if (typeof input !== "string") {
    throw new MoneyError(`USD amount must be a string, received: ${typeof input}`);
  }
  const match = USD_DECIMAL_RE.exec(input.trim());
  if (!match) {
    throw new MoneyError(`Invalid USD amount string: "${input}"`);
  }
  const dollars = BigInt(match[1]!);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
  const cents = dollars * 100n + fraction;
  if (cents > MAX_SAFE_BIG) {
    throw new MoneyError(`USD amount exceeds safe integer range: "${input}"`);
  }
  return Number(cents);
}

/** Formats integer cents as a PayPal-compatible USD string, e.g. 600 -> "6.00". */
export function centsToUsdString(cents: number): string {
  assertCents(cents, "cents");
  const big = BigInt(cents);
  const dollars = big / 100n;
  const remainder = (big % 100n).toString().padStart(2, "0");
  return `${dollars.toString()}.${remainder}`;
}

/**
 * Asserts sum(parts) === totalCents exactly.
 * Used for Gate 3 (sum(lineItems) === statedTotalCents) and settlement
 * (authorized === captured + released).
 */
export function assertConservation(
  totalCents: number,
  parts: readonly number[],
  label = "conservation",
): void {
  assertCents(totalCents, `${label}.totalCents`);
  let sum = 0;
  parts.forEach((part, i) => {
    assertCents(part, `${label}.parts[${i}]`);
    sum += part;
    if (!Number.isSafeInteger(sum)) {
      throw new MoneyError(`${label}: running sum overflowed safe integer range`);
    }
  });
  if (sum !== totalCents) {
    throw new MoneyError(
      `${label} violated: sum(parts)=${sum}¢ !== total=${totalCents}¢ (diff ${sum - totalCents}¢)`,
    );
  }
}

export interface SettlementSplit {
  authorizedCents: number;
  capturedCents: number;
  releasedCents: number;
}

/** captured = passedCount * centsPerTask, released = authorized - captured, conservation enforced. */
export function computeSettlement(
  authorizedCents: number,
  passedCount: number,
  centsPerTask: number,
): SettlementSplit {
  assertCents(authorizedCents, "authorizedCents");
  assertCents(passedCount, "passedCount");
  assertCents(centsPerTask, "centsPerTask");
  const capturedCents = passedCount * centsPerTask;
  if (!Number.isSafeInteger(capturedCents) || capturedCents > authorizedCents) {
    throw new MoneyError(
      `Captured amount ${capturedCents}¢ exceeds authorized amount ${authorizedCents}¢`,
    );
  }
  const releasedCents = authorizedCents - capturedCents;
  assertConservation(authorizedCents, [capturedCents, releasedCents], "settlement");
  return { authorizedCents, capturedCents, releasedCents };
}
