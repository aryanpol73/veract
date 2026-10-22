import React, { useState, useEffect } from "react";

export interface ProofStep {
  position: "left" | "right";
  hash: string;
}

export interface CertificateData {
  certificateId: string;
  issuedAt: string;
  batchId: string;
  receiptId: string;
  payloadDigest: string;
  hmacSignature: string;
  merkleRoot: string;
  inclusionProof: ProofStep[];
  cryptographicallyVerified: boolean;
  veractProtocolVersion?: string;
}

interface MerkleProofVisualizerProps {
  batchId: string;
  onClose?: () => void;
}

export const MerkleProofVisualizer: React.FC<MerkleProofVisualizerProps> = ({ batchId, onClose }) => {
  const [cert, setCert] = useState<CertificateData | null>(null);
  const [sentinelResult, setSentinelResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const loadCertificate = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/verifier/batches/${batchId}/certificate`);
      if (res.ok) {
        setCert(await res.json());
      }
    } catch (err) {
      console.error("Failed to load certificate:", err);
    } finally {
      setLoading(false);
    }
  };

  const triggerSentinel = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/verifier/sentinel/scan", { method: "POST" });
      const data = await res.json();
      setSentinelResult(data);
      await loadCertificate();
    } catch (err) {
      console.error("Failed to trigger sentinel:", err);
    } finally {
      setLoading(false);
    }
  };

  const downloadCertificate = () => {
    if (!cert) return;
    const blob = new Blob([JSON.stringify(cert, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${cert.certificateId}.veract.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (batchId) {
      loadCertificate();
    }
  }, [batchId]);

  if (!cert) {
    return (
      <div
        style={{
          marginTop: "14px",
          padding: "16px",
          background: "#0f172a",
          color: "#94a3b8",
          borderRadius: "8px",
          fontFamily: "monospace",
          fontSize: "13px",
        }}
      >
        {loading ? "Generating cryptographic certificate..." : `No active certificate for batch ${batchId}`}
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: "14px",
        padding: "16px",
        background: "#0f172a",
        color: "#f8fafc",
        borderRadius: "8px",
        fontFamily: "monospace",
        border: "1px solid #334155",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #334155",
          paddingBottom: "10px",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div>
          <span style={{ color: "#38bdf8", fontWeight: "bold", fontSize: "14px" }}>
            MERKLE INCLUSION PATH & ZERO-TRUST CERTIFICATE
          </span>
          <span style={{ marginLeft: "10px", fontSize: "12px", color: "#94a3b8" }}>
            Cert: {cert.certificateId}
          </span>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={triggerSentinel}
            disabled={loading}
            style={{
              background: "#8b5cf6",
              color: "#fff",
              border: "none",
              padding: "6px 12px",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "12px",
            }}
          >
            {loading ? "Scanning..." : "Run Autonomous Sentinel"}
          </button>
          <button
            onClick={downloadCertificate}
            style={{
              background: "#0ea5e9",
              color: "#fff",
              border: "none",
              padding: "6px 12px",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "12px",
            }}
          >
            Download .veract Proof
          </button>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: "#334155",
                color: "#cbd5e1",
                border: "none",
                padding: "6px 10px",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Visual Tree Path */}
      <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px" }}>
        <div
          style={{
            padding: "6px 10px",
            background: "#1e293b",
            borderRadius: "4px",
            borderLeft: "4px solid #22c55e",
            wordBreak: "break-all",
          }}
        >
          <strong>LEAF (Batch {cert.batchId}):</strong> {cert.payloadDigest}
        </div>

        {cert.inclusionProof.map((step, idx) => (
          <div
            key={idx}
            style={{
              padding: "6px 10px",
              background: "#1e293b",
              borderRadius: "4px",
              marginLeft: `${(idx + 1) * 16}px`,
              borderLeft: "4px solid #38bdf8",
              wordBreak: "break-all",
            }}
          >
            <strong>L{idx + 1} SIBLING ({step.position.toUpperCase()}):</strong> {step.hash}
          </div>
        ))}

        <div
          style={{
            padding: "8px 10px",
            background: "#172554",
            borderRadius: "4px",
            borderLeft: "4px solid #f59e0b",
            marginTop: "4px",
            wordBreak: "break-all",
          }}
        >
          <strong>ANCHOR MERKLE ROOT:</strong> {cert.merkleRoot}
          <span
            style={{
              float: "right",
              fontWeight: "bold",
              color: cert.cryptographicallyVerified ? "#4ade80" : "#f87171",
            }}
          >
            {cert.cryptographicallyVerified ? "✓ MATH VERIFIED" : "✗ INVALID PROOF"}
          </span>
        </div>
      </div>

      {/* Sentinel Auto-Heal Feedback */}
      {sentinelResult && (
        <div
          style={{
            marginTop: "12px",
            padding: "10px",
            background: sentinelResult.autoHealed ? "#064e3b" : "#1e293b",
            borderRadius: "4px",
            fontSize: "12px",
            border: sentinelResult.autoHealed ? "1px solid #059669" : "1px solid #334155",
          }}
        >
          <strong>Sentinel Watchtower Report:</strong> Initial State:{" "}
          <code style={{ color: sentinelResult.initialStatus === "HEALTHY" ? "#34d399" : "#f87171" }}>
            {sentinelResult.initialStatus}
          </code>{" "}
          → Final State:{" "}
          <code style={{ color: sentinelResult.finalStatus === "HEALTHY" ? "#34d399" : "#f87171" }}>
            {sentinelResult.finalStatus}
          </code>
          {sentinelResult.autoHealed && (
            <div style={{ color: "#6ee7b7", marginTop: "6px", fontWeight: "bold" }}>
              ⚡ Autonomous Recovery Triggered: Reverted {sentinelResult.newIncidents.length} tampered batch(es) via
              cryptographic snapshot binding!
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const MerkleProofModal = MerkleProofVisualizer;
