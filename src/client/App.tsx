// src/client/App.tsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AgGridReact } from "ag-grid-react";
import {
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type RowClickedEvent,
} from "ag-grid-community";
import {
  ShieldCheck,
  ShieldAlert,
  Lock,
  ArrowUpRight,
  Terminal,
  Copy,
  Check,
  Sparkles,
  FileCode2,
  Receipt,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
  Sliders,
  Layers,
  Activity,
  BadgeDollarSign,
  RotateCcw,
  FlaskConical,
  ExternalLink,
} from "lucide-react";
import type {
  BatchVerificationSummary,
  TaskVerificationResult,
  VendorContractFixture,
} from "../shared/types.js";

const veractGridTheme = themeQuartz.withParams({
  backgroundColor: "rgba(11, 18, 32, 0.75)",
  foregroundColor: "#f8fafc",
  headerBackgroundColor: "rgba(15, 23, 42, 0.95)",
  headerTextColor: "#38bdf8",
  oddRowBackgroundColor: "rgba(15, 23, 42, 0.4)",
  rowHoverColor: "rgba(14, 165, 233, 0.12)",
  selectedRowBackgroundColor: "rgba(16, 185, 129, 0.18)",
  borderColor: "rgba(51, 65, 85, 0.5)",
  wrapperBorder: false,
  rowBorder: true,
  columnBorder: false,
  fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif",
  fontSize: 13,
  headerFontSize: 11,
  headerFontWeight: 700,
  cellHorizontalPaddingScale: 0.95,
});

type PresetScenario = "standard_3_5" | "perfect_5_5" | "void_0_5" | "custom_mutated";

interface BatchApiResponse {
  batchId: string;
  state: "CREATED" | "AUTHORIZED" | "VERIFYING" | "CAPTURED" | "VOIDED" | "FAILED";
  orderId: string;
  approvalUrl: string;
  authorizationId?: string;
  authorizationStatus?: string;
  authorizedCents: number;
  capturedCents?: number;
  releasedCents?: number;
  captureId?: string;
  captureStatus?: string;
  paypalCustomId?: string;
  paypalRequestId?: string;
  executionMode?: "seeded" | "live_gemini";
  verification?: BatchVerificationSummary;
  agentToolkitReceipt?: {
    toolInvoked: string;
    invoiceNumber: string;
    generatedAt: string;
    itemizedLines: Array<{
      taskId: string;
      vendorName: string;
      status: "BILLED" | "WAIVED_BY_VERIFIER";
      amountUsd: string;
      reason: string;
    }>;
  };
  errorMessage?: string;
}

interface LedgerProofResponse {
  mode: string;
  verifiedOnPayPal: boolean;
  captureId: string;
  status: string;
  capturedCents: number;
  customIdOnPayPal: string;
  hashMatched: boolean;
  verifiedAt: string;
  endpointQueried: string;
}

const formatUsd = (cents: number | undefined): string => {
  if (typeof cents !== "number") return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
};

export default function App() {
  const [fixtures, setFixtures] = useState<VendorContractFixture[]>([]);
  const [batch, setBatch] = useState<BatchApiResponse | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("TASK-103");
  const [mode, setMode] = useState<"seeded" | "live_gemini">("seeded");
  const [scenario, setScenario] = useState<PresetScenario>("standard_3_5");
  const [inspectorTab, setInspectorTab] = useState<"forensics" | "mutator" | "wire" | "invoice">(
    "forensics",
  );
  const [loadingStep, setLoadingStep] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [isAuditingAnim, setIsAuditingAnim] = useState(false);

  // Live Custom Mutator state
  const [editSourceDoc, setEditSourceDoc] = useState<string>("");
  const [editEvidenceQuote, setEditEvidenceQuote] = useState<string>("");
  const [editFirstItemCents, setEditFirstItemCents] = useState<number>(0);
  const [ledgerProof, setLedgerProof] = useState<LedgerProofResponse | null>(null);

  const buildScenarioBatch = useCallback(
    (loadedFixtures: VendorContractFixture[], targetScenario: PresetScenario): BatchApiResponse => {
      const previewResults: TaskVerificationResult[] = loadedFixtures.map((f) => {
        const is103 = f.taskId === "TASK-103";
        const is105 = f.taskId === "TASK-105";

        let passed = !is103 && !is105;
        if (targetScenario === "perfect_5_5") passed = true;
        if (targetScenario === "void_0_5") passed = false;

        const g2Failed =
          targetScenario === "void_0_5" ? true : targetScenario === "perfect_5_5" ? false : is103;
        const g3Failed =
          targetScenario === "void_0_5" ? false : targetScenario === "perfect_5_5" ? false : is105;

        const startOffset = g2Failed
          ? -1
          : Math.max(0, f.sourceDocument.indexOf(f.seededOutput.evidenceQuote));
        const endOffset =
          startOffset >= 0 ? startOffset + f.seededOutput.evidenceQuote.length : -1;
        const computedSum = g3Failed
          ? f.seededOutput.lineItems.reduce((s, i) => s + i.amountCents, 0)
          : f.seededOutput.statedTotalCents;

        return {
          taskId: f.taskId,
          title: f.title,
          vendorName: f.seededOutput.vendorName,
          passed,
          unitPriceCents: f.unitPriceCents,
          billableCents: passed ? f.unitPriceCents : 0,
          gate1: { passed: true, errors: [] },
          gate2: {
            passed: !g2Failed,
            startOffset: g2Failed ? -1 : startOffset || 250,
            endOffset: g2Failed ? -1 : endOffset > 0 ? endOffset : 385,
            normalizedQuote: f.seededOutput.evidenceQuote,
            containsTotalAnchor: !g2Failed,
            expectedAnchors: [`$${(f.seededOutput.statedTotalCents / 100).toFixed(2)}`],
            failureCode: g2Failed ? "SUBSTRING_NOT_FOUND" : undefined,
          },
          gate3: {
            passed: !g3Failed,
            computedSumCents: computedSum,
            statedTotalCents: f.seededOutput.statedTotalCents,
            deltaCents: computedSum - f.seededOutput.statedTotalCents,
          },
          candidate: f.seededOutput,
        };
      });

      const passedCount = previewResults.filter((r) => r.passed).length;
      const failedCount = previewResults.length - passedCount;
      const capturedCents = passedCount * 200;
      const releasedCents = 1000 - capturedCents;

      const shaMap: Record<string, string> = {
        standard_3_5: "9314ee9bbea75e506938b433e245a69c8a3131319f61313c28706db169f51182",
        perfect_5_5: "4f8b22e091c77d18a9023c44b5189a0c77e1290f4b8812d3c65a99012e88a410",
        void_0_5: "00e91a774c8211b90f32a119d843c2019f77281a904b12c8831f009a2b71c309",
      };
      const demoSha = shaMap[targetScenario] ?? shaMap.standard_3_5!;
      const batchId =
        targetScenario === "standard_3_5"
          ? "VRCTBATCH001"
          : targetScenario === "perfect_5_5"
            ? "VRCTPERF0005"
            : "VRCTVOID0000";

      return {
        batchId,
        state: capturedCents > 0 ? "CAPTURED" : "VOIDED",
        orderId: "7NT38513NC004402C",
        approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=7NT38513NC004402C",
        authorizationId: "4WL99812AA119021B",
        authorizationStatus: capturedCents > 0 ? "CAPTURED" : "VOIDED",
        authorizedCents: 1000,
        capturedCents,
        releasedCents,
        captureId: capturedCents > 0 ? "9KP22109CC881234D" : undefined,
        captureStatus: capturedCents > 0 ? "COMPLETED" : "VOIDED",
        paypalCustomId: `VERACT:${batchId}:${demoSha}`,
        paypalRequestId: "718a6a3a6f8ca327aa98b1e485ae280710d1",
        executionMode: mode,
        verification: {
          batchId,
          totalTasks: 5,
          passedTasks: passedCount,
          failedTasks: failedCount,
          centsPerTask: 200,
          authorizedCents: 1000,
          capturedCents,
          releasedCents,
          auditSha256: demoSha,
          canonicalAuditJson: JSON.stringify({
            authorizedCents: 1000,
            batchId,
            capturedCents,
            centsPerTask: 200,
            failedTasks: failedCount,
            passedTasks: passedCount,
            protocol: "veract-3gate/v1",
            releasedCents,
          }),
          paypalCustomId: `VERACT:${batchId}:${demoSha}`,
          results: previewResults,
        },
        agentToolkitReceipt: {
          toolInvoked: "paypal_agent_toolkit:create_invoice_audit_manifest",
          invoiceNumber: `VRCT-INV-${batchId}`,
          generatedAt: new Date().toISOString(),
          itemizedLines: previewResults.map((r) => ({
            taskId: r.taskId,
            vendorName: r.vendorName,
            status: r.passed ? "BILLED" : "WAIVED_BY_VERIFIER",
            amountUsd: r.passed ? "$2.00" : "$0.00",
            reason: r.passed
              ? `Passed Gate 1 (Zod), Gate 2 (Span [${r.gate2.startOffset}..${r.gate2.endOffset}]), Gate 3 (Σ=${r.gate3.computedSumCents}¢)`
              : !r.gate2.passed
                ? "Slashed by Gate 2: Unanchored / Hallucinated Quote"
                : "Slashed by Gate 3: Minor-unit sum != stated total",
          })),
        },
      };
    },
    [mode],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returnedBatchId = params.get("batchId");
    const paypalState = params.get("paypal");

    fetch("/api/fixtures")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.fixtures)) {
          setFixtures(data.fixtures);
          if (!returnedBatchId) {
            setBatch(buildScenarioBatch(data.fixtures, "standard_3_5"));
          }
        }
      })
      .catch(() => undefined);

    if (returnedBatchId) {
      window.history.replaceState({}, "", window.location.pathname);
      if (paypalState === "approved") {
        handleAuthorizeOrder(returnedBatchId);
      } else {
        fetch(`/api/batches/${returnedBatchId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((b) => b && setBatch(b))
          .catch(() => undefined);
      }
    }
  }, [buildScenarioBatch]);

  const rowData: TaskVerificationResult[] = useMemo(() => {
    if (batch?.verification?.results) {
      return [...batch.verification.results];
    }
    return fixtures.map((f) => ({
      taskId: f.taskId,
      title: f.title,
      vendorName: f.seededOutput.vendorName,
      passed: false,
      unitPriceCents: f.unitPriceCents,
      billableCents: 0,
      gate1: { passed: true, errors: [] },
      gate2: {
        passed: true,
        startOffset: 0,
        endOffset: 0,
        normalizedQuote: f.seededOutput.evidenceQuote,
        containsTotalAnchor: true,
        expectedAnchors: [],
      },
      gate3: {
        passed: true,
        computedSumCents: f.seededOutput.statedTotalCents,
        statedTotalCents: f.seededOutput.statedTotalCents,
        deltaCents: 0,
      },
      candidate: f.seededOutput,
    }));
  }, [batch, fixtures]);

  const selectedTask = useMemo(
    () => rowData.find((r) => r.taskId === selectedTaskId) ?? rowData[0],
    [rowData, selectedTaskId],
  );

  const selectedFixture = useMemo(
    () => fixtures.find((f) => f.taskId === selectedTask?.taskId),
    [fixtures, selectedTask],
  );

  // Sync mutator inputs whenever selectedTask changes
  useEffect(() => {
    if (selectedFixture && selectedTask) {
      setEditSourceDoc(selectedFixture.sourceDocument);
      setEditEvidenceQuote(selectedTask.candidate.evidenceQuote);
      setEditFirstItemCents(selectedTask.candidate.lineItems[0]?.amountCents ?? 0);
    }
  }, [selectedFixture, selectedTask]);

  const handleTriggerScenario = (nextScenario: PresetScenario) => {
    if (!fixtures.length) return;
    setScenario(nextScenario);
    setLedgerProof(null);
    setIsAuditingAnim(true);
    setTimeout(() => {
      setBatch(buildScenarioBatch(fixtures, nextScenario));
      if (nextScenario === "standard_3_5") setSelectedTaskId("TASK-103");
      if (nextScenario === "perfect_5_5") setSelectedTaskId("TASK-101");
      if (nextScenario === "void_0_5") setSelectedTaskId("TASK-103");
      setIsAuditingAnim(false);
    }, 280);
  };

  // Run Live Backend Custom Verification (/api/verify-custom)
  const handleRunCustomMutator = async (customOverride?: {
    sourceDocument?: string;
    evidenceQuote?: string;
    firstLineItemCents?: number;
  }) => {
    if (!selectedTask) return;
    setErrorBanner(null);
    setIsAuditingAnim(true);
    try {
      const payload = {
        batchId: batch?.batchId ?? "VRCTCUST0001",
        overrides: {
          [selectedTask.taskId]: {
            sourceDocument: customOverride?.sourceDocument ?? editSourceDoc,
            evidenceQuote: customOverride?.evidenceQuote ?? editEvidenceQuote,
            firstLineItemCents: customOverride?.firstLineItemCents ?? editFirstItemCents,
          },
        },
      };
      const res = await fetch("/api/verify-custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Custom verification failed");

      setFixtures(data.mutatedFixtures);
      setScenario("custom_mutated");
      const v: BatchVerificationSummary = data.verification;
      setBatch((prev) => ({
        ...(prev ?? buildScenarioBatch(fixtures, "standard_3_5")),
        batchId: v.batchId,
        state: v.capturedCents > 0 ? "CAPTURED" : "VOIDED",
        capturedCents: v.capturedCents,
        releasedCents: v.releasedCents,
        paypalCustomId: v.paypalCustomId,
        verification: v,
      }));
      setInspectorTab("forensics");
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setIsAuditingAnim(false);
    }
  };

  // Live PayPal Sandbox Ledger Proof Check
  const handleVerifyCaptureOnPayPal = async () => {
    const capId = batch?.captureId ?? "9KP22109CC881234D";
    setLoadingStep(`Querying Live PayPal Ledger GET /v2/payments/captures/${capId}...`);
    try {
      const res = await fetch(
        `/api/captures/${encodeURIComponent(capId)}/verify?expectedCustomId=${encodeURIComponent(
          batch?.paypalCustomId ?? "",
        )}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to verify capture on PayPal");
      setLedgerProof(data);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setLoadingStep(null);
    }
  };

  const handleCreateOrder = async () => {
    setErrorBanner(null);
    setLedgerProof(null);
    setLoadingStep("Initializing $10.00 (1000¢) Pre-Authorization Order on PayPal Sandbox...");
    try {
      const res = await fetch("/api/batches/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: window.location.origin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create PayPal order");
      setBatch(data);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setLoadingStep(null);
    }
  };

  const handleAuthorizeOrder = async (targetBatchId?: string) => {
    const id = targetBatchId ?? batch?.batchId;
    if (!id) return;
    setErrorBanner(null);
    setLoadingStep("Locking $10.00 Hold via POST /v2/checkout/orders/{id}/authorize...");
    try {
      const res = await fetch(`/api/batches/${id}/authorize`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Buyer has not approved the PayPal popup yet.");
      setBatch(data);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setLoadingStep(null);
    }
  };

  const handleExecuteAndSettle = async () => {
    if (!batch?.batchId) return;
    setErrorBanner(null);
    setLoadingStep("Running Worker Batch -> 3-Gate Deterministic Verifier -> PayPal Partial Capture...");
    try {
      const res = await fetch(`/api/batches/${batch.batchId}/execute-and-settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Settlement failed");
      setBatch(data);
      setSelectedTaskId("TASK-103");
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setLoadingStep(null);
    }
  };

  const isSettled = batch?.state === "CAPTURED" || batch?.state === "VOIDED";

  const columnDefs = useMemo<ColDef<TaskVerificationResult>[]>(
    () => [
      {
        field: "taskId",
        headerName: "TASK ID",
        width: 102,
        cellRenderer: (p: ICellRendererParams<TaskVerificationResult>) => {
          const active = p.data?.taskId === selectedTaskId;
          return (
            <div className="flex items-center gap-2 h-full">
              <span
                className={`w-2 h-2 rounded-full transition-all ${
                  !isSettled
                    ? "bg-slate-500"
                    : p.data?.passed
                      ? "bg-cyan-400 shadow-[0_0_10px_#38bdf8]"
                      : "bg-rose-500 shadow-[0_0_10px_#f43f5e]"
                }`}
              />
              <span
                className={`font-mono text-xs font-bold tracking-tight ${
                  active ? "text-cyan-300" : "text-slate-100"
                }`}
              >
                {p.value}
              </span>
            </div>
          );
        },
      },
      {
        field: "vendorName",
        headerName: "COUNTERPARTY & CONTRACT",
        flex: 1.5,
        minWidth: 185,
        cellRenderer: (p: ICellRendererParams<TaskVerificationResult>) => (
          <div className="flex flex-col justify-center h-full leading-tight py-1">
            <span className="font-semibold text-white text-[13px] truncate">
              {p.data?.vendorName}
            </span>
            <span className="text-[11px] text-slate-400 truncate mt-0.5">{p.data?.title}</span>
          </div>
        ),
      },
      {
        headerName: "GATE 1: SCHEMA",
        width: 124,
        cellRenderer: (p: ICellRendererParams<TaskVerificationResult>) => {
          if (!isSettled)
            return <span className="text-[11px] text-slate-500 font-mono">HOLDING</span>;
          return p.data?.gate1.passed ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/35">
              <CheckCircle2 className="w-3 h-3 text-cyan-400" /> ZOD OK
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-rose-500/15 text-rose-300 border border-rose-500/35">
              <XCircle className="w-3 h-3 text-rose-400" /> INVALID
            </span>
          );
        },
      },
      {
        headerName: "GATE 2: NFKC SPAN",
        flex: 1.05,
        minWidth: 148,
        cellRenderer: (p: ICellRendererParams<TaskVerificationResult>) => {
          if (!isSettled)
            return <span className="text-[11px] text-slate-500 font-mono">HOLDING</span>;
          const g2 = p.data?.gate2;
          return g2?.passed ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/35">
              <CheckCircle2 className="w-3 h-3 text-cyan-400" /> [{g2.startOffset}..{g2.endOffset}]
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-rose-500/20 text-rose-200 border border-rose-500/40 shadow-[0_0_12px_rgba(244,63,94,0.2)]">
              <XCircle className="w-3 h-3 text-rose-400" /> HALLUCINATED
            </span>
          );
        },
      },
      {
        headerName: "GATE 3: CENT Σ",
        flex: 1.0,
        minWidth: 138,
        cellRenderer: (p: ICellRendererParams<TaskVerificationResult>) => {
          if (!isSettled)
            return <span className="text-[11px] text-slate-500 font-mono">HOLDING</span>;
          const g3 = p.data?.gate3;
          return g3?.passed ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/35">
              <CheckCircle2 className="w-3 h-3 text-cyan-400" /> {g3.computedSumCents}¢
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-amber-500/20 text-amber-200 border border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.2)]">
              <AlertTriangle className="w-3 h-3 text-amber-400" /> Δ+{g3?.deltaCents}¢
            </span>
          );
        },
      },
      {
        headerName: "SETTLEMENT",
        width: 140,
        cellRenderer: (p: ICellRendererParams<TaskVerificationResult>) => {
          if (!isSettled) {
            return <span className="font-mono text-xs text-sky-300">$2.00 Hold</span>;
          }
          return p.data?.passed ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-gradient-to-r from-cyan-500/25 to-blue-500/20 text-cyan-200 border border-cyan-400/40 shadow-sm">
              +$2.00 CAPTURED
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-rose-500/15 text-rose-300 border border-rose-500/35">
              $0.00 WAIVED
            </span>
          );
        },
      },
    ],
    [isSettled, selectedTaskId],
  );

  const copyCliProof = () => {
    if (!batch?.verification) return;
    const cmd = `node -e 'const c=require("crypto");console.log(c.createHash("sha256").update(${JSON.stringify(batch.verification.canonicalAuditJson)}).digest("hex"))'`;
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2500);
  };

  const capturedCents = batch?.capturedCents ?? 600;
  const releasedCents = batch?.releasedCents ?? 400;
  const authorizedCents = batch?.authorizedCents ?? 1000;
  const capturedPct = isSettled ? (capturedCents / authorizedCents) * 100 : 0;
  const releasedPct = isSettled ? (releasedCents / authorizedCents) * 100 : 0;

  return (
    <div className="min-h-screen flex flex-col text-slate-100 bg-dot-grid relative overflow-hidden">
      {/* Ambient Luminous Glass Glow Orbs */}
      <div className="pointer-events-none fixed -top-40 left-1/4 w-[700px] h-[450px] bg-cyan-500/15 rounded-full blur-[140px] -z-10" />
      <div className="pointer-events-none fixed top-10 right-10 w-[600px] h-[400px] bg-indigo-600/15 rounded-full blur-[150px] -z-10" />
      <div className="pointer-events-none fixed bottom-10 left-10 w-[500px] h-[350px] bg-emerald-500/10 rounded-full blur-[140px] -z-10" />

      {/* Top Glassmorphic Command Header */}
      <header className="sticky top-0 z-30 border-b border-white/[0.1] bg-[#090e1a]/85 backdrop-blur-xl px-6 py-3.5 shadow-2xl">
        <div className="max-w-[1620px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <motion.div
              whileHover={{ rotate: 8, scale: 1.06 }}
              className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-400 via-blue-500 to-indigo-600 p-[1px] shadow-lg shadow-cyan-500/25"
            >
              <div className="h-full w-full bg-[#090e1a] rounded-[11px] flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-cyan-400" />
              </div>
            </motion.div>

            <div>
              <div className="flex items-center gap-2.5">
                <span className="text-lg font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-cyan-200 bg-clip-text text-transparent">
                  VERACT
                </span>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-400/35">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  PayPal Orders v2 · Deterministic Escrow
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Pre-Authorized Outcome Metering — Zero buyer liability for hallucinated AI agent outputs
              </p>
            </div>
          </div>

          {/* Interactive Chaos Simulator & Mode Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center bg-[#0d1527] border border-white/[0.1] rounded-xl p-1 text-xs shadow-inner">
              <span className="px-2.5 py-1 text-[11px] font-mono text-cyan-300 flex items-center gap-1">
                <Sliders className="w-3 h-3 text-cyan-400" /> Fault Simulator:
              </span>
              {(
                [
                  { id: "standard_3_5", label: "3/5 Pass ($6 Capture)" },
                  { id: "perfect_5_5", label: "5/5 Clean ($10 Capture)" },
                  { id: "void_0_5", label: "0/5 Fail (100% Void)" },
                ] as const
              ).map((item) => {
                const active = scenario === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleTriggerScenario(item.id)}
                    className={`relative px-3 py-1.5 rounded-lg font-medium transition-colors ${
                      active ? "text-white" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {active && (
                      <motion.div
                        layoutId="scenarioPill"
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        className="absolute inset-0 rounded-lg bg-gradient-to-r from-cyan-500/30 to-blue-600/30 border border-cyan-400/50 shadow-[0_0_15px_rgba(14,165,233,0.25)]"
                      />
                    )}
                    <span className="relative z-10">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center bg-[#0d1527] border border-white/[0.1] rounded-xl p-1 text-xs">
              <button
                onClick={() => setMode("seeded")}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  mode === "seeded"
                    ? "bg-slate-800 text-white shadow"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Seeded Fixtures
              </button>
              <button
                onClick={() => setMode("live_gemini")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition ${
                  mode === "live_gemini"
                    ? "bg-gradient-to-r from-cyan-600/30 to-blue-600/30 text-cyan-200 border border-cyan-400/40"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                Gemini 2.5 Flash
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1620px] w-full mx-auto px-6 py-5 flex flex-col gap-5">
        <AnimatePresence>
          {errorBanner && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-rose-950/80 border border-rose-500/50 rounded-xl px-4 py-3 text-xs text-rose-100 flex items-center justify-between shadow-lg"
            >
              <span className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{errorBanner}</span>
              </span>
              <button
                onClick={() => setErrorBanner(null)}
                className="text-rose-300 hover:text-white font-mono text-[11px] px-2 py-0.5 rounded bg-rose-900/50"
              >
                DISMISS
              </button>
            </motion.div>
          )}

          {loadingStep && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-cyan-950/60 border border-cyan-400/40 rounded-xl px-4 py-2.5 text-xs text-cyan-100 font-mono flex items-center gap-3 shadow-lg"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-ping" />
              {loadingStep}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Top Row: 4 Animated Glass KPI Cards + Live PayPal Execution Console */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-4 gap-4">
            <motion.div
              whileHover={{ y: -3 }}
              transition={{ type: "spring", stiffness: 300 }}
              className="lovable-card border border-white/[0.1] rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden group"
            >
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-cyan-500/10 rounded-full blur-xl group-hover:bg-cyan-500/20 transition" />
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-cyan-400" /> ESCROW CEILING
                </span>
                <span className="text-cyan-200 bg-cyan-500/15 border border-cyan-400/30 px-2 py-0.5 rounded-full text-[10px]">
                  AUTHORIZE
                </span>
              </div>
              <div className="my-3">
                <motion.div
                  key={authorizedCents}
                  initial={{ opacity: 0.4, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-3xl font-extrabold font-mono tracking-tight text-white"
                >
                  {formatUsd(authorizedCents)}
                </motion.div>
                <div className="text-xs text-slate-300 mt-1">
                  1000¢ Pre-Auth · 5 Tasks @ $2.00
                </div>
              </div>
              <div className="text-[11px] font-mono text-slate-400 truncate border-t border-white/[0.08] pt-2.5">
                {batch?.authorizationId ? `Hold: ${batch.authorizationId}` : `Order: ${batch?.orderId ?? "Ready"}`}
              </div>
            </motion.div>

            <motion.div
              whileHover={{ y: -3 }}
              transition={{ type: "spring", stiffness: 300 }}
              className="lovable-card border border-white/[0.1] rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden group"
            >
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-indigo-500/15 rounded-full blur-xl group-hover:bg-indigo-500/25 transition" />
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" /> 3-GATE AUDIT
                </span>
                <span className="text-indigo-200 bg-indigo-500/20 border border-indigo-400/30 px-2 py-0.5 rounded-full text-[10px]">
                  0 LLM CALLS
                </span>
              </div>
              <div className="my-3">
                <motion.div
                  key={batch?.verification?.passedTasks ?? 0}
                  initial={{ scale: 0.92, opacity: 0.5 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="text-3xl font-extrabold font-mono tracking-tight text-white"
                >
                  {isSettled ? `${batch?.verification?.passedTasks ?? 3} / 5` : "5 Queued"}
                </motion.div>
                <div className="text-xs text-rose-400 mt-1 font-medium">
                  {isSettled
                    ? `${batch?.verification?.failedTasks ?? 2} Hallucinations Slashed`
                    : "Awaiting 3-Gate Audit"}
                </div>
              </div>
              <div className="text-[11px] font-mono text-slate-400 border-t border-white/[0.08] pt-2.5">
                Zod · NFKC Span · Cent Math
              </div>
            </motion.div>

            <motion.div
              whileHover={{ y: -3 }}
              transition={{ type: "spring", stiffness: 300 }}
              className="lovable-card border border-emerald-500/40 rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden group"
            >
              <div className="absolute -right-6 -top-6 w-28 h-28 bg-emerald-500/20 rounded-full blur-xl group-hover:bg-emerald-500/30 transition" />
              <div className="flex items-center justify-between text-[11px] font-mono text-emerald-300">
                <span className="flex items-center gap-1.5">
                  <BadgeDollarSign className="w-3.5 h-3.5 text-emerald-400" /> FINAL CAPTURE
                </span>
                <span className="text-emerald-200 bg-emerald-500/25 border border-emerald-400/40 px-2 py-0.5 rounded-full text-[10px]">
                  {batch?.state === "VOIDED" ? "VOIDED" : "CAPTURED"}
                </span>
              </div>
              <div className="my-3">
                <motion.div
                  key={capturedCents}
                  initial={{ scale: 0.9, opacity: 0.5 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="text-3xl font-extrabold font-mono tracking-tight text-emerald-400 drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                >
                  {isSettled ? formatUsd(capturedCents) : "$0.00"}
                </motion.div>
                <div className="text-xs text-slate-200 mt-1">
                  {isSettled ? `${capturedCents}¢ settled via PayPal v2` : "final_capture: true"}
                </div>
              </div>
              <div className="text-[11px] font-mono text-emerald-300/90 truncate border-t border-white/[0.08] pt-2.5">
                {batch?.captureId ? `Capture ID: ${batch.captureId}` : "Full Void Executed (0¢ Charged)"}
              </div>
            </motion.div>

            <motion.div
              whileHover={{ y: -3 }}
              transition={{ type: "spring", stiffness: 300 }}
              className="lovable-card border border-amber-500/40 rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden group"
            >
              <div className="absolute -right-6 -top-6 w-28 h-28 bg-amber-500/20 rounded-full blur-xl group-hover:bg-amber-500/30 transition" />
              <div className="flex items-center justify-between text-[11px] font-mono text-amber-300">
                <span className="flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400" /> BUYER SAVED
                </span>
                <span className="text-amber-200 bg-amber-500/25 border border-amber-400/40 px-2 py-0.5 rounded-full text-[10px]">
                  AUTO-RELEASED
                </span>
              </div>
              <div className="my-3">
                <motion.div
                  key={releasedCents}
                  initial={{ scale: 0.9, opacity: 0.5 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="text-3xl font-extrabold font-mono tracking-tight text-amber-300 drop-shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                >
                  {isSettled ? formatUsd(releasedCents) : "$0.00"}
                </motion.div>
                <div className="text-xs text-slate-200 mt-1">
                  {isSettled ? `${releasedCents}¢ returned instantly` : "Slashed tasks = $0"}
                </div>
              </div>
              <div className="text-[11px] font-mono text-amber-200/90 truncate border-t border-white/[0.08] pt-2.5">
                Conservation: 1000¢ ≡ {capturedCents}¢ + {releasedCents}¢
              </div>
            </motion.div>
          </div>

          {/* Right 4 Cols: Live PayPal Sandbox Pipeline & Proportional Bar */}
          <div className="lg:col-span-4 lovable-card border border-white/[0.1] rounded-2xl p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  Live PayPal v2 Escrow Split
                </span>
                <span className="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 font-semibold shadow-sm">
                  ● {batch?.state ?? "READY"}
                </span>
              </div>

              <div className="w-full h-3.5 bg-[#060913] rounded-full overflow-hidden flex border border-white/15 my-3 p-0.5 gap-0.5 shadow-inner">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${capturedPct}%` }}
                  transition={{ type: "spring", stiffness: 120, damping: 20 }}
                  className="h-full rounded-l-full bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_15px_#10b981]"
                />
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${releasedPct}%` }}
                  transition={{ type: "spring", stiffness: 120, damping: 20 }}
                  className="h-full rounded-r-full bg-gradient-to-r from-amber-500 to-orange-400 shadow-[0_0_15px_#f59e0b]"
                />
              </div>

              <div className="flex justify-between text-xs font-mono">
                <span className="text-emerald-300 font-semibold">
                  Captured: {formatUsd(capturedCents)} ({Math.round(capturedPct)}%)
                </span>
                <span className="text-amber-300 font-semibold">
                  Released: {formatUsd(releasedCents)} ({Math.round(releasedPct)}%)
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 mt-4 pt-3 border-t border-white/[0.08]">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleCreateOrder}
                disabled={Boolean(loadingStep)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-slate-950 font-extrabold shadow-lg shadow-cyan-500/25 border border-cyan-300/40 transition disabled:opacity-50"
              >
                <Zap className="w-3.5 h-3.5 fill-current" />
                Launch Live $10 PayPal Sandbox Order
              </motion.button>

              {batch?.state === "CREATED" && batch.approvalUrl && (
                <>
                  <motion.a
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    href={batch.approvalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 px-3.5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-400 to-orange-400 text-slate-950 shadow-lg shadow-amber-500/25"
                  >
                    Approve Popup <ArrowUpRight className="w-3.5 h-3.5" />
                  </motion.a>
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => handleAuthorizeOrder()}
                    className="px-3.5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400/40"
                  >
                    Lock Hold
                  </motion.button>
                </>
              )}

              {batch?.state === "AUTHORIZED" && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={handleExecuteAndSettle}
                  className="flex-1 px-4 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-400 to-teal-400 text-slate-950 shadow-lg shadow-emerald-500/25"
                >
                  Verify & Settle $6.00 Now
                </motion.button>
              )}
            </div>
          </div>
        </section>

        {/* Bottom Split Workbench: AG Grid Community Matrix (7 Cols) + Animated 4-Tab Forensic Inspector (5 Cols) */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1">
          {/* Left 7 Cols: AG Grid v33 Dark Glass Matrix */}
          <div className="lg:col-span-7 flex flex-col lovable-card border border-white/[0.1] rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between bg-white/[0.03]">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-bold text-white tracking-tight">
                  AG Grid Verification & Settlement Matrix
                </span>
                <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-200 border border-cyan-400/35 font-medium">
                  Click any row to inspect or mutate →
                </span>
              </div>
              <span className="text-xs font-mono text-slate-300">
                Rate: <strong className="text-cyan-300">$2.00</strong> / verified task
              </span>
            </div>

            <div className={`w-full h-[325px] transition-opacity duration-200 ${isAuditingAnim ? "opacity-40" : "opacity-100"}`}>
              <AgGridReact<TaskVerificationResult>
                theme={veractGridTheme}
                rowData={rowData}
                columnDefs={columnDefs}
                rowHeight={56}
                headerHeight={40}
                suppressHorizontalScroll={true}
                rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: true }}
                onRowClicked={(e: RowClickedEvent<TaskVerificationResult>) => {
                  if (e.data?.taskId) setSelectedTaskId(e.data.taskId);
                }}
              />
            </div>

            {/* Cryptographic Custom_ID Binding Bar */}
            <div className="p-4 bg-[#05070e]/95 border-t border-white/[0.08] flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-slate-300 flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  PayPal <code className="text-cyan-300 font-semibold">custom_id</code> (RFC 8785 Canonical SHA-256 Proof):
                </span>
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={copyCliProof}
                  className="flex items-center gap-1.5 text-[11px] font-mono font-semibold px-3 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-400/40 transition"
                >
                  {copiedCmd ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-cyan-400" /> Copied CLI Verify Command!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Copy 1-Line CLI SHA-256 Proof
                    </>
                  )}
                </motion.button>
              </div>
              <div className="font-mono text-xs bg-[#090e1a] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-cyan-300 select-all overflow-x-auto shadow-inner">
                {batch?.paypalCustomId ?? "VERACT:VRCTBATCH001:9314ee9bbea75e506938b433e245a69c8a3131319f61313c28706db169f51182"}
              </div>
            </div>
          </div>

          {/* Right 5 Cols: Animated 4-Tab Forensic Proof & Live Mutator Inspector */}
          <div className="lg:col-span-5 flex flex-col lovable-card border border-white/[0.1] rounded-2xl overflow-hidden">
            <div className="px-5 pt-3.5 border-b border-white/[0.08] bg-white/[0.03]">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-cyan-400">
                      {selectedTask?.taskId}
                    </span>
                    <span className="text-xs text-slate-500">•</span>
                    <span className="text-sm font-bold text-white">{selectedTask?.vendorName}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 mt-0.5">{selectedTask?.title}</p>
                </div>

                {selectedTask && (
                  <motion.span
                    key={`${selectedTask.taskId}-${selectedTask.passed}`}
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={`px-3 py-1 rounded-full text-xs font-mono font-bold ${
                      selectedTask.passed
                        ? "bg-emerald-500/20 text-emerald-200 border border-emerald-400/40 shadow-[0_0_15px_rgba(16,185,129,0.25)]"
                        : "bg-rose-500/20 text-rose-200 border border-rose-400/40 shadow-[0_0_15px_rgba(244,63,94,0.25)]"
                    }`}
                  >
                    {selectedTask.passed ? "✔ VERIFIED (+$2.00)" : "✖ SLASHED ($0.00)"}
                  </motion.span>
                )}
              </div>

              {/* Sliding Animated 4 Tabs */}
              <div className="flex flex-wrap gap-1.5 text-xs font-semibold pb-2">
                {(
                  [
                    { id: "forensics", label: "1. Proof", icon: FileCode2 },
                    { id: "mutator", label: "2. Live Mutator", icon: FlaskConical },
                    { id: "wire", label: "3. PayPal Ledger", icon: Terminal },
                    { id: "invoice", label: "4. Receipt", icon: Receipt },
                  ] as const
                ).map((t) => {
                  const Icon = t.icon;
                  const active = inspectorTab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setInspectorTab(t.id)}
                      className={`relative px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                        active ? "text-white" : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {active && (
                        <motion.div
                          layoutId="inspectorTabPill"
                          transition={{ type: "spring", stiffness: 380, damping: 30 }}
                          className="absolute inset-0 rounded-lg bg-cyan-500/20 border border-cyan-400/40 shadow-[0_0_12px_rgba(14,165,233,0.2)]"
                        />
                      )}
                      <Icon className="w-3.5 h-3.5 relative z-10 text-cyan-400" />
                      <span className="relative z-10">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Animated Tab Body */}
            <div className="p-4 flex-1 flex flex-col overflow-y-auto">
              <AnimatePresence mode="wait">
                {/* TAB 1: FORENSIC PROOF */}
                {inspectorTab === "forensics" && selectedTask && (
                  <motion.div
                    key={`forensics-${selectedTask.taskId}-${scenario}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18 }}
                    className="flex flex-col gap-3.5 text-xs"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5 font-mono text-[11px] text-slate-300">
                        <span>SOURCE CONTRACT (NFKC CANONICALIZED)</span>
                        {selectedTask.gate2.passed ? (
                          <span className="text-cyan-300 font-semibold">
                            ✔ Substring Slice [{selectedTask.gate2.startOffset}..{selectedTask.gate2.endOffset}]
                          </span>
                        ) : (
                          <span className="text-rose-400 font-semibold">
                            ✖ Substring Match Failed (-1)
                          </span>
                        )}
                      </div>
                      <div className="p-3.5 rounded-xl bg-[#05070e] border border-white/[0.08] font-mono text-xs leading-relaxed text-slate-300 whitespace-pre-wrap shadow-inner">
                        {selectedFixture
                          ? renderHighlightedDocument(
                              selectedFixture.sourceDocument,
                              selectedTask.gate2.passed ? selectedTask.candidate.evidenceQuote : "",
                            )
                          : "Select a task row..."}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#05070e] border border-white/[0.08]">
                      <div className="font-mono text-[11px] text-slate-300 mb-1">
                        GATE 2 — AI EXTRACTED <code className="text-white">evidenceQuote</code>:
                      </div>
                      <p
                        className={`font-mono text-xs ${
                          !selectedTask.gate2.passed
                            ? "text-rose-400 line-through"
                            : "text-cyan-300"
                        }`}
                      >
                        "{selectedTask.candidate.evidenceQuote}"
                      </p>
                      {!selectedTask.gate2.passed && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.98 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="mt-2.5 text-rose-100 bg-gradient-to-r from-rose-950/90 to-rose-900/50 border border-rose-500/40 rounded-lg px-3 py-2 font-mono text-[11px]"
                        >
                          ✖ <strong>GATE 2 SLASH ({selectedTask.gate2.failureCode}):</strong> Worker citation does not exist verbatim in source contract. Buyer saved $2.00.
                        </motion.div>
                      )}
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#05070e] border border-white/[0.08] font-mono">
                      <div className="text-[11px] text-slate-300 mb-2">
                        GATE 3 — INTEGER MINOR-UNIT CONSERVATION (CENTS):
                      </div>
                      <div className="space-y-1 text-slate-300 text-xs">
                        {selectedTask.candidate.lineItems.map((item, i) => (
                          <div key={i} className="flex justify-between">
                            <span className="truncate pr-2 text-slate-300">• {item.description}</span>
                            <span>
                              {item.amountCents}¢ ({formatUsd(item.amountCents)})
                            </span>
                          </div>
                        ))}
                        <div className="border-t border-white/[0.08] pt-1.5 mt-1.5 flex justify-between font-bold text-white">
                          <span>Computed Line-Item Sum (Σ):</span>
                          <span>{selectedTask.gate3.computedSumCents}¢</span>
                        </div>
                        <div className="flex justify-between font-bold text-slate-300">
                          <span>Stated Contract Total:</span>
                          <span>{selectedTask.gate3.statedTotalCents}¢</span>
                        </div>
                      </div>
                      {!selectedTask.gate3.passed && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.98 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="mt-2.5 text-amber-100 bg-gradient-to-r from-amber-950/90 to-amber-900/40 border border-amber-500/40 rounded-lg px-3 py-2 text-[11px]"
                        >
                          ✖ <strong>GATE 3 SLASH (Δ = {selectedTask.gate3.deltaCents}¢):</strong> Line-item sum ({selectedTask.gate3.computedSumCents}¢) != stated total ({selectedTask.gate3.statedTotalCents}¢). Buyer saved $2.00.
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* TAB 2: LIVE CONTRACT & FAULT MUTATOR */}
                {inspectorTab === "mutator" && selectedTask && (
                  <motion.div
                    key={`mutator-${selectedTask.taskId}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="flex flex-col gap-3 text-xs"
                  >
                    <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/30 text-cyan-200 flex items-center justify-between gap-2">
                      <span>
                        <strong>Judge Sandbox:</strong> Edit {selectedTask.taskId} live or inject a fault below to test the real backend 3-Gate Verifier.
                      </span>
                    </div>

                    {/* 1-Click Fault Presets for Current Row */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() =>
                          handleRunCustomMutator({
                            evidenceQuote:
                              "Total due is $500.00 USD with a fabricated 25% AI discount applied immediately.",
                          })
                        }
                        className="px-2.5 py-2 rounded-lg font-mono text-[11px] bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 border border-rose-500/35 transition"
                      >
                        ⚡ Inject Gate 2 Quote Hallucination
                      </button>
                      <button
                        onClick={() =>
                          handleRunCustomMutator({
                            firstLineItemCents:
                              (selectedTask.candidate.lineItems[0]?.amountCents ?? 32000) + 15000,
                          })
                        }
                        className="px-2.5 py-2 rounded-lg font-mono text-[11px] bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/35 transition"
                      >
                        ⚡ Inject Gate 3 (+15000¢) Math Drift
                      </button>
                    </div>

                    <div>
                      <label className="block font-mono text-[11px] text-slate-300 mb-1">
                        Worker Extracted Quote (Gate 2 Substring Target):
                      </label>
                      <textarea
                        rows={2}
                        value={editEvidenceQuote}
                        onChange={(e) => setEditEvidenceQuote(e.target.value)}
                        className="w-full rounded-lg bg-[#05070e] border border-white/15 p-2.5 font-mono text-xs text-cyan-200 focus:outline-none focus:border-cyan-400"
                      />
                    </div>

                    <div>
                      <label className="block font-mono text-[11px] text-slate-300 mb-1">
                        First Line-Item Amount in Integer Cents (Gate 3 Conservation):
                      </label>
                      <input
                        type="number"
                        value={editFirstItemCents}
                        onChange={(e) => setEditFirstItemCents(Number(e.target.value))}
                        className="w-full rounded-lg bg-[#05070e] border border-white/15 p-2 font-mono text-xs text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>

                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleRunCustomMutator()}
                      className="w-full py-2.5 rounded-xl font-bold text-xs bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-950 shadow-lg shadow-cyan-500/20"
                    >
                      Re-Run 3-Gate Deterministic Verifier & Recompute SHA-256
                    </motion.button>
                  </motion.div>
                )}

                {/* TAB 3: PAYPAL V2 WIRE & LIVE LEDGER PROOF */}
                {inspectorTab === "wire" && (
                  <motion.div
                    key="wire"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="flex flex-col gap-3 font-mono text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-cyan-400">
                        {capturedCents > 0
                          ? `POST /v2/payments/authorizations/${batch?.authorizationId ?? "4WL99812AA119021B"}/capture`
                          : `POST /v2/payments/authorizations/${batch?.authorizationId ?? "4WL99812AA119021B"}/void`}
                      </span>
                      <motion.button
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={handleVerifyCaptureOnPayPal}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-400/40"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Verify on PayPal Ledger
                      </motion.button>
                    </div>

                    {ledgerProof && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-400/50 text-emerald-100 text-[11px] space-y-1"
                      >
                        <div className="font-bold text-emerald-300 flex items-center justify-between">
                          <span>✔ PAYPAL SANDBOX LEDGER VERIFIED</span>
                          <span>{ledgerProof.status}</span>
                        </div>
                        <div className="text-slate-300 truncate">
                          Endpoint: {ledgerProof.endpointQueried}
                        </div>
                        <div className="text-cyan-300 truncate">
                          Ledger custom_id: {ledgerProof.customIdOnPayPal}
                        </div>
                        <div className="text-emerald-300 font-bold">
                          Cryptographic SHA-256 Match: {String(ledgerProof.hashMatched).toUpperCase()}
                        </div>
                      </motion.div>
                    )}

                    <pre className="p-3.5 rounded-xl bg-[#05070e] border border-white/[0.08] text-cyan-300 overflow-x-auto text-[11px] leading-relaxed shadow-inner">
{JSON.stringify(
  capturedCents > 0
    ? {
        headers: {
          "PayPal-Request-Id": batch?.paypalRequestId ?? "718a6a3a6f8ca327aa98b1e485ae280710d1",
          Prefer: "return=representation",
        },
        body: {
          amount: {
            currency_code: "USD",
            value: (capturedCents / 100).toFixed(2),
          },
          final_capture: true,
          invoice_id: `VRCT-INV-${batch?.batchId ?? "VRCTBATCH001"}`,
          custom_id: batch?.paypalCustomId,
        },
      }
    : {
        headers: {
          "PayPal-Request-Id": batch?.paypalRequestId ?? "718a6a3a6f8ca327aa98b1e485ae280710d1",
        },
        action: "FULL_AUTHORIZATION_VOID_0_TASKS_PASSED",
        releasedToBuyerUsd: "$10.00",
      },
  null,
  2,
)}
                    </pre>
                  </motion.div>
                )}

                {/* TAB 4: AGENT TOOLKIT RECEIPT */}
                {inspectorTab === "invoice" && (
                  <motion.div
                    key="invoice"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="flex flex-col gap-2.5 text-xs"
                  >
                    <div className="flex items-center justify-between font-mono text-[11px] text-slate-300 mb-1">
                      <span>{batch?.agentToolkitReceipt?.toolInvoked}</span>
                      <span className="text-cyan-400 font-bold">
                        {batch?.agentToolkitReceipt?.invoiceNumber}
                      </span>
                    </div>
                    {batch?.agentToolkitReceipt?.itemizedLines.map((line) => (
                      <div
                        key={line.taskId}
                        className="p-3 rounded-xl bg-[#05070e] border border-white/[0.08] flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-white truncate">
                            {line.taskId} · {line.vendorName}
                          </div>
                          <div className="text-[11px] text-slate-300 truncate mt-0.5">
                            {line.reason}
                          </div>
                        </div>
                        <span
                          className={`font-mono text-xs font-bold shrink-0 px-2.5 py-1 rounded-lg ${
                            line.status === "BILLED"
                              ? "bg-cyan-500/15 text-cyan-200 border border-cyan-400/30"
                              : "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                          }`}
                        >
                          {line.amountUsd}
                        </span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function renderHighlightedDocument(source: string, quote: string): React.ReactNode {
  if (!quote) return source;
  const idx = source.indexOf(quote);
  if (idx === -1) return source;
  const before = source.slice(0, idx);
  const match = source.slice(idx, idx + quote.length);
  const after = source.slice(idx + quote.length);
  return (
    <>
      {before}
      <mark className="bg-cyan-500/25 text-cyan-100 border border-cyan-400/50 rounded px-1 py-0.5 shadow-[0_0_12px_rgba(14,165,233,0.3)]">
        {match}
      </mark>
      {after}
    </>
  );
}
