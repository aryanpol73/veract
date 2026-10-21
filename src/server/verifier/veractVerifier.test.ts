// src/server/verifier/veractVerifier.test.ts
import { describe, it, expect } from "vitest";
import {
  canonicalizeText,
  buildDollarAnchors,
  evaluateGate1,
  evaluateGate2,
  evaluateGate3,
  verifyTask,
} from "./veractVerifier.js";
import { VERACT_DEMO_FIXTURES } from "../worker/fixtures.js";
import { runThreeGateVerifier } from "../../routes/ingest.js";
import { groundSpanWithFuzzyFallback, levenshteinDistance } from "./fuzzyMatch.js";
import type { CandidateExtraction } from "../../shared/types.js";

describe("Veract 3-Gate Deterministic Verifier", () => {
  describe("canonicalizeText & buildDollarAnchors", () => {
    it("normalizes unicode quotes, hyphens, and whitespace", () => {
      const input = "‘Hello’   “World” — $1,000.00 \n test";
      const normalized = canonicalizeText(input);
      expect(normalized).toBe("'Hello' \"World\" - $1,000.00 test");
    });

    it("builds plain and comma-grouped dollar anchors", () => {
      const anchors1800 = buildDollarAnchors(180000);
      expect(anchors1800).toContain("$1800.00");
      expect(anchors1800).toContain("$1,800.00");

      const anchors50 = buildDollarAnchors(5000);
      expect(anchors50).toEqual(["$50.00"]);
    });
  });

  describe("Gate 1: Schema & ISO Date", () => {
    const validCandidate: CandidateExtraction = {
      vendorName: "Apex Cloud Hosting LLC",
      invoiceDate: "2026-10-05",
      currency: "USD",
      lineItems: [{ description: "Cloud Node", amountCents: 50000 }],
      statedTotalCents: 50000,
      evidenceQuote: "Total obligation due upon receipt is $500.00 payable via PayPal.",
    };

    it("passes for valid candidate", () => {
      const report = evaluateGate1(validCandidate);
      expect(report.passed).toBe(true);
      expect(report.errors).toHaveLength(0);
    });

    it("fails when invoiceDate is invalid", () => {
      const report = evaluateGate1({ ...validCandidate, invoiceDate: "Oct 14, 2026" });
      expect(report.passed).toBe(false);
      expect(report.errors[0]).toContain("YYYY-MM-DD");
    });

    it("fails when statedTotalCents is non-integer or <= 0", () => {
      const report = evaluateGate1({ ...validCandidate, statedTotalCents: -100 });
      expect(report.passed).toBe(false);
      expect(report.errors[0]).toContain("positive safe integer");
    });
  });

  describe("Gate 2: Span Grounding & Dollar Anchor", () => {
    const sourceDoc = "Vendor: Apex Cloud LLC. Effective Date: 2026-10-05. Total payable amount is $500.00 upon receipt.";
    const candidate: CandidateExtraction = {
      vendorName: "Apex Cloud LLC",
      invoiceDate: "2026-10-05",
      currency: "USD",
      lineItems: [{ description: "Node", amountCents: 50000 }],
      statedTotalCents: 50000,
      evidenceQuote: "Total payable amount is $500.00 upon receipt.",
    };

    it("passes when quote is verbatim in source and contains total anchor", () => {
      const report = evaluateGate2(sourceDoc, candidate);
      expect(report.passed).toBe(true);
      expect(report.startOffset).toBeGreaterThanOrEqual(0);
      expect(report.containsTotalAnchor).toBe(true);
    });

    it("fails with SUBSTRING_NOT_FOUND when quote is hallucinated", () => {
      const report = evaluateGate2(sourceDoc, {
        ...candidate,
        evidenceQuote: "Client agrees to pay $500.00 within 30 days of invoice date.",
      });
      expect(report.passed).toBe(false);
      expect(report.failureCode).toBe("SUBSTRING_NOT_FOUND");
    });

    it("fails with MISSING_TOTAL_ANCHOR if quote lacks dollar anchor", () => {
      const noAnchorDoc = "Vendor: Apex Cloud LLC. Effective Date: 2026-10-05. Services rendered without specified cost here.";
      const report = evaluateGate2(noAnchorDoc, {
        ...candidate,
        evidenceQuote: "Services rendered without specified cost here.",
      });
      expect(report.passed).toBe(false);
      expect(report.failureCode).toBe("MISSING_TOTAL_ANCHOR");
    });

    it("fails with VENDOR_GROUNDING_FAILED when vendor is hallucinated", () => {
      const report = evaluateGate2(sourceDoc, {
        ...candidate,
        vendorName: "Wayne Enterprises International",
      });
      expect(report.passed).toBe(false);
      expect(report.failureCode).toBe("VENDOR_GROUNDING_FAILED");
    });
  });

  describe("Gate 3: Minor-Unit Cent Conservation", () => {
    it("passes when line items sum equals stated total", () => {
      const report = evaluateGate3({
        vendorName: "Test",
        invoiceDate: "2026-10-01",
        currency: "USD",
        statedTotalCents: 100000,
        lineItems: [
          { description: "Item 1", amountCents: 60000 },
          { description: "Item 2", amountCents: 40000 },
        ],
        evidenceQuote: "A quote of at least twenty characters",
      });
      expect(report.passed).toBe(true);
      expect(report.deltaCents).toBe(0);
    });

    it("fails when line items sum does not equal stated total", () => {
      const report = evaluateGate3({
        vendorName: "Test",
        invoiceDate: "2026-10-01",
        currency: "USD",
        statedTotalCents: 100000,
        lineItems: [
          { description: "Item 1", amountCents: 60000 },
          { description: "Item 2", amountCents: 35000 },
        ],
        evidenceQuote: "A quote of at least twenty characters",
      });
      expect(report.passed).toBe(false);
      expect(report.deltaCents).toBe(-5000);
    });
  });

  describe("Demo Fixtures 1-5 Gate Outcomes", () => {
    it("verifies expected pass/fail status for all 5 fixtures", () => {
      const results = VERACT_DEMO_FIXTURES.map((f) => verifyTask(f));
      expect(results[0].passed).toBe(true); // Task 101: PASS
      expect(results[1].passed).toBe(true); // Task 102: PASS
      expect(results[2].passed).toBe(false); // Task 103: FAILS Gate 2
      expect(results[2].gate2.failureCode).toBe("SUBSTRING_NOT_FOUND");
      expect(results[3].passed).toBe(true); // Task 104: PASS
      expect(results[4].passed).toBe(false); // Task 105: FAILS Gate 3
      expect(results[4].gate3.deltaCents).toBe(30000);
    });
  });

  describe("Messy OCR Ingestion Verification", () => {
    it("flags messy OCR payload with math mismatch in Gate 3", () => {
      const rawText = "INVOICE # 884-B \n TOTAL DUE: $3,078.00 \n Payment Terms: Net-30. Remit via PayPal Auth.";
      const messyPayload = {
        invoiceNumber: "884-B",
        vendorName: "Global Tech Solutions LLC",
        issueDate: "2026-10-14",
        currency: "USD",
        totalAmount: 3078.00,
        lineItems: [
          { description: "Cloud Compute Node (x4)", quantity: 2, total: 2400.00 },
          { description: "Support Tier - Gold", quantity: 1, total: 450.00 },
        ],
      };

      const result = runThreeGateVerifier(rawText, messyPayload);
      expect(result.passed).toBe(false);
      expect(result.gate1.passed).toBe(true);
      expect(result.gate3.passed).toBe(false);
      expect(result.gate3.deltaCents).toBe(-22800); // 2850.00 - 3078.00 = -$228.00
    });

    it("verifies messy_ocr_02_verified passes Gate 2 via fuzzy matching and Gate 3 arithmetic", () => {
      const rawText = "INVOICE # 902-A \n VENDOR: Gl0bal Tech Solut1ons LLC \n Date: Oct 20, '26 \n ----------------------------- \n ITEM | QTY | TOTAL \n Dedicated GPU Cluster | 1 | $1,500.00 \n Bandwidth Overage | 1 | $250.00 \n Sales Tax (8%) | 1 | $140.00 \n ----------------------------- \n TOTAL DUE: $1,890.00 \n Payment Terms: Net-15.";
      const verifiedPayload = {
        invoiceNumber: "902-A",
        vendorName: "Global Tech Solutions LLC",
        issueDate: "2026-10-20",
        currency: "USD",
        totalAmount: 1890.0,
        lineItems: [
          { description: "Dedicated GPU Cluster", quantity: 1, total: 1500.0 },
          { description: "Bandwidth Overage", quantity: 1, total: 250.0 },
          { description: "Sales Tax (8%)", quantity: 1, total: 140.0 },
        ],
      };

      const result = runThreeGateVerifier(rawText, verifiedPayload);
      expect(result.passed).toBe(true);
      expect(result.gate1.passed).toBe(true);
      expect(result.gate2.passed).toBe(true);
      expect(result.gate2.vendorGrounding?.matched).toBe(true);
      expect(result.gate2.vendorGrounding?.matchType).toBe("FUZZY_OCR");
      expect(result.gate3.passed).toBe(true);
      expect(result.gate3.deltaCents).toBe(0);
    });
  });

  describe("Fuzzy Span-Grounding Unit Tests", () => {
    it("computes exact edit distance for identical and substituted strings", () => {
      expect(levenshteinDistance("hello", "hello")).toBe(0);
      expect(levenshteinDistance("kitten", "sitting")).toBe(3);
    });

    it("grounds 'Global Tech Solutions LLC' against 'Gl0bal Tech Solut1ons LLC' with FUZZY_OCR", () => {
      const rawText = "Invoice received from Gl0bal Tech Solut1ons LLC on 2026-10-14";
      const match = groundSpanWithFuzzyFallback(rawText, "Global Tech Solutions LLC", 0.82);

      expect(match.matched).toBe(true);
      expect(match.matchType).toBe("FUZZY_OCR");
      expect(match.similarity).toBeGreaterThanOrEqual(0.82);
      expect(match.matchedSpan).toBe("Gl0bal Tech Solut1ons LLC");
    });

    it("rejects hallucinated vendor 'Stark Industries' with matched === false", () => {
      const rawText = "Invoice received from Gl0bal Tech Solut1ons LLC on 2026-10-14";
      const match = groundSpanWithFuzzyFallback(rawText, "Stark Industries", 0.82);

      expect(match.matched).toBe(false);
      expect(match.matchType).toBe("NONE");
    });
  });
});
