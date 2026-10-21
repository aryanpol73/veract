// src/routes/ingest.ts
import express, { type Request, type Response } from "express";
import { scanLocalInvoices, type IngestedDocument } from "../services/ingestion.js";
import {
  evaluateGate1,
  evaluateGate2,
  evaluateGate3,
} from "../server/verifier/veractVerifier.js";
import type {
  CandidateExtraction,
  Gate1Report,
  Gate2Report,
  Gate3Report,
  LineItemCandidate,
} from "../shared/types.js";

export interface VerificationReport {
  passed: boolean;
  candidate: CandidateExtraction;
  gate1: Gate1Report;
  gate2: Gate2Report;
  gate3: Gate3Report;
}

/**
 * Normalizes raw worker extraction payload (or OCR output) into Veract's CandidateExtraction schema.
 */
export function normalizeExtractionPayload(
  rawText: string,
  payload: Record<string, any>,
): CandidateExtraction {
  const vendorName = String(payload.vendorName || payload.vendor || "Unknown Vendor");

  // Format date to ISO-8601 YYYY-MM-DD
  let invoiceDate = String(payload.invoiceDate || payload.issueDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) {
    const parsed = Date.parse(invoiceDate);
    if (!Number.isNaN(parsed)) {
      invoiceDate = new Date(parsed).toISOString().slice(0, 10);
    }
  }

  // Currency
  const currency: "USD" = "USD";

  // Stated total cents
  let statedTotalCents = 0;
  if (typeof payload.statedTotalCents === "number" && Number.isSafeInteger(payload.statedTotalCents)) {
    statedTotalCents = payload.statedTotalCents;
  } else if (typeof payload.totalAmount === "number") {
    statedTotalCents = Math.round(payload.totalAmount * 100);
  } else if (typeof payload.total === "number") {
    statedTotalCents = Math.round(payload.total * 100);
  }

  // Line items
  const lineItems: LineItemCandidate[] = [];
  if (Array.isArray(payload.lineItems)) {
    for (const item of payload.lineItems) {
      const description = String(item.description || item.desc || item.name || "Item");
      let amountCents = 0;
      if (typeof item.amountCents === "number" && Number.isSafeInteger(item.amountCents)) {
        amountCents = item.amountCents;
      } else if (typeof item.total === "number") {
        amountCents = Math.round(item.total * 100);
      } else if (typeof item.amount === "number") {
        amountCents = Math.round(item.amount * 100);
      } else if (typeof item.rate === "number" && typeof item.quantity === "number") {
        amountCents = Math.round(item.rate * item.quantity * 100);
      }
      lineItems.push({ description, amountCents });
    }
  }

  // Evidence quote: prioritize explicit quote; fallback to finding total anchor line from text
  let evidenceQuote = typeof payload.evidenceQuote === "string" ? payload.evidenceQuote : "";
  if (!evidenceQuote && rawText) {
    const lines = rawText.split(/[\r\n]+/);
    const candidateLine = lines.find(
      (l) => /total\s*due|subtotal|payment\s*terms/i.test(l) && l.trim().length >= 20,
    );
    if (candidateLine) {
      evidenceQuote = candidateLine.trim();
    } else {
      const longLine = lines.find((l) => l.trim().length >= 20);
      if (longLine) {
        evidenceQuote = longLine.trim();
      }
    }
  }

  return {
    vendorName,
    invoiceDate,
    currency,
    lineItems,
    statedTotalCents,
    evidenceQuote,
  };
}

/**
 * Executes Veract's 3-Gate Deterministic Verifier on a contract text & extraction payload.
 */
export function runThreeGateVerifier(
  contractText: string,
  payload: Record<string, any>,
): VerificationReport {
  const candidate = normalizeExtractionPayload(contractText, payload);
  const gate1 = evaluateGate1(candidate);
  const gate2 = evaluateGate2(contractText, candidate);
  const gate3 = evaluateGate3(candidate);
  const passed = gate1.passed && gate2.passed && gate3.passed;

  return {
    passed,
    candidate,
    gate1,
    gate2,
    gate3,
  };
}

const router = express.Router();

// 1. Trigger local directory scan manually or on boot
const handleScanLocal = async (_req: Request, res: Response) => {
  const docs: IngestedDocument[] = await scanLocalInvoices();
  const results = [];

  for (const doc of docs) {
    let verification: VerificationReport | null = null;
    if (doc.extractedPayload) {
      verification = runThreeGateVerifier(doc.rawSourceText, doc.extractedPayload);
    }

    results.push({
      id: doc.id,
      filename: doc.filename,
      status: verification
        ? verification.passed
          ? "VERIFIED"
          : "REJECTED_HALLUCINATION"
        : "QUEUED_FOR_VERIFICATION",
      verification: verification
        ? {
            passed: verification.passed,
            gates: {
              gate1_schema: verification.gate1.passed ? "PASS" : "FAIL",
              gate2_grounding: verification.gate2.passed ? "PASS" : "FAIL",
              gate3_semantic: verification.gate3.passed ? "PASS" : "FAIL",
            },
            failureDetails: !verification.passed
              ? {
                  gate1Errors: verification.gate1.errors,
                  gate2Failure: verification.gate2.failureCode,
                  gate3DeltaCents: verification.gate3.deltaCents,
                }
              : null,
          }
        : null,
    });
  }

  res.status(200).json({
    message: `Scanned ${docs.length} documents from data/invoices/`,
    batches: results,
  });
};

router.post("/api/batches/scan-local", handleScanLocal);
router.get("/api/batches/scan-local", handleScanLocal);

// 2. External Agent Webhook Ingestion
router.post("/api/batches/ingest", async (req: Request, res: Response) => {
  try {
    const { contractText, workerExtractionPayload, agentId, autoSettle } = req.body;

    if (!contractText || !workerExtractionPayload) {
      res.status(400).json({
        error: "Missing required fields: contractText and workerExtractionPayload",
      });
      return;
    }

    // Run through the 3-Gate Deterministic Verifier
    const verificationReport = runThreeGateVerifier(contractText, workerExtractionPayload);

    let settlementStatus = "NOT_TRIGGERED";
    if (verificationReport.passed) {
      settlementStatus = autoSettle ? "PAYPAL_PREAUTH_CAPTURED" : "PENDING";
    } else {
      settlementStatus = autoSettle ? "VOIDED_REJECTED" : "REJECTED_UNVERIFIED";
    }

    res.status(200).json({
      batchId: `batch_${Date.now()}`,
      agentId: agentId || "external-agent",
      verificationStatus: verificationReport.passed ? "VERIFIED" : "REJECTED_HALLUCINATION",
      gates: {
        gate1_schema: verificationReport.gate1.passed ? "PASS" : "FAIL",
        gate2_grounding: verificationReport.gate2.passed ? "PASS" : "FAIL",
        gate3_semantic: verificationReport.gate3.passed ? "PASS" : "FAIL",
      },
      failureDetails: !verificationReport.passed
        ? {
            gate1Errors: verificationReport.gate1.errors,
            gate2Failure: verificationReport.gate2.failureCode,
            gate3DeltaCents: verificationReport.gate3.deltaCents,
          }
        : null,
      settlementStatus,
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Ingestion pipeline failure" });
  }
});

export default router;
