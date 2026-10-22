import { describe, it, expect, beforeEach } from "vitest";
import { batchStore } from "../../store/batchStore.js";
import { sentinelService } from "../sentinelService.js";

describe("Phase 7: Sentinel Watchtower & Compliance Certificates", () => {
  beforeEach(() => {
    batchStore.restoreAll();
    sentinelService.setAutoHeal(true);
  });

  it("automatically detects and self-heals a tampered batch back to HEALTHY", () => {
    const batch = batchStore.addBatch("batch_sentinel_1", { vendor: "Acme", total: 5000 });

    // Tamper with the in-memory state
    batchStore.simulateTamper(batch.id, { vendor: "Acme", total: 999999 });

    // Run the autonomous sentinel scan
    const report = sentinelService.executeWatchtowerScan();

    expect(report.initialStatus).toBe("COMPROMISED");
    expect(report.autoHealed).toBe(true);
    expect(report.finalStatus).toBe("HEALTHY");
    expect(report.newIncidents.length).toBe(1);
    expect(report.newIncidents[0].actionTaken).toBe("AUTO_HEALED");
  });

  it("generates a cryptographically verifiable compliance certificate with Merkle proof", () => {
    batchStore.addBatch("batch_cert_1", { invoiceId: "INV-101", amount: 1200 });
    const target = batchStore.addBatch("batch_cert_2", { invoiceId: "INV-102", amount: 3400 });

    const cert = sentinelService.generateComplianceReport(target.id);

    expect(cert.batchId).toBe(target.id);
    expect(cert.cryptographicallyVerified).toBe(true);
    expect(cert.merkleRoot).toMatch(/^[a-f0-9]{64}$/);
  });
});
