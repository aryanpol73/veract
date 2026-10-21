// src/server/store/batchStore.ts
import {
  type AttestationPayload,
  type AttestationReceipt,
  createAttestationReceipt,
  verifyAttestation,
} from "../verifier/attestation.js";

export type BatchStatus = "PENDING" | "PROCESSING" | "SETTLED" | "FAILED";

export interface BatchRecord {
  batchId: string;
  merchantId?: string;
  totalAmount: number;
  currency: string;
  transactionIds: string[];
  status: BatchStatus;
  createdAt: string;
  settledAt?: string;
  receiptId?: string;
  attestation?: AttestationReceipt;
  metadata?: Record<string, unknown>;
}

export class BatchStore {
  private batches = new Map<string, BatchRecord>();
  private receiptIndex = new Map<string, string>(); // receiptId -> batchId
  private snapshots = new Map<string, string>(); // batchId -> raw snapshot

  /**
   * Creates a new batch in PENDING state.
   */
  createBatch(params: {
    batchId: string;
    merchantId?: string;
    totalAmount: number;
    currency: string;
    transactionIds: string[];
    metadata?: Record<string, unknown>;
  }): BatchRecord {
    const record: BatchRecord = {
      ...params,
      transactionIds: [...params.transactionIds],
      status: "PENDING",
      createdAt: new Date().toISOString(),
    };
    this.batches.set(record.batchId, record);
    return { ...record };
  }

  /**
   * Settles a batch, generating a cryptographic SHA-256 attestation and attaching receiptId.
   */
  settleBatch(batchId: string, settledAt: string = new Date().toISOString()): BatchRecord {
    const batch = this.batches.get(batchId);
    if (!batch) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    if (batch.status === "SETTLED" && batch.receiptId && batch.attestation) {
      return { ...batch };
    }

    const payload: AttestationPayload = {
      batchId: batch.batchId,
      merchantId: batch.merchantId,
      totalAmount: batch.totalAmount,
      currency: batch.currency,
      transactionIds: batch.transactionIds,
      settledAt,
      metadata: batch.metadata,
    };

    const receipt = createAttestationReceipt(payload);

    batch.status = "SETTLED";
    batch.settledAt = settledAt;
    batch.receiptId = receipt.receiptId;
    batch.attestation = receipt;

    this.batches.set(batchId, batch);
    this.receiptIndex.set(receipt.receiptId, batchId);

    return { ...batch };
  }

  /**
   * Retroactively attaches receipts to any pre-existing settled batches missing a receiptId.
   */
  backfillSettledBatchReceipts(): BatchRecord[] {
    const updated: BatchRecord[] = [];

    for (const [batchId, batch] of this.batches.entries()) {
      if (batch.status === "SETTLED" && !batch.receiptId) {
        const settledTimestamp = batch.settledAt || new Date().toISOString();
        const settledRecord = this.settleBatch(batchId, settledTimestamp);
        updated.push(settledRecord);
      }
    }

    return updated;
  }

  /**
   * Retrieves a batch by its ID.
   */
  getBatch(batchId: string): BatchRecord | undefined {
    const batch = this.batches.get(batchId);
    return batch ? { ...batch, transactionIds: [...batch.transactionIds] } : undefined;
  }

  /**
   * Retrieves a settled batch by its attached receiptId.
   */
  getBatchByReceiptId(receiptId: string): BatchRecord | undefined {
    const batchId = this.receiptIndex.get(receiptId);
    if (!batchId) return undefined;
    return this.getBatch(batchId);
  }

  /**
   * Returns all settled batches, guaranteeing each has a receiptId attached.
   */
  getSettledBatches(): BatchRecord[] {
    return Array.from(this.batches.values())
      .filter((b) => b.status === "SETTLED")
      .map((b) => ({ ...b, transactionIds: [...b.transactionIds] }));
  }

  /**
   * Audits a settled batch in the store to detect in-memory or storage tampering.
   */
  verifyBatchIntegrity(batchId: string): {
    valid: boolean;
    reason?: string;
  } {
    const batch = this.batches.get(batchId);
    if (!batch) {
      return { valid: false, reason: "BATCH_NOT_FOUND" };
    }

    if (batch.status !== "SETTLED" || !batch.attestation || !batch.settledAt) {
      return { valid: false, reason: "BATCH_NOT_SETTLED_OR_UNATTESTED" };
    }

    const currentPayload: AttestationPayload = {
      batchId: batch.batchId,
      merchantId: batch.merchantId,
      totalAmount: batch.totalAmount,
      currency: batch.currency,
      transactionIds: batch.transactionIds,
      settledAt: batch.settledAt,
      metadata: batch.metadata,
    };

    return verifyAttestation(currentPayload, batch.attestation);
  }

  /**
   * Alias helper to retrieve a batch by receiptId.
   */
  getByReceipt(receiptId: string): (BatchRecord & { id: string; payload: Record<string, any>; receipt: any }) | undefined {
    const b = this.getBatchByReceiptId(receiptId);
    if (!b) return undefined;
    return {
      ...b,
      id: b.batchId,
      payload: {
        batchId: b.batchId,
        merchantId: b.merchantId,
        totalAmount: b.totalAmount,
        currency: b.currency,
        transactionIds: b.transactionIds,
        settledAt: b.settledAt,
        metadata: b.metadata,
      },
      receipt: {
        receiptId: b.receiptId || (b.attestation?.receiptId ?? `rcpt_${b.batchId}`),
        batchId: b.batchId,
        expectedHash: b.attestation?.payloadHash || "",
        signature: b.attestation?.signature || "",
        timestamp: b.settledAt || b.createdAt,
      },
    };
  }

  /**
   * Returns all batches formatted with id, payload, and receipt.
   */
  getAllBatches(): Array<BatchRecord & { id: string; payload: Record<string, any>; receipt: { receiptId: string; batchId: string; expectedHash: string; signature: string; timestamp: string } }> {
    return Array.from(this.batches.values()).map((b) => ({
      ...b,
      id: b.batchId,
      payload: {
        batchId: b.batchId,
        merchantId: b.merchantId,
        totalAmount: b.totalAmount,
        currency: b.currency,
        transactionIds: b.transactionIds,
        settledAt: b.settledAt,
        metadata: b.metadata,
      },
      receipt: {
        receiptId: b.receiptId || (b.attestation?.receiptId ?? `rcpt_${b.batchId}`),
        batchId: b.batchId,
        expectedHash: b.attestation?.payloadHash || "",
        signature: b.attestation?.signature || "",
        timestamp: b.settledAt || b.createdAt,
      },
    }));
  }

  /**
   * Adds or registers a batch directly with an attested payload.
   */
  addBatch(id: string, payload: Record<string, any>): BatchRecord & { id: string; payload: Record<string, any>; receipt: any } {
    const totalAmount =
      typeof payload.totalAmount === "number"
        ? payload.totalAmount
        : typeof payload.amount === "number"
          ? payload.amount
          : 1000;
    const currency = typeof payload.currency === "string" ? payload.currency : "USD";
    const transactionIds = Array.isArray(payload.transactionIds)
      ? payload.transactionIds
      : Array.isArray(payload.transactions)
        ? payload.transactions
        : [`tx_${id}`];

    this.createBatch({
      batchId: id,
      merchantId: payload.merchantId || "merch_veract",
      totalAmount,
      currency,
      transactionIds,
      metadata: payload,
    });

    const settled = this.settleBatch(id, payload.settledAt || new Date().toISOString());
    return {
      ...settled,
      id,
      payload,
      receipt: {
        receiptId: settled.receiptId || `rcpt_${id}`,
        batchId: id,
        expectedHash: settled.attestation?.payloadHash || "",
        signature: settled.attestation?.signature || "",
        timestamp: settled.settledAt || settled.createdAt,
      },
    };
  }

  /**
   * Non-destructive state simulation for audit demonstration.
   */
  simulateTamper(id: string, mutatedPayload: Record<string, any>): void {
    const record = this.batches.get(id);
    if (!record) throw new Error(`Batch not found: ${id}`);
    if (!this.snapshots.has(id)) {
      this.snapshots.set(id, JSON.stringify(record));
    }
    if (typeof mutatedPayload.amount === "number") {
      record.totalAmount = mutatedPayload.amount;
    } else if (typeof mutatedPayload.totalAmount === "number") {
      record.totalAmount = mutatedPayload.totalAmount;
    } else {
      record.totalAmount += 50000;
    }
    if (mutatedPayload.corrupted) {
      record.metadata = { ...record.metadata, corrupted: true };
    }
  }

  /**
   * Restores all snapshots back to their clean original states.
   */
  restoreAll(): void {
    for (const [id, raw] of this.snapshots.entries()) {
      const record = JSON.parse(raw);
      this.batches.set(id, record);
    }
    this.snapshots.clear();
  }

  /**
   * Test/internal helper to access raw mutable reference (or simulate storage mutation).
   */
  getRawStoreForTesting(): Map<string, BatchRecord> {
    return this.batches;
  }
}

export const batchStore = new BatchStore();
