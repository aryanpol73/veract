// src/server/verifier/veractVerifier.ts
// Pure TypeScript 3-Gate Deterministic Verifier (Zero LLM calls, Zero Floating-Point Math).
import { centsToUsdString, computeSettlement } from "../../shared/money.js";
import { computeCanonicalSha256 } from "../../shared/canonicalHash.js";
import { buildVeractCustomId } from "../paypal/paypalClient.js";
import { groundSpanWithFuzzyFallback } from "./fuzzyMatch.js";
import type {
  BatchVerificationSummary,
  CandidateExtraction,
  Gate1Report,
  Gate2Report,
  Gate3Report,
  TaskVerificationResult,
  VendorContractFixture,
} from "../../shared/types.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_QUOTE_CHARS = 20;

/**
 * Normalizes text via Unicode NFKC, unifies typographic quotes/dashes,
 * and collapses consecutive whitespace into single spaces.
 */
export function canonicalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Formats integer cents into both plain ("$1800.00") and comma-grouped ("$1,800.00") anchors.
 */
export function buildDollarAnchors(cents: number): readonly string[] {
  const plainUsd = centsToUsdString(cents); // e.g. "1800.00"
  const [dollarsPart, centsPart] = plainUsd.split(".");
  const commaDollars = (dollarsPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const plainAnchor = `$${plainUsd}`;
  const commaAnchor = `$${commaDollars}.${centsPart ?? "00"}`;
  return plainAnchor === commaAnchor ? [plainAnchor] : [plainAnchor, commaAnchor];
}

/**
 * Gate 1: Strict Schema, ISO Date, and Safe Integer Minor-Unit Check.
 */
export function evaluateGate1(candidate: CandidateExtraction): Gate1Report {
  const errors: string[] = [];

  if (typeof candidate.vendorName !== "string" || candidate.vendorName.trim().length < 2) {
    errors.push("vendorName must be a string of at least 2 characters");
  }

  if (typeof candidate.invoiceDate !== "string" || !ISO_DATE_RE.test(candidate.invoiceDate)) {
    errors.push(`invoiceDate must match YYYY-MM-DD, received: "${String(candidate.invoiceDate)}"`);
  } else {
    const parsedTime = Date.parse(`${candidate.invoiceDate}T00:00:00Z`);
    if (Number.isNaN(parsedTime)) {
      errors.push(`invoiceDate is not a valid calendar date: "${candidate.invoiceDate}"`);
    }
  }

  if (candidate.currency !== "USD") {
    errors.push(`currency must be "USD", received: "${String(candidate.currency)}"`);
  }

  if (!Array.isArray(candidate.lineItems) || candidate.lineItems.length === 0) {
    errors.push("lineItems must be a non-empty array");
  } else {
    candidate.lineItems.forEach((item, idx) => {
      if (typeof item.description !== "string" || item.description.trim().length < 2) {
        errors.push(`lineItems[${idx}].description must be at least 2 chars`);
      }
      if (
        typeof item.amountCents !== "number" ||
        !Number.isSafeInteger(item.amountCents) ||
        item.amountCents < 0
      ) {
        errors.push(`lineItems[${idx}].amountCents must be a non-negative safe integer`);
      }
    });
  }

  if (
    typeof candidate.statedTotalCents !== "number" ||
    !Number.isSafeInteger(candidate.statedTotalCents) ||
    candidate.statedTotalCents <= 0
  ) {
    errors.push("statedTotalCents must be a positive safe integer");
  }

  if (
    typeof candidate.evidenceQuote !== "string" ||
    candidate.evidenceQuote.trim().length < MIN_QUOTE_CHARS
  ) {
    errors.push(`evidenceQuote must be at least ${MIN_QUOTE_CHARS} characters`);
  }

  return {
    passed: errors.length === 0,
    errors,
  };
}

/**
 * Gate 2: Canonical Span-Offset Grounding & Dollar Anchor Verification.
 * Proves the LLM quote exists in the source document (exact or fuzzy OCR match >= 80%),
 * verifies vendor name grounding (fuzzy threshold >= 82%), and anchors the stated total.
 */
export function evaluateGate2(
  sourceDocument: string,
  candidate: CandidateExtraction,
): Gate2Report {
  const normSource = canonicalizeText(sourceDocument);
  const normQuote = canonicalizeText(candidate.evidenceQuote ?? "");
  const expectedAnchors =
    Number.isSafeInteger(candidate.statedTotalCents) && candidate.statedTotalCents > 0
      ? buildDollarAnchors(candidate.statedTotalCents)
      : [];

  // Ground vendor name if provided
  let vendorGrounding: Gate2Report["vendorGrounding"] | undefined;
  if (candidate.vendorName && candidate.vendorName.trim().length >= 2) {
    const vg = groundSpanWithFuzzyFallback(normSource, candidate.vendorName, 0.82);
    vendorGrounding = {
      matched: vg.matched,
      matchType: vg.matchType,
      matchedSpan: vg.matchedSpan,
      similarity: vg.similarity,
    };
  }

  if (normQuote.length < MIN_QUOTE_CHARS) {
    return {
      passed: false,
      startOffset: -1,
      endOffset: -1,
      normalizedQuote: normQuote,
      containsTotalAnchor: false,
      expectedAnchors,
      failureCode: "QUOTE_TOO_SHORT",
      matchType: "NONE",
      vendorGrounding,
    };
  }

  let startOffset = normSource.indexOf(normQuote);
  let matchType: "EXACT" | "FUZZY_OCR" | "NONE" = "EXACT";
  let similarity = 1.0;
  let matchedSpan = normQuote;

  if (startOffset === -1) {
    // Fallback: Sliding window fuzzy OCR matching for quote
    const fuzzyMatch = groundSpanWithFuzzyFallback(normSource, normQuote, 0.8);
    if (fuzzyMatch.matched && fuzzyMatch.matchedSpan) {
      startOffset = normSource.indexOf(fuzzyMatch.matchedSpan);
      matchType = "FUZZY_OCR";
      similarity = fuzzyMatch.similarity;
      matchedSpan = fuzzyMatch.matchedSpan;
    } else {
      return {
        passed: false,
        startOffset: -1,
        endOffset: -1,
        normalizedQuote: normQuote,
        containsTotalAnchor: false,
        expectedAnchors,
        failureCode: "SUBSTRING_NOT_FOUND",
        matchType: "NONE",
        similarity: fuzzyMatch.similarity,
        vendorGrounding,
      };
    }
  }

  const endOffset = startOffset + matchedSpan.length;
  const containsTotalAnchor = expectedAnchors.some(
    (anchor) => matchedSpan.includes(anchor) || normQuote.includes(anchor),
  );

  if (!containsTotalAnchor) {
    return {
      passed: false,
      startOffset,
      endOffset,
      normalizedQuote: normQuote,
      containsTotalAnchor: false,
      expectedAnchors,
      failureCode: "MISSING_TOTAL_ANCHOR",
      matchType,
      similarity,
      vendorGrounding,
    };
  }

  // Check vendor grounding result
  if (vendorGrounding && !vendorGrounding.matched) {
    return {
      passed: false,
      startOffset,
      endOffset,
      normalizedQuote: normQuote,
      containsTotalAnchor: true,
      expectedAnchors,
      failureCode: "VENDOR_GROUNDING_FAILED",
      matchType,
      similarity: vendorGrounding.similarity,
      vendorGrounding,
    };
  }

  return {
    passed: true,
    startOffset,
    endOffset,
    normalizedQuote: normQuote,
    containsTotalAnchor: true,
    expectedAnchors,
    matchType,
    similarity,
    vendorGrounding,
  };
}

/**
 * Gate 3: Minor-Unit Conservation Check (sum(lineItems) === statedTotalCents).
 */
export function evaluateGate3(candidate: CandidateExtraction): Gate3Report {
  const computedSumCents = (candidate.lineItems ?? []).reduce(
    (sum, item) => sum + (Number.isSafeInteger(item.amountCents) ? item.amountCents : 0),
    0,
  );
  const statedTotalCents = Number.isSafeInteger(candidate.statedTotalCents)
    ? candidate.statedTotalCents
    : 0;
  const deltaCents = computedSumCents - statedTotalCents;

  return {
    passed: deltaCents === 0 && statedTotalCents > 0,
    computedSumCents,
    statedTotalCents,
    deltaCents,
  };
}

/**
 * Runs all 3 deterministic gates on a single task.
 */
export function verifyTask(
  fixture: VendorContractFixture,
  candidate: CandidateExtraction = fixture.seededOutput,
): TaskVerificationResult {
  const gate1 = evaluateGate1(candidate);
  const gate2 = evaluateGate2(fixture.sourceDocument, candidate);
  const gate3 = evaluateGate3(candidate);

  const passed = gate1.passed && gate2.passed && gate3.passed;
  const billableCents = passed ? fixture.unitPriceCents : 0;

  return {
    taskId: fixture.taskId,
    title: fixture.title,
    vendorName: candidate.vendorName,
    passed,
    unitPriceCents: fixture.unitPriceCents,
    billableCents,
    gate1,
    gate2,
    gate3,
    candidate,
  };
}

/**
 * Evaluates a full batch of tasks, enforces integer-cent conservation,
 * and computes the RFC 8785 Canonical JSON SHA-256 digest + PayPal custom_id.
 */
export function verifyBatch(
  batchId: string,
  fixtures: readonly VendorContractFixture[],
  authorizedCents: number,
  centsPerTask = 200,
): BatchVerificationSummary {
  const results = fixtures.map((f) => verifyTask(f, f.seededOutput));
  const passedTasks = results.filter((r) => r.passed).length;
  const failedTasks = results.length - passedTasks;

  const settlement = computeSettlement(authorizedCents, passedTasks, centsPerTask);

  // Build canonical audit payload for deterministic SHA-256 hashing
  const auditPayload = {
    protocol: "veract-3gate/v1",
    batchId,
    authorizedCents: settlement.authorizedCents,
    capturedCents: settlement.capturedCents,
    releasedCents: settlement.releasedCents,
    centsPerTask,
    passedTasks,
    failedTasks,
    tasks: results.map((r) => ({
      taskId: r.taskId,
      passed: r.passed,
      billableCents: r.billableCents,
      gate1Passed: r.gate1.passed,
      gate2Passed: r.gate2.passed,
      gate2Span: [r.gate2.startOffset, r.gate2.endOffset],
      gate2Failure: r.gate2.failureCode ?? null,
      gate3Passed: r.gate3.passed,
      gate3DeltaCents: r.gate3.deltaCents,
    })),
  };

  const { canonicalJson, sha256 } = computeCanonicalSha256(auditPayload);
  const paypalCustomId = buildVeractCustomId(batchId, sha256);

  return {
    batchId,
    totalTasks: results.length,
    passedTasks,
    failedTasks,
    centsPerTask,
    authorizedCents: settlement.authorizedCents,
    capturedCents: settlement.capturedCents,
    releasedCents: settlement.releasedCents,
    auditSha256: sha256,
    canonicalAuditJson: canonicalJson,
    paypalCustomId,
    results,
  };
}
