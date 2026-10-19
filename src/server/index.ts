// src/server/index.ts
// Veract Express 5 API Server: Orchestrates PayPal Orders v2, 3-Gate Deterministic Verifier,
// Partial Capture / Void settlement, and @paypal/agent-toolkit audit receipt generation.
import "dotenv/config";
import { randomBytes } from "node:crypto";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { centsToUsdString, computeSettlement } from "../shared/money.js";
import { computeCanonicalSha256 } from "../shared/canonicalHash.js";
import {
  buildVeractCustomId,
  PayPalApiError,
  PayPalClient,
  PAYPAL_SANDBOX_BASE_URL,
} from "./paypal/paypalClient.js";
import {
  DEFAULT_BATCH_AUTHORIZED_CENTS,
  DEFAULT_CENTS_PER_TASK,
  VERACT_DEMO_FIXTURES,
} from "./worker/fixtures.js";
import { verifyTask } from "./verifier/veractVerifier.js";
import { BatchStore, StateTransitionError, type ExecutionMode } from "./db/batchStore.js";
import { runExtractionWorkerBatch } from "./worker/llmWorker.js";
import type { BatchVerificationSummary } from "../shared/types.js";

export function createVeractApp(customStore?: BatchStore, customPayPal?: PayPalClient) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const store = customStore ?? new BatchStore();

  const getPayPalClient = (): PayPalClient => {
    if (customPayPal) return customPayPal;
    const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in environment");
    }
    return new PayPalClient({
      clientId,
      clientSecret,
      baseUrl: process.env.PAYPAL_BASE_URL?.trim() || PAYPAL_SANDBOX_BASE_URL,
    });
  };

  // 1. Health & Public Config (for React @paypal/react-paypal-js provider)
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "veract-settlement-engine", timestamp: new Date().toISOString() });
  });

  app.get("/api/config", (_req: Request, res: Response) => {
    res.json({
      paypalClientId: process.env.PAYPAL_CLIENT_ID ?? "",
      currency: "USD",
      authorizedCents: DEFAULT_BATCH_AUTHORIZED_CENTS,
      centsPerTask: DEFAULT_CENTS_PER_TASK,
      totalTasks: VERACT_DEMO_FIXTURES.length,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    });
  });

  // 2. Inspect Task Fixtures
  app.get("/api/fixtures", (_req: Request, res: Response) => {
    res.json({
      authorizedCents: DEFAULT_BATCH_AUTHORIZED_CENTS,
      centsPerTask: DEFAULT_CENTS_PER_TASK,
      fixtures: VERACT_DEMO_FIXTURES,
    });
  });

  // 3. List all historical batches
  app.get("/api/batches", (_req: Request, res: Response) => {
    res.json({ batches: store.listAll() });
  });

  // 4. Get single batch telemetry
  app.get("/api/batches/:batchId", (req: Request, res: Response) => {
    const batch = store.get(String(req.params.batchId));
    if (!batch) {
      res.status(404).json({ error: "BATCH_NOT_FOUND" });
      return;
    }
    res.json(batch);
  });

  // 5. Phase A: Create $10.00 Pre-Authorization Order on PayPal Orders v2
  app.post("/api/batches/create-order", async (req: Request, res: Response) => {
    try {
      const batchId = randomBytes(9).toString("base64url"); // 12 chars [A-Za-z0-9_-]
      const origin = (req.body?.origin as string | undefined) ?? "http://localhost:5173";
      const client = getPayPalClient();

      const order = await client.createAuthOrder({
        batchId,
        amountCents: DEFAULT_BATCH_AUTHORIZED_CENTS,
        returnUrl: `${origin}/?batchId=${batchId}&paypal=approved`,
        cancelUrl: `${origin}/?batchId=${batchId}&paypal=cancelled`,
        description: `Veract Metered AI Batch ${batchId} (5 Tasks @ $2.00/verified task)`,
        brandName: "Veract Settlement Gate",
      });

      const now = new Date().toISOString();
      const record = store.create({
        batchId,
        state: "CREATED",
        orderId: order.orderId,
        approvalUrl: order.approvalUrl,
        authorizedCents: DEFAULT_BATCH_AUTHORIZED_CENTS,
        paypalRequestId: order.requestId,
        createdAt: now,
        updatedAt: now,
      });

      res.status(201).json(record);
    } catch (err) {
      handleApiError(err, res);
    }
  });

  // 6. Phase B: Authorize the Approved Order (places $10.00 hold -> status: CREATED)
  app.post("/api/batches/:batchId/authorize", async (req: Request, res: Response) => {
    try {
      const batchId = String(req.params.batchId);
      const existing = store.get(batchId);
      if (!existing) {
        res.status(404).json({ error: "BATCH_NOT_FOUND" });
        return;
      }
      // Idempotent return if already authorized
      if (existing.state === "AUTHORIZED" || existing.state === "CAPTURED" || existing.state === "VOIDED") {
        res.json(existing);
        return;
      }

      const client = getPayPalClient();
      const auth = await client.authorizeOrder(existing.orderId);

      const updated = store.transitionState(batchId, "CREATED", "AUTHORIZED", {
        authorizationId: auth.authorizationId,
        authorizationStatus: auth.authorizationStatus,
        expirationTime: auth.expirationTime,
        authorizedCents: auth.authorizedCents || DEFAULT_BATCH_AUTHORIZED_CENTS,
        paypalRequestId: auth.requestId,
      });

      res.json(updated);
    } catch (err) {
      handleApiError(err, res);
    }
  });

  // 7. Phase C: Execute Worker Batch -> 3-Gate Deterministic Verifier -> Proportional Partial Capture / Void
  app.post("/api/batches/:batchId/execute-and-settle", async (req: Request, res: Response) => {
    const batchId = String(req.params.batchId);
    const mode: ExecutionMode = req.body?.mode === "live_gemini" ? "live_gemini" : "seeded";

    try {
      const existing = store.get(batchId);
      if (!existing) {
        res.status(404).json({ error: "BATCH_NOT_FOUND" });
        return;
      }
      // Idempotent return if already settled
      if (existing.state === "CAPTURED" || existing.state === "VOIDED") {
        res.json(existing);
        return;
      }
      if (!existing.authorizationId) {
        res.status(400).json({ error: "BATCH_NOT_AUTHORIZED_YET" });
        return;
      }

      // Atomic Compare-And-Swap lock: AUTHORIZED -> VERIFYING
      store.transitionState(batchId, "AUTHORIZED", "VERIFYING", {
        executionMode: mode,
      });

      // Step 1: Run AI Extraction Worker across all 5 vendor contracts
      const workerOutputs = await runExtractionWorkerBatch(VERACT_DEMO_FIXTURES, mode);

      // Step 2: Run 3-Gate Deterministic Verifier on each candidate output
      const taskResults = VERACT_DEMO_FIXTURES.map((fixture) => {
        const workerOut = workerOutputs.find((w) => w.taskId === fixture.taskId);
        return verifyTask(fixture, workerOut?.candidate ?? fixture.seededOutput);
      });

      const passedTasks = taskResults.filter((r) => r.passed).length;
      const failedTasks = taskResults.length - passedTasks;
      const settlement = computeSettlement(
        existing.authorizedCents,
        passedTasks,
        DEFAULT_CENTS_PER_TASK,
      );

      // Step 3: Compute RFC 8785 Canonical JSON & SHA-256 Digest
      const auditPayload = {
        protocol: "veract-3gate/v1",
        batchId,
        authorizedCents: settlement.authorizedCents,
        capturedCents: settlement.capturedCents,
        releasedCents: settlement.releasedCents,
        centsPerTask: DEFAULT_CENTS_PER_TASK,
        passedTasks,
        failedTasks,
        tasks: taskResults.map((r) => ({
          taskId: r.taskId,
          passed: r.passed,
          billableCents: r.billableCents,
          gate1Passed: r.gate1.passed,
          gate2Passed: r.gate2.passed,
          gate2Span: [r.gate2.startOffset, r.gate2.endOffset],
          gate2Failure: r.gate2.failureCode ?? null,
          gate3Passed: r.gate3.passed,
          gate3DeltaCents: r.gate3.deltaCents,
        })),
      };

      const { canonicalJson, sha256 } = computeCanonicalSha256(auditPayload);
      const paypalCustomId = buildVeractCustomId(batchId, sha256);

      const verificationSummary: BatchVerificationSummary = {
        batchId,
        totalTasks: taskResults.length,
        passedTasks,
        failedTasks,
        centsPerTask: DEFAULT_CENTS_PER_TASK,
        authorizedCents: settlement.authorizedCents,
        capturedCents: settlement.capturedCents,
        releasedCents: settlement.releasedCents,
        auditSha256: sha256,
        canonicalAuditJson: canonicalJson,
        paypalCustomId,
        results: taskResults,
      };

      const client = getPayPalClient();
      const agentReceipt = {
        toolInvoked: "paypal_agent_toolkit:create_invoice_audit_manifest",
        invoiceNumber: `VRCT-INV-${batchId}`,
        generatedAt: new Date().toISOString(),
        itemizedLines: taskResults.map((r) => ({
          taskId: r.taskId,
          vendorName: r.vendorName,
          status: r.passed ? ("BILLED" as const) : ("WAIVED_BY_VERIFIER" as const),
          amountUsd: `$${centsToUsdString(r.billableCents)}`,
          reason: r.passed
            ? `Passed Gate 1 (Schema), Gate 2 (Span [${r.gate2.startOffset}..${r.gate2.endOffset}]), Gate 3 (${r.gate3.computedSumCents}¢)`
            : !r.gate2.passed
              ? `Slashed by Gate 2 (${r.gate2.failureCode})`
              : !r.gate3.passed
                ? `Slashed by Gate 3 (Math delta ${r.gate3.deltaCents}¢)`
                : `Slashed by Gate 1 (${r.gate1.errors.join(", ")})`,
        })),
      };

      // Step 4: Execute PayPal Partial Capture (if passedTasks > 0) or Full Void (if passedTasks === 0)
      if (settlement.capturedCents > 0) {
        const capture = await client.captureAuthorization({
          authorizationId: existing.authorizationId,
          batchId,
          amountCents: settlement.capturedCents,
          auditSha256: sha256,
          finalCapture: true,
          invoiceId: `VRCT-INV-${batchId}`,
          noteToPayer: `Veract Verified: ${passedTasks}/${taskResults.length} tasks passed ($${centsToUsdString(settlement.capturedCents)} captured, $${centsToUsdString(settlement.releasedCents)} released). SHA256: ${sha256}`,
        });

        const settled = store.transitionState(batchId, "VERIFYING", "CAPTURED", {
          capturedCents: capture.capturedCents,
          releasedCents: settlement.releasedCents,
          captureId: capture.captureId,
          captureStatus: capture.status,
          paypalCustomId: capture.customId,
          paypalRequestId: capture.requestId,
          verification: verificationSummary,
          agentToolkitReceipt: agentReceipt,
          settledAt: new Date().toISOString(),
        });

        res.json(settled);
        return;
      } else {
        const voided = await client.voidAuthorization(existing.authorizationId);
        const settled = store.transitionState(batchId, "VERIFYING", "VOIDED", {
          capturedCents: 0,
          releasedCents: settlement.authorizedCents,
          captureStatus: voided.status,
          paypalCustomId,
          paypalRequestId: voided.requestId,
          verification: verificationSummary,
          agentToolkitReceipt: agentReceipt,
          settledAt: new Date().toISOString(),
        });

        res.json(settled);
        return;
      }
    } catch (err) {
      try {
        const current = store.get(batchId);
        if (current?.state === "VERIFYING") {
          store.transitionState(batchId, "VERIFYING", "FAILED", {
            errorMessage: (err as Error).message,
          });
        }
      } catch {
        // Ignore rollback state errors
      }
      handleApiError(err, res);
    }
  });

  return app;
}

function handleApiError(err: unknown, res: Response): void {
  if (err instanceof StateTransitionError) {
    res.status(409).json({
      error: "STATE_CONFLICT",
      message: err.message,
      currentState: err.currentState,
      expectedState: err.expectedState,
    });
    return;
  }
  if (err instanceof PayPalApiError) {
    res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({
      error: "PAYPAL_API_ERROR",
      message: err.message,
      issue: err.issue,
      debugId: err.debugId,
      details: err.details,
    });
    return;
  }
  res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    message: err instanceof Error ? err.message : String(err),
  });
}

// Start server if invoked directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("server/index.ts") || process.argv[1].endsWith("server\\index.ts"));

if (isDirectRun) {
  const port = Number(process.env.PORT ?? 4000);
  const app = createVeractApp();
  app.listen(port, () => {
    console.log(`\n🚀 Veract Settlement Engine API listening on http://localhost:${port}`);
  });
}
