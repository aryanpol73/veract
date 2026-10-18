// src/server/paypal/idempotency.ts
// Deterministic PayPal-Request-Id generation. Same logical operation => same header => PayPal dedupes retries.

import { createHash, createHmac } from "node:crypto";

export const PAYPAL_REQUEST_ID_LENGTH = 36;
const DEFAULT_NAMESPACE = "veract/v1";

export type PayPalOperation =
  | "orders.create"
  | "orders.authorize"
  | "authorizations.capture"
  | "authorizations.void";

export type IdempotencyPart = string | number;

export interface RequestIdOptions {
  /** If set, HMAC-SHA256 keyed digest is used (prevents request-id prediction). Otherwise plain SHA-256. */
  secret?: string;
  namespace?: string;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function validatePart(part: IdempotencyPart, index: number): void {
  if (typeof part === "string") {
    if (part.length === 0) throw new TypeError(`Idempotency part[${index}] must be a non-empty string`);
    return;
  }
  if (typeof part === "number" && Number.isSafeInteger(part)) return;
  throw new TypeError(`Idempotency part[${index}] must be a non-empty string or safe integer`);
}

/**
 * Derives a deterministic 36-char hex PayPal-Request-Id:
 * SHA-256(JSON.stringify([namespace, operation, ...parts])).slice(0, 36)
 * JSON array encoding gives unambiguous field boundaries (no "a:b"+"c" vs "a"+"b:c" collisions).
 */
export function generatePayPalRequestId(
  operation: PayPalOperation,
  parts: readonly IdempotencyPart[],
  options: RequestIdOptions = {},
): string {
  parts.forEach(validatePart);
  const material = JSON.stringify([options.namespace ?? DEFAULT_NAMESPACE, operation, ...parts]);
  const digest = options.secret
    ? createHmac("sha256", options.secret).update(material, "utf8").digest("hex")
    : sha256Hex(material);
  return digest.slice(0, PAYPAL_REQUEST_ID_LENGTH);
}
