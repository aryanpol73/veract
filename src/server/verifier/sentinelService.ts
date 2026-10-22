// src/server/verifier/sentinelService.ts
// Phase 7: Autonomous Self-Healing Sentinel Watchtower & Compliance Certificate Generation.

import { batchStore } from "../store/batchStore.js";
import { runLedgerAudit } from "./auditService.js";
import { generateAnchorSnapshot, generateMerkleProof, verifyMerkleProof } from "./merkleAnchor.js";

export interface SecurityIncident {
  incidentId: string;
  timestamp: string;
  batchId: string;
  expectedHash: string;
  corruptedHash: string;
  actionTaken: "QUARANTINED" | "AUTO_HEALED";
  merkleRootAtDetection: string;
}

class SentinelWatchtower {
  private incidents: SecurityIncident[] = [];
  private autoHealEnabled = true;

  public setAutoHeal(enabled: boolean) {
    this.autoHealEnabled = enabled;
  }

  public getStatus() {
    return {
      autoHealEnabled: this.autoHealEnabled,
      incidentCount: this.incidents.length,
      incidents: this.incidents.slice().reverse(),
    };
  }

  public executeWatchtowerScan() {
    const audit = runLedgerAudit();
    const anchor = generateAnchorSnapshot();
    const newIncidents: SecurityIncident[] = [];

    if (audit.ledgerStatus === "COMPROMISED") {
      for (const item of audit.results) {
        if (item.status === "TAMPERED") {
          const incident: SecurityIncident = {
            incidentId: `inc_${Date.now()}_${item.batchId.slice(0, 4)}`,
            timestamp: new Date().toISOString(),
            batchId: item.batchId,
            expectedHash: item.expectedHash,
            corruptedHash: item.computedHash,
            actionTaken: this.autoHealEnabled ? "AUTO_HEALED" : "QUARANTINED",
            merkleRootAtDetection: anchor.merkleRoot,
          };

          this.incidents.push(incident);
          newIncidents.push(incident);
        }
      }

      if (this.autoHealEnabled && newIncidents.length > 0) {
        batchStore.restoreAll();
      }
    }

    const postHealAudit =
      this.autoHealEnabled && newIncidents.length > 0 ? runLedgerAudit() : audit;

    return {
      scanTimestamp: new Date().toISOString(),
      initialStatus: audit.ledgerStatus,
      finalStatus: postHealAudit.ledgerStatus,
      autoHealed: this.autoHealEnabled && newIncidents.length > 0,
      newIncidents,
      totalIncidents: this.incidents.length,
      currentAnchor: anchor,
    };
  }

  public generateComplianceReport(batchId: string) {
    const batch = batchStore.getBatch(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);

    const allBatches = batchStore.getAllBatches();
    const leaves = allBatches.map((b) => b.receipt.expectedHash);
    const targetIndex = allBatches.findIndex((b) => b.id === batchId);

    const anchor = generateAnchorSnapshot();
    const proof = generateMerkleProof(leaves, targetIndex);
    const isVerified = proof
      ? verifyMerkleProof(anchor.merkleRoot, batch.receipt.expectedHash, proof.proof)
      : false;

    return {
      certificateId: `cert_${batch.receipt.receiptId.replace("rcpt_", "")}`,
      issuedAt: new Date().toISOString(),
      batchId: batch.id,
      receiptId: batch.receipt.receiptId,
      payloadDigest: batch.receipt.expectedHash,
      hmacSignature: batch.receipt.signature,
      merkleRoot: anchor.merkleRoot,
      inclusionProof: proof?.proof ?? [],
      cryptographicallyVerified: isVerified,
      veractProtocolVersion: "1.0.0-phase7",
    };
  }
}

export const sentinelService = new SentinelWatchtower();
