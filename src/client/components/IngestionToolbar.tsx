import React, { useState } from "react";

interface IngestionToolbarProps {
  onBatchesUpdated?: (result: any) => void;
}

export const IngestionToolbar: React.FC<IngestionToolbarProps> = ({ onBatchesUpdated }) => {
  const [loading, setLoading] = useState(false);
  const [lastReport, setLastReport] = useState<any | null>(null);

  const handleScanDirectory = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/batches/scan-local", { method: "POST" });
      const data = await res.json();
      setLastReport({ action: "SCAN_LOCAL", ...data });
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
      setLastReport({ action: "AGENT_WEBHOOK", ...data });
      onBatchesUpdated?.(data);
    } catch (err) {
      console.error("Failed to trigger agent webhook:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAuditLedger = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/verifier/audit");
      const data = await res.json();
      setLastReport({ action: "CRYPTO_AUDIT_REPORT", ...data });
      onBatchesUpdated?.(data);
    } catch (err) {
      console.error("Failed to audit ledger:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSimulateTamper = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/verifier/batches/batch_demo_alpha/simulate-tamper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tamperedAmount: 999999 }),
      });
      const data = await res.json();
      setLastReport({ action: "TAMPER_ATTACK_SIMULATED", ...data });
      onBatchesUpdated?.(data);
    } catch (err) {
      console.error("Failed to simulate tamper attack:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/verifier/batches/batch_demo_alpha/restore", {
        method: "POST",
      });
      const data = await res.json();
      setLastReport({ action: "BATCH_RESTORED", ...data });
      onBatchesUpdated?.(data);
    } catch (err) {
      console.error("Failed to restore batch:", err);
    } finally {
      setLoading(false);
    }
  };

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
            Real-World Ingestion, SHA-256 Attestation & Live Tamper Demo
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#94a3b8" }}>
            Ingest messy OCR files, audit the SHA-256 receipt chain, or simulate a live database tampering attack.
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            onClick={handleScanDirectory}
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
            {loading ? "..." : "Scan Invoices"}
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
          <button
            onClick={handleAuditLedger}
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
            Audit Receipts
          </button>
          <button
            onClick={handleSimulateTamper}
            disabled={loading}
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
            Simulate Attack
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
            Restore Clean
          </button>
        </div>
      </div>

      {lastReport && (
        <pre
          style={{
            marginTop: "12px",
            padding: "12px",
            background: "#020617",
            borderRadius: "6px",
            fontSize: "12px",
            overflowX: "auto",
            color:
              lastReport.overallStatus === "COMPROMISED" ||
              lastReport.valid === false ||
              lastReport.verificationStatus === "REJECTED_HALLUCINATION"
                ? "#f87171"
                : "#38bdf8",
            border:
              lastReport.overallStatus === "COMPROMISED" || lastReport.valid === false
                ? "1px solid #ef4444"
                : "1px solid #1e293b",
          }}
        >
          {JSON.stringify(lastReport, null, 2)}
        </pre>
      )}
    </div>
  );
};
