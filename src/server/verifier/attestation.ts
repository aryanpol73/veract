import crypto from "node:crypto";

export interface AttestationPayload {
  batchId: string;
  merchantId?: string;
  totalAmount: number;
  currency: string;
  transactionIds: string[];
  settledAt: string; // ISO-8601 timestamp
  metadata?: Record<string, unknown>;
}

export interface AttestationReceipt {
  receiptId: string;
  batchId: string;
  payloadHash: string;
  algorithm: "SHA-256";
  issuedAt: string;
  signature: string;
}

const ATTESTATION_SECRET = process.env.ATTESTATION_SECRET || "phase5-default-verifier-secret-key";

/**
 * Recursively sorts object keys to guarantee deterministic JSON serialization
 * prior to hashing. Arrays preserve their exact element order.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    return `[${items.join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();

  const pairs = sortedKeys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
  return `{${pairs.join(",")}}`;
}

/**
 * Computes a deterministic SHA-256 hex digest of any payload.
 */
export function computePayloadDigest(payload: any): string {
  if (payload && Array.isArray(payload.transactionIds)) {
    payload = {
      ...payload,
      transactionIds: [...payload.transactionIds].sort(),
    };
  }
  const canonicalJson = canonicalize(payload);
  return crypto.createHash("sha256").update(canonicalJson, "utf8").digest("hex");
}

export function computePayloadHash(payload: AttestationPayload): string {
  return computePayloadDigest(payload);
}

export function generateReceipt(batchId: string, payloadDigest: string) {
  const hmac = crypto
    .createHmac("sha256", ATTESTATION_SECRET)
    .update(`${batchId}:${payloadDigest}`)
    .digest("hex");
  return {
    receiptId: `rcpt_${payloadDigest.slice(0, 12)}`,
    batchId,
    expectedHash: payloadDigest,
    signature: hmac,
    timestamp: new Date().toISOString(),
  };
}

export function verifySignature(batchId: string, digest: string, signature: string): boolean {
  const expectedHmac = crypto
    .createHmac("sha256", ATTESTATION_SECRET)
    .update(`${batchId}:${digest}`)
    .digest("hex");
  const bufA = Buffer.from(signature, "hex");
  const bufB = Buffer.from(expectedHmac, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generates an HMAC-SHA256 signature binding the receipt metadata and payload hash.
 */
export function signAttestation(
  receiptId: string,
  batchId: string,
  payloadHash: string,
  issuedAt: string,
  secret: string = ATTESTATION_SECRET,
): string {
  const message = `${receiptId}:${batchId}:${payloadHash}:${issuedAt}`;
  return crypto.createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

/**
 * Creates a verifiable SHA-256 attestation receipt for a settled batch.
 */
export function createAttestationReceipt(
  payload: AttestationPayload,
  secret: string = ATTESTATION_SECRET,
): AttestationReceipt {
  const payloadHash = computePayloadHash(payload);
  const issuedAt = new Date().toISOString();

  // Deterministic prefix derived from the payload hash + timestamp entropy
  const entropy = crypto.randomBytes(4).toString("hex");
  const receiptId = `rcpt_${payloadHash.slice(0, 12)}${entropy}`;

  const signature = signAttestation(receiptId, payload.batchId, payloadHash, issuedAt, secret);

  return {
    receiptId,
    batchId: payload.batchId,
    payloadHash,
    algorithm: "SHA-256",
    issuedAt,
    signature,
  };
}

/**
 * Validates a current batch state against its stored attestation receipt.
 * Detects payload mutation, hash mismatches, or forged signatures.
 */
export function verifyAttestation(
  currentPayload: AttestationPayload,
  receipt: AttestationReceipt,
  secret: string = ATTESTATION_SECRET,
): { valid: boolean; reason?: "BATCH_ID_MISMATCH" | "PAYLOAD_TAMPERED" | "SIGNATURE_INVALID" } {
  if (currentPayload.batchId !== receipt.batchId) {
    return { valid: false, reason: "BATCH_ID_MISMATCH" };
  }

  const recomputedHash = computePayloadHash(currentPayload);
  const hashBufferA = Buffer.from(recomputedHash, "hex");
  const hashBufferB = Buffer.from(receipt.payloadHash, "hex");

  if (
    hashBufferA.length !== hashBufferB.length ||
    !crypto.timingSafeEqual(hashBufferA, hashBufferB)
  ) {
    return { valid: false, reason: "PAYLOAD_TAMPERED" };
  }

  const expectedSignature = signAttestation(
    receipt.receiptId,
    receipt.batchId,
    receipt.payloadHash,
    receipt.issuedAt,
    secret,
  );

  const sigBufferA = Buffer.from(expectedSignature, "hex");
  const sigBufferB = Buffer.from(receipt.signature, "hex");

  if (
    sigBufferA.length !== sigBufferB.length ||
    !crypto.timingSafeEqual(sigBufferA, sigBufferB)
  ) {
    return { valid: false, reason: "SIGNATURE_INVALID" };
  }

  return { valid: true };
}
