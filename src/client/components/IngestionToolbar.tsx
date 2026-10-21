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
      setLastReport(data);
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
      setLastReport(data);
      onBatchesUpdated?.(data);
    } catch (err) {
      console.error("Failed to trigger agent webhook:", err);
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
          <h3 style={{ margin: 0, fontSize: "16px" }}>Real-World Ingestion & Agent Webhook Pipeline</h3>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#94a3b8" }}>
            Ingest messy OCR files from <code>data/invoices/</code> or simulate an external autonomous purchasing agent.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={handleScanDirectory}
            disabled={loading}
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {loading ? "Processing..." : "Scan data/invoices/"}
          </button>
          <button
            onClick={handleSimulateWebhook}
            disabled={loading}
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              background: "#059669",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Simulate Agent Webhook
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
            color: "#38bdf8",
          }}
        >
          {JSON.stringify(lastReport, null, 2)}
        </pre>
      )}
    </div>
  );
};
