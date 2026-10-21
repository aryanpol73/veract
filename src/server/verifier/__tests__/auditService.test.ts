import { describe, it, expect, beforeEach } from "vitest";
import { BatchStore } from "../../store/batchStore.js";
import { AuditService } from "../auditService.js";

describe("Phase 5B: AuditService & Live Tamper Simulation", () => {
  let store: BatchStore;
  let service: AuditService;

  beforeEach(() => {
    store = new BatchStore();
    service = new AuditService(store);

    store.createBatch({
      batchId: "batch_demo_1",
      merchantId: "merch_veract",
      totalAmount: 250000,
      currency: "USD",
      transactionIds: ["tx_101", "tx_102", "tx_103"],
    });
    store.settleBatch("batch_demo_1", "2026-10-21T15:00:00.000Z");

    store.createBatch({
      batchId: "batch_demo_2",
      merchantId: "merch_veract",
      totalAmount: 90000,
      currency: "USD",
      transactionIds: ["tx_201", "tx_202"],
    });
    store.settleBatch("batch_demo_2", "2026-10-21T15:05:00.000Z");
  });

  it("reports HEALTHY status when all settled batches are untampered", () => {
    const report = service.auditAllSettledBatches();

    expect(report.overallStatus).toBe("HEALTHY");
    expect(report.totalSettledBatches).toBe(2);
    expect(report.verifiedCount).toBe(2);
    expect(report.tamperedCount).toBe(0);
    expect(report.results[0].expectedHash).toBe(report.results[0].computedHash);
  });

  it("simulates a live tamper attack, exposes the SHA-256 hash mismatch, and flips system status to COMPROMISED", () => {
    const attackOutcome = service.simulateTamperAttack("batch_demo_1", {
      tamperedAmount: 999999,
      injectedTransactionId: "tx_malicious_999",
    });

    expect(attackOutcome.attacked).toBe(true);
    expect(attackOutcome.beforeAmount).toBe(250000);
    expect(attackOutcome.afterAmount).toBe(999999);
    expect(attackOutcome.auditAfterAttack.valid).toBe(false);
    expect(attackOutcome.auditAfterAttack.reason).toBe("PAYLOAD_TAMPERED");
    expect(attackOutcome.auditAfterAttack.expectedHash).not.toBe(
      attackOutcome.auditAfterAttack.computedHash,
    );

    const systemReport = service.auditAllSettledBatches();
    expect(systemReport.overallStatus).toBe("COMPROMISED");
    expect(systemReport.tamperedCount).toBe(1);
    expect(systemReport.verifiedCount).toBe(1);
  });

  it("cleanly restores a tampered batch back to its original verified state", () => {
    service.simulateTamperAttack("batch_demo_1", { tamperedAmount: 777777 });
    expect(service.auditBatch("batch_demo_1").valid).toBe(false);

    const restored = service.restoreTamperedBatch("batch_demo_1");
    expect(restored.valid).toBe(true);
    expect(restored.expectedHash).toBe(restored.computedHash);
    expect(store.getBatch("batch_demo_1")?.totalAmount).toBe(250000);
  });
});
