import { Router, type Request, type Response } from "express";
import { batchStore } from "../store/batchStore.js";
import { auditService, runLedgerAudit } from "../verifier/auditService.js";
import {
  generateAnchorSnapshot,
  generateMerkleProof,
  verifyMerkleProof,
} from "../verifier/merkleAnchor.js";

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
  const ledger = runLedgerAudit();
  const report = auditService.auditAllSettledBatches();
  const statusCode = report.overallStatus === "HEALTHY" ? 200 : 409;
  return res.status(statusCode).json({
    ...ledger,
    ...report,
  });
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
 * GET /api/verifier/receipts/:receiptId AND GET /api/verifier/receipt/:receiptId
 * Looks up a batch and its cryptographic proof directly by receiptId.
 */
const handleReceiptLookup = (req: Request, res: Response) => {
  const receiptId = String(req.params.receiptId);
  const record = batchStore.getByReceipt(receiptId);

  if (!record) {
    return res.status(404).json({
      error: "RECEIPT_NOT_FOUND",
      message: `No settled batch found for receiptId: ${receiptId}`,
    });
  }

  const audit = auditService.auditBatch(record.id);

  return res.status(200).json({
    ...record,
    receipt: record.attestation ?? record.receipt,
    batch: {
      batchId: record.batchId,
      merchantId: record.merchantId,
      totalAmount: record.totalAmount,
      currency: record.currency,
      transactionCount: record.transactionIds.length,
      settledAt: record.settledAt,
    },
    verification: audit,
  });
};

attestationRouter.get("/receipts/:receiptId", handleReceiptLookup);
attestationRouter.get("/receipt/:receiptId", handleReceiptLookup);

/**
 * POST /api/verifier/batches/:batchId/simulate-tamper AND /simulate-tamper/:batchId
 * Live Hackathon Demo Endpoint: Mutates in-memory batch state to demonstrate
 * real-time SHA-256 tamper detection.
 */
const handleSimulateTamper = (req: Request, res: Response) => {
  try {
    const batchId = String(req.params.batchId);
    const { tamperedAmount, amount, injectedTransactionId } = req.body || {};

    const outcome = auditService.simulateTamperAttack(batchId, {
      tamperedAmount: typeof tamperedAmount === "number" ? tamperedAmount : amount,
      injectedTransactionId,
    });

    return res.status(200).json({
      status: "MUTATION_APPLIED",
      ...outcome,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tamper simulation failed";
    return res.status(400).json({ error: "SIMULATION_ERROR", message });
  }
};

attestationRouter.post("/batches/:batchId/simulate-tamper", handleSimulateTamper);
attestationRouter.post("/simulate-tamper/:batchId", handleSimulateTamper);

/**
 * POST /api/verifier/batches/:batchId/restore AND /restore
 * Restores demo batches back to their original valid state.
 */
const handleRestoreAll = (req: Request, res: Response) => {
  const batchId = req.params.batchId ? String(req.params.batchId) : undefined;
  if (batchId) {
    const restored = auditService.restoreTamperedBatch(batchId);
    return res.status(200).json(restored);
  }
  batchStore.restoreAll();
  const audit = runLedgerAudit();
  return res.status(200).json({ status: "LEDGER_RESTORED", audit });
};

attestationRouter.post("/batches/:batchId/restore", handleRestoreAll);
attestationRouter.post("/restore", handleRestoreAll);

/**
 * Phase 6 Endpoints: Merkle Tree Checkpoint & Inclusion Proof Export
 */
attestationRouter.get("/anchor", (_req: Request, res: Response) => {
  const snapshot = generateAnchorSnapshot();
  return res.status(200).json(snapshot);
});

attestationRouter.get("/merkle-anchor", (_req: Request, res: Response) => {
  const snapshot = generateAnchorSnapshot();
  return res.status(200).json(snapshot);
});

attestationRouter.get("/batches/:batchId/merkle-proof", (req: Request, res: Response) => {
  const batchId = String(req.params.batchId);
  const batches = batchStore.getAllBatches();
  const targetIndex = batches.findIndex((b) => b.id === batchId);

  if (targetIndex === -1) {
    return res.status(404).json({ error: "BATCH_NOT_FOUND", batchId });
  }

  const leaves = batches.map((b) => b.receipt.expectedHash);
  const proof = generateMerkleProof(leaves, targetIndex);
  if (!proof) {
    return res.status(500).json({ error: "PROOF_GENERATION_FAILED" });
  }

  const verified = verifyMerkleProof(proof.root, proof.leaf, proof.proof);
  return res.status(200).json({
    batchId,
    verified,
    ...proof,
  });
});

export default attestationRouter;
