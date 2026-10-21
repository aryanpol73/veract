import React, { useState } from "react";

interface IngestionToolbarProps {
  sampleBatchId?: string;
  onBatchesUpdated?: (result: any) => void;
}

export const IngestionToolbar: React.FC<IngestionToolbarProps> = ({
  sampleBatchId = "batch_demo_alpha",
  onBatchesUpdated,
}) => {
  const [loading, setLoading] = useState(false);
  const [auditState, setAuditState] = useState<any | null>(null);

  const handleScanDirectory = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/batches/scan-local", { method: "POST" });
      const data = await res.json();
      setAuditState({ action: "SCAN_LOCAL", ...data });
      onBatchesUpdated?.(data);
    } catch (err) {
      console.error("Failed to scan local directory:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSimulateWebhook = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/batches/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "autogen-procurement-bot-04",
          autoSettle: true,
          contractText:
            "INVOICE # 771-X | VENDOR: Acme Cloud Corp | 2x Enterprise License @ $500.00 = $1,000.00 | TOTAL DUE: $1,000.00",
          workerExtractionPayload: {
            invoiceNumber: "771-X",
            vendorName: "Acme Cloud Corp",
            issueDate: "2026-10-21",
            currency: "USD",
            totalAmount: 1000.0,
            lineItems: [{ description: "Enterprise License", quantity: 2, total: 1000.0 }],
          },
        }),
      });
      const data = await res.json();
      setAuditState({ action: "AGENT_WEBHOOK", ...data });
      onBatchesUpdated?.(data);
    } catch (err) {
      console.error("Failed to trigger agent webhook:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAudit = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/verifier/audit");
      const data = await res.json();
      setAuditState(data);
      onBatchesUpdated?.(data);
    } catch (err) {
      console.error("Failed to run ledger audit:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSimulateMismatch = async () => {
    if (!sampleBatchId) return;
    setLoading(true);
    try {
      await fetch(`/api/verifier/simulate-tamper/${sampleBatchId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 9999999 }),
      });
      await handleAudit();
    } catch (err) {
      console.error("Failed to simulate state mismatch:", err);
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/verifier/restore", { method: "POST" });
      const data = await res.json();
      setAuditState(data.audit ?? data);
      onBatchesUpdated?.(data);
    } catch (err) {
      console.error("Failed to restore ledger:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleExportMerkleRoot = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/verifier/merkle-anchor");
      const data = await res.json();
      setAuditState({ action: "MERKLE_ROOT_ANCHOR_SNAPSHOT", ...data });
      onBatchesUpdated?.(data);
    } catch (err) {
      console.error("Failed to export Merkle anchor:", err);
    } finally {
      setLoading(false);
    }
  };

  const isHealthy =
    auditState?.ledgerStatus === "HEALTHY" || auditState?.overallStatus === "HEALTHY";
  const isCompromised =
    auditState?.ledgerStatus === "COMPROMISED" || auditState?.overallStatus === "COMPROMISED";

  return (
    <div
      style={{
        padding: "16px",
        border: "1px solid #334155",
        borderRadius: "8px",
        marginBottom: "20px",
        background: "#0f172a",
        color: "#f8fafc",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: "16px" }}>
            Phase 5/6: Cryptographic Attestation, Merkle Anchoring & Tamper Proofs
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#94a3b8" }}>
            Audit SHA-256 receipts, export Merkle root checkpoints, or simulate an in-memory tampering attack live.
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            onClick={handleAudit}
            disabled={loading}
            style={{
              padding: "7px 12px",
              borderRadius: "6px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "12px",
            }}
          >
            {loading ? "..." : "Run Live Audit"}
          </button>
          <button
            onClick={handleSimulateMismatch}
            disabled={loading || !sampleBatchId}
            style={{
              padding: "7px 12px",
              borderRadius: "6px",
              background: "#dc2626",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "12px",
            }}
          >
            Simulate State Mismatch
          </button>
          <button
            onClick={handleRestore}
            disabled={loading}
            style={{
              padding: "7px 12px",
              borderRadius: "6px",
              background: "#475569",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "12px",
            }}
          >
            Restore Snapshot
          </button>
          <button
            onClick={handleExportMerkleRoot}
            disabled={loading}
            style={{
              padding: "7px 12px",
              borderRadius: "6px",
              background: "#7c3aed",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "12px",
            }}
          >
            Export Merkle Root
          </button>
          <button
            onClick={handleScanDirectory}
            disabled={loading}
            style={{
              padding: "7px 12px",
              borderRadius: "6px",
              background: "#0891b2",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "12px",
            }}
          >
            Scan Invoices
          </button>
          <button
            onClick={handleSimulateWebhook}
            disabled={loading}
            style={{
              padding: "7px 12px",
              borderRadius: "6px",
              background: "#059669",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "12px",
            }}
          >
            Agent Webhook
          </button>
        </div>
      </div>

      {auditState && (
        <div style={{ marginTop: "12px" }}>
          {(isHealthy || isCompromised) && (
            <div
              style={{
                marginBottom: "8px",
                fontWeight: "bold",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>Ledger Audit Status:</span>
              <span
                style={{
                  color: isHealthy ? "#34d399" : "#f87171",
                  background: isHealthy ? "rgba(52, 211, 153, 0.15)" : "rgba(248, 113, 113, 0.15)",
                  border: isHealthy ? "1px solid #34d399" : "1px solid #f87171",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontSize: "11px",
                  fontFamily: "monospace",
                }}
              >
                {isHealthy ? "HEALTHY" : "COMPROMISED"}
              </span>
              <span style={{ color: "#94a3b8", fontSize: "12px" }}>
                ({auditState.totalChecked ?? auditState.totalSettledBatches ?? 0} batches verified)
              </span>
            </div>
          )}

          <pre
            style={{
              padding: "12px",
              background: "#020617",
              borderRadius: "6px",
              fontSize: "12px",
              overflowX: "auto",
              color: isCompromised ? "#f87171" : "#38bdf8",
              border: isCompromised ? "1px solid #ef4444" : "1px solid #1e293b",
            }}
          >
            {JSON.stringify(auditState, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
