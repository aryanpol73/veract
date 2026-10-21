import { describe, it, expect, beforeEach } from "vitest";
import {
  canonicalize,
  computePayloadHash,
  createAttestationReceipt,
  verifyAttestation,
  type AttestationPayload,
} from "../attestation.js";
import { BatchStore } from "../../store/batchStore.js";

describe("Phase 5: SHA-256 Attestation & Batch Tamper Detection", () => {
  const samplePayload: AttestationPayload = {
    batchId: "batch_001",
    merchantId: "merch_alpha",
    totalAmount: 145000,
    currency: "USD",
    transactionIds: ["tx_3", "tx_1", "tx_2"],
    settledAt: "2026-10-21T14:30:00.000Z",
    metadata: { region: "us-east", tier: "enterprise" },
  };

  describe("Canonical Serialization & Deterministic Hashing", () => {
    it("produces identical hashes regardless of object key order or transactionId order", () => {
      const reorderedPayload: AttestationPayload = {
        currency: "USD",
        totalAmount: 145000,
        settledAt: "2026-10-21T14:30:00.000Z",
        transactionIds: ["tx_1", "tx_2", "tx_3"],
        batchId: "batch_001",
        metadata: { tier: "enterprise", region: "us-east" },
        merchantId: "merch_alpha",
      };

      const hash1 = computePayloadHash(samplePayload);
      const hash2 = computePayloadHash(reorderedPayload);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("canonicalizes nested structures deterministically", () => {
      const a = { b: 1, a: { z: 9, y: 8 } };
      const b = { a: { y: 8, z: 9 }, b: 1 };
      expect(canonicalize(a)).toBe(canonicalize(b));
    });
  });

  describe("Attestation Verification & Tamper Detection", () => {
    it("validates an untampered payload and receipt", () => {
      const receipt = createAttestationReceipt(samplePayload);
      const result = verifyAttestation(samplePayload, receipt);

      expect(receipt.receiptId).toMatch(/^rcpt_[a-f0-9]{20}$/);
      expect(receipt.algorithm).toBe("SHA-256");
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("detects tampering when totalAmount is modified", () => {
      const receipt = createAttestationReceipt(samplePayload);
      const tamperedPayload: AttestationPayload = {
        ...samplePayload,
        totalAmount: 145001, // +1 cent manipulation
      };

      const result = verifyAttestation(tamperedPayload, receipt);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("PAYLOAD_TAMPERED");
    });

    it("detects tampering when a transactionId is injected or removed", () => {
      const receipt = createAttestationReceipt(samplePayload);
      const tamperedPayload: AttestationPayload = {
        ...samplePayload,
        transactionIds: ["tx_1", "tx_2", "tx_3", "tx_rogue"],
      };

      const result = verifyAttestation(tamperedPayload, receipt);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("PAYLOAD_TAMPERED");
    });

    it("detects tampering when settledAt timestamp is altered", () => {
      const receipt = createAttestationReceipt(samplePayload);
      const tamperedPayload: AttestationPayload = {
        ...samplePayload,
        settledAt: "2026-10-21T14:30:01.000Z",
      };

      const result = verifyAttestation(tamperedPayload, receipt);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("PAYLOAD_TAMPERED");
    });

    it("detects forged signatures when an attacker recomputes payloadHash without the secret", () => {
      const receipt = createAttestationReceipt(samplePayload, "server-secret-key");
      const tamperedPayload: AttestationPayload = {
        ...samplePayload,
        totalAmount: 999999,
      };

      // Attacker updates payloadHash to match tampered payload, but signs with wrong key
      const forgedReceipt = {
        ...receipt,
        payloadHash: computePayloadHash(tamperedPayload),
      };

      const result = verifyAttestation(tamperedPayload, forgedReceipt, "server-secret-key");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("SIGNATURE_INVALID");
    });
  });

  describe("BatchStore Receipt Attachment & Store-Level Tamper Auditing", () => {
    let store: BatchStore;

    beforeEach(() => {
      store = new BatchStore();
    });

    it("attaches receiptId and attestation to all settled batches", () => {
      store.createBatch({
        batchId: "batch_100",
        merchantId: "m_1",
        totalAmount: 5000,
        currency: "USD",
        transactionIds: ["t1", "t2"],
      });

      const settled = store.settleBatch("batch_100", "2026-10-21T15:00:00.000Z");

      expect(settled.status).toBe("SETTLED");
      expect(settled.receiptId).toBeDefined();
      expect(settled.receiptId).toMatch(/^rcpt_/);
      expect(settled.attestation?.receiptId).toBe(settled.receiptId);

      // Lookup by receiptId works
      const fetchedByReceipt = store.getBatchByReceiptId(settled.receiptId!);
      expect(fetchedByReceipt?.batchId).toBe("batch_100");
    });

    it("backfills receiptIds for legacy settled batches missing attestations", () => {
      const rawMap = store.getRawStoreForTesting();
      rawMap.set("batch_legacy", {
        batchId: "batch_legacy",
        totalAmount: 2500,
        currency: "EUR",
        transactionIds: ["t_legacy_1"],
        status: "SETTLED",
        createdAt: "2026-10-20T10:00:00.000Z",
        settledAt: "2026-10-20T12:00:00.000Z",
      });

      const backfilled = store.backfillSettledBatchReceipts();
      expect(backfilled).toHaveLength(1);
      expect(backfilled[0].receiptId).toMatch(/^rcpt_/);

      const verification = store.verifyBatchIntegrity("batch_legacy");
      expect(verification.valid).toBe(true);
    });

    it("flags store-level tampering when a settled batch record is mutated in place", () => {
      store.createBatch({
        batchId: "batch_200",
        totalAmount: 10000,
        currency: "USD",
        transactionIds: ["tx_a", "tx_b"],
      });
      store.settleBatch("batch_200");

      // Verify clean state first
      expect(store.verifyBatchIntegrity("batch_200").valid).toBe(true);

      // Simulate unauthorized direct mutation in database/memory store
      const rawBatch = store.getRawStoreForTesting().get("batch_200")!;
      rawBatch.totalAmount = 50000;

      const auditResult = store.verifyBatchIntegrity("batch_200");
      expect(auditResult.valid).toBe(false);
      expect(auditResult.reason).toBe("PAYLOAD_TAMPERED");
    });
  });
});
