// src/shared/types.ts
// Shared domain types for Veract's 3-Gate Deterministic Verifier and Batch Settlement Pipeline.

export interface LineItemCandidate {
  readonly description: string;
  readonly amountCents: number;
}

export interface CandidateExtraction {
  readonly vendorName: string;
  readonly invoiceDate: string; // ISO-8601 YYYY-MM-DD
  readonly currency: "USD";
  readonly lineItems: readonly LineItemCandidate[];
  readonly statedTotalCents: number;
  readonly evidenceQuote: string;
}

export interface VendorContractFixture {
  readonly taskId: string;
  readonly title: string;
  readonly unitPriceCents: number;
  readonly sourceDocument: string;
  readonly seededOutput: CandidateExtraction;
}

export interface Gate1Report {
  readonly passed: boolean;
  readonly errors: readonly string[];
}

export type Gate2FailureCode =
  | "QUOTE_TOO_SHORT"
  | "SUBSTRING_NOT_FOUND"
  | "MISSING_TOTAL_ANCHOR";

export interface Gate2Report {
  readonly passed: boolean;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly normalizedQuote: string;
  readonly containsTotalAnchor: boolean;
  readonly expectedAnchors: readonly string[];
  readonly failureCode?: Gate2FailureCode;
}

export interface Gate3Report {
  readonly passed: boolean;
  readonly computedSumCents: number;
  readonly statedTotalCents: number;
  readonly deltaCents: number;
}

export interface TaskVerificationResult {
  readonly taskId: string;
  readonly title: string;
  readonly vendorName: string;
  readonly passed: boolean;
  readonly unitPriceCents: number;
  readonly billableCents: number;
  readonly gate1: Gate1Report;
  readonly gate2: Gate2Report;
  readonly gate3: Gate3Report;
  readonly candidate: CandidateExtraction;
}

export interface BatchVerificationSummary {
  readonly batchId: string;
  readonly totalTasks: number;
  readonly passedTasks: number;
  readonly failedTasks: number;
  readonly centsPerTask: number;
  readonly authorizedCents: number;
  readonly capturedCents: number;
  readonly releasedCents: number;
  readonly auditSha256: string;
  readonly canonicalAuditJson: string;
  readonly paypalCustomId: string;
  readonly results: readonly TaskVerificationResult[];
}
