import React, { useState, useEffect } from "react";
import { MerkleProofVisualizer } from "./MerkleProofModal.js";

export type AppSection = "matrix" | "audit" | "merkle" | "sentinel";

interface PwaAppShellProps {
  sampleBatchId?: string;
  matrixSection: React.ReactNode;
  auditSection: React.ReactNode;
  onToggleDesktopView?: () => void;
  isDesktopView?: boolean;
}

export const PwaAppShell: React.FC<PwaAppShellProps> = ({
  sampleBatchId = "VRCTBATCH001",
  matrixSection,
  auditSection,
  onToggleDesktopView,
  isDesktopView = false,
}) => {
  const [activeTab, setActiveTab] = useState<AppSection>("matrix");
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [sentinelStatus, setSentinelStatus] = useState<any>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    fetchSentinelStatus();
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const fetchSentinelStatus = async () => {
    try {
      const res = await fetch("/api/verifier/sentinel/status");
      if (res.ok) setSentinelStatus(await res.json());
    } catch {}
  };

  const runSentinelScan = async () => {
    setScanning(true);
    try {
      await fetch("/api/verifier/sentinel/scan", { method: "POST" });
      await fetchSentinelStatus();
    } finally {
      setScanning(false);
    }
  };

  const toggleAutoHeal = async () => {
    if (!sentinelStatus) return;
    const res = await fetch("/api/verifier/sentinel/toggle-autoheal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !sentinelStatus.autoHealEnabled }),
    });
    if (res.ok) setSentinelStatus(await res.json());
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  return (
    <div className="veract-app-shell">
      {/* Native-Style App Top Bar */}
      <header className="veract-app-header">
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span className="veract-pulse-dot" />
          <div>
            <div style={{ fontWeight: 800, fontSize: "15px", letterSpacing: "0.04em", color: "#f8fafc" }}>
              VERACT <span style={{ color: "#38bdf8", fontSize: "11px", fontWeight: 600 }}>OS v1.7 PWA</span>
            </div>
            <div style={{ fontSize: "11px", color: "#64748b" }}>
              Zero-Trust Settlement & Cryptographic Sentinel
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {onToggleDesktopView && (
            <button
              onClick={onToggleDesktopView}
              className="text-xs font-mono font-medium px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
              title="Toggle Desktop / Mobile Shell"
            >
              {isDesktopView ? "📱 App Shell" : "🖥️ Desktop View"}
            </button>
          )}

          {deferredPrompt && (
            <button onClick={handleInstallClick} className="veract-install-btn">
              📲 Install App
            </button>
          )}
        </div>
      </header>

      {/* Active Feature Section Viewport */}
      <main className="veract-app-viewport">
        {activeTab === "matrix" && (
          <section className="veract-section-pane">
            <div className="veract-section-title">3-Gate Verification & Settlement Matrix</div>
            {matrixSection}
          </section>
        )}

        {activeTab === "audit" && (
          <section className="veract-section-pane">
            <div className="veract-section-title">Live Ledger Audit & Attack Simulator</div>
            {auditSection}
          </section>
        )}

        {activeTab === "merkle" && (
          <section className="veract-section-pane">
            <div className="veract-section-title">Merkle Inclusion Tree & Offline Proof</div>
            <MerkleProofVisualizer batchId={sampleBatchId} />
          </section>
        )}

        {activeTab === "sentinel" && (
          <section className="veract-section-pane">
            <div className="veract-section-title">Autonomous Watchtower & Incident Log</div>
            <div className="veract-sentinel-card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "10px",
                }}
              >
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#f8fafc" }}>
                    Autonomous Self-Healing Mode
                  </div>
                  <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                    Automatically restores mutated batches from signed HMAC snapshots
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={toggleAutoHeal}
                    style={{
                      background: sentinelStatus?.autoHealEnabled ? "#059669" : "#334155",
                      color: "#fff",
                      border: "none",
                      padding: "8px 14px",
                      borderRadius: "6px",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontSize: "12px",
                    }}
                  >
                    {sentinelStatus?.autoHealEnabled ? "AUTO-HEAL: ON" : "AUTO-HEAL: OFF"}
                  </button>
                  <button
                    onClick={runSentinelScan}
                    disabled={scanning}
                    style={{
                      background: "#8b5cf6",
                      color: "#fff",
                      border: "none",
                      padding: "8px 14px",
                      borderRadius: "6px",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontSize: "12px",
                    }}
                  >
                    {scanning ? "Scanning..." : "⚡ Trigger Watchtower Scan"}
                  </button>
                </div>
              </div>

              <div style={{ marginTop: "16px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#38bdf8", marginBottom: "8px" }}>
                  IMMUTABLE SECURITY INCIDENT LOG ({sentinelStatus?.incidentCount ?? 0})
                </div>
                {!sentinelStatus?.incidents || sentinelStatus.incidents.length === 0 ? (
                  <div
                    style={{
                      padding: "16px",
                      background: "#090e1a",
                      borderRadius: "6px",
                      color: "#64748b",
                      fontSize: "12px",
                    }}
                  >
                    ✓ Zero unmitigated tamper events recorded in current epoch.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {sentinelStatus.incidents.map((inc: any) => (
                      <div
                        key={inc.incidentId}
                        style={{
                          padding: "10px 12px",
                          background: "#090e1a",
                          borderLeft: "3px solid #f43f5e",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontFamily: "monospace",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", color: "#f8fafc" }}>
                          <strong>
                            {inc.incidentId} (Batch: {inc.batchId})
                          </strong>
                          <span style={{ color: "#34d399" }}>{inc.actionTaken}</span>
                        </div>
                        <div style={{ color: "#94a3b8", marginTop: "4px" }}>
                          Expected: {inc.expectedHash?.slice(0, 20)}... | Corrupted:{" "}
                          {inc.corruptedHash?.slice(0, 20)}...
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Fixed Bottom App Navigation Bar */}
      <nav className="veract-bottom-nav">
        <button
          className={`veract-nav-item ${activeTab === "matrix" ? "active" : ""}`}
          onClick={() => setActiveTab("matrix")}
        >
          <span className="veract-nav-icon">💠</span>
          <span className="veract-nav-label">Matrix</span>
        </button>

        <button
          className={`veract-nav-item ${activeTab === "audit" ? "active" : ""}`}
          onClick={() => setActiveTab("audit")}
        >
          <span className="veract-nav-icon">🛡️</span>
          <span className="veract-nav-label">Audit</span>
        </button>

        <button
          className={`veract-nav-item ${activeTab === "merkle" ? "active" : ""}`}
          onClick={() => setActiveTab("merkle")}
        >
          <span className="veract-nav-icon">🌿</span>
          <span className="veract-nav-label">Merkle</span>
        </button>

        <button
          className={`veract-nav-item ${activeTab === "sentinel" ? "active" : ""}`}
          onClick={() => setActiveTab("sentinel")}
        >
          <span className="veract-nav-icon">⚡</span>
          <span className="veract-nav-label">Sentinel</span>
        </button>
      </nav>
    </div>
  );
};
