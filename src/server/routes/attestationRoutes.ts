import { Router, type Request, type Response } from "express";
import { batchStore } from "../store/batchStore.js";
import { auditService } from "../verifier/auditService.js";

export const attestationRouter = Router();

// Seed initial settled batches for hackathon live demo if empty
if (batchStore.getSettledBatches().length === 0) {
  batchStore.createBatch({
    batchId: "batch_demo_alpha",
    merchantId: "merch_veract_core",
    totalAmount: 189000,
    currency: "USD",
    transactionIds: ["tx_ord_902a_1", "tx_ord_902a_2", "tx_ord_902a_3"],
    metadata: { vendor: "Global Tech Solutions LLC", ocrVerification: "PASSED" },
  });
  batchStore.settleBatch("batch_demo_alpha", "2026-10-21T18:00:00.000Z");

  batchStore.createBatch({
    batchId: "batch_demo_beta",
    merchantId: "merch_veract_core",
    totalAmount: 100000,
    currency: "USD",
    transactionIds: ["tx_ord_771x_1"],
    metadata: { vendor: "Acme Cloud Corp", autoSettled: true },
  });
  batchStore.settleBatch("batch_demo_beta", "2026-10-21T18:05:00.000Z");
}

/**
 * GET /api/verifier/audit
 * Runs a full cryptographic audit across all settled batches.
 */
attestationRouter.get("/audit", (_req: Request, res: Response) => {
  const report = auditService.auditAllSettledBatches();
  const statusCode = report.overallStatus === "HEALTHY" ? 200 : 409;
  return res.status(statusCode).json(report);
});

/**
 * GET /api/verifier/batches/:batchId/verify
 * Verifies a specific batch and returns expected vs computed SHA-256 hashes.
 */
attestationRouter.get("/batches/:batchId/verify", (req: Request, res: Response) => {
  const batchId = String(req.params.batchId);
  const result = auditService.auditBatch(batchId);

  if (result.reason === "BATCH_NOT_FOUND") {
    return res.status(404).json(result);
  }

  return res.status(result.valid ? 200 : 409).json(result);
});

/**
 * GET /api/verifier/receipts/:receiptId
 * Looks up a batch and its cryptographic proof directly by receiptId.
 */
attestationRouter.get("/receipts/:receiptId", (req: Request, res: Response) => {
  const receiptId = String(req.params.receiptId);
  const batch = batchStore.getBatchByReceiptId(receiptId);

  if (!batch) {
    return res.status(404).json({
      error: "RECEIPT_NOT_FOUND",
      message: `No settled batch found for receiptId: ${receiptId}`,
    });
  }

  const audit = auditService.auditBatch(batch.batchId);

  return res.status(200).json({
    receipt: batch.attestation,
    batch: {
      batchId: batch.batchId,
      merchantId: batch.merchantId,
      totalAmount: batch.totalAmount,
      currency: batch.currency,
      transactionCount: batch.transactionIds.length,
      settledAt: batch.settledAt,
    },
    verification: audit,
  });
});

/**
 * POST /api/verifier/batches/:batchId/simulate-tamper
 * Live Hackathon Demo Endpoint: Mutates in-memory batch state to demonstrate
 * real-time SHA-256 tamper detection.
 */
attestationRouter.post("/batches/:batchId/simulate-tamper", (req: Request, res: Response) => {
  try {
    const batchId = String(req.params.batchId);
    const { tamperedAmount, injectedTransactionId } = req.body || {};

    const outcome = auditService.simulateTamperAttack(batchId, {
      tamperedAmount,
      injectedTransactionId,
    });

    return res.status(200).json(outcome);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tamper simulation failed";
    return res.status(400).json({ error: "SIMULATION_ERROR", message });
  }
});

/**
 * POST /api/verifier/batches/:batchId/restore
 * Restores a tampered demo batch back to its original valid state.
 */
attestationRouter.post("/batches/:batchId/restore", (req: Request, res: Response) => {
  const batchId = String(req.params.batchId);
  const restoredAudit = auditService.restoreTamperedBatch(batchId);
  return res.status(200).json(restoredAudit);
});

export default attestationRouter;
