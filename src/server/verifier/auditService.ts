import { batchStore, type BatchRecord, BatchStore } from "../store/batchStore.js";
import { computePayloadHash, type AttestationPayload } from "./attestation.js";

export interface BatchAuditResult {
  batchId: string;
  receiptId?: string;
  status: string;
  valid: boolean;
  reason?: string;
  expectedHash?: string;
  computedHash?: string;
  auditedAt: string;
}

export interface SystemAuditReport {
  totalSettledBatches: number;
  verifiedCount: number;
  tamperedCount: number;
  overallStatus: "HEALTHY" | "COMPROMISED";
  auditedAt: string;
  results: BatchAuditResult[];
}

export class AuditService {
  private snapshots = new Map<string, BatchRecord>();

  constructor(private store: BatchStore = batchStore) {}

  /**
   * Verifies a single batch and returns both expected and live-computed SHA-256 hashes
   * so the UI/judges can visually see the hash mismatch during a tamper demo.
   */
  auditBatch(batchId: string): BatchAuditResult {
    const batch = this.store.getBatch(batchId);
    const auditedAt = new Date().toISOString();

    if (!batch) {
      return {
        batchId,
        status: "NOT_FOUND",
        valid: false,
        reason: "BATCH_NOT_FOUND",
        auditedAt,
      };
    }

    const integrity = this.store.verifyBatchIntegrity(batchId);

    let computedHash: string | undefined;
    if (batch.settledAt) {
      const currentPayload: AttestationPayload = {
        batchId: batch.batchId,
        merchantId: batch.merchantId,
        totalAmount: batch.totalAmount,
        currency: batch.currency,
        transactionIds: batch.transactionIds,
        settledAt: batch.settledAt,
        metadata: batch.metadata,
      };
      computedHash = computePayloadHash(currentPayload);
    }

    return {
      batchId: batch.batchId,
      receiptId: batch.receiptId,
      status: batch.status,
      valid: integrity.valid,
      reason: integrity.reason,
      expectedHash: batch.attestation?.payloadHash,
      computedHash,
      auditedAt,
    };
  }

  /**
   * Audits all settled batches across the system and produces an executive summary.
   */
  auditAllSettledBatches(): SystemAuditReport {
    const settled = this.store.getSettledBatches();
    const results = settled.map((b) => this.auditBatch(b.batchId));

    const verifiedCount = results.filter((r) => r.valid).length;
    const tamperedCount = results.length - verifiedCount;

    return {
      totalSettledBatches: results.length,
      verifiedCount,
      tamperedCount,
      overallStatus: tamperedCount === 0 ? "HEALTHY" : "COMPROMISED",
      auditedAt: new Date().toISOString(),
      results,
    };
  }

  /**
   * HACKATHON DEMO FEATURE: Simulates an unauthorized database/memory mutation
   * on a settled batch (e.g., inflating totalAmount or injecting a rogue transaction)
   * while saving a snapshot so it can be cleanly restored during the live pitch.
   */
  simulateTamperAttack(
    batchId: string,
    attackVector: {
      tamperedAmount?: number;
      injectedTransactionId?: string;
    },
  ): {
    attacked: boolean;
    beforeAmount?: number;
    afterAmount?: number;
    auditAfterAttack: BatchAuditResult;
  } {
    const rawStore = this.store.getRawStoreForTesting();
    const target = rawStore.get(batchId);

    if (!target || target.status !== "SETTLED") {
      throw new Error(`Cannot tamper with unsettled or missing batch: ${batchId}`);
    }

    // Save original clean snapshot if not already saved
    if (!this.snapshots.has(batchId)) {
      this.snapshots.set(batchId, JSON.parse(JSON.stringify(target)));
    }

    const beforeAmount = target.totalAmount;

    if (typeof attackVector.tamperedAmount === "number") {
      target.totalAmount = attackVector.tamperedAmount;
    } else {
      // Default demo attack: siphon/inflate by +50,000 units
      target.totalAmount = target.totalAmount + 50000;
    }

    if (attackVector.injectedTransactionId) {
      target.transactionIds.push(attackVector.injectedTransactionId);
    }

    return {
      attacked: true,
      beforeAmount,
      afterAmount: target.totalAmount,
      auditAfterAttack: this.auditBatch(batchId),
    };
  }

  /**
   * Restores a tampered batch back to its original attested state.
   */
  restoreTamperedBatch(batchId: string): BatchAuditResult {
    const snapshot = this.snapshots.get(batchId);
    if (!snapshot) {
      return this.auditBatch(batchId);
    }

    const rawStore = this.store.getRawStoreForTesting();
    rawStore.set(batchId, JSON.parse(JSON.stringify(snapshot)));
    this.snapshots.delete(batchId);

    return this.auditBatch(batchId);
  }
}

export const auditService = new AuditService();
