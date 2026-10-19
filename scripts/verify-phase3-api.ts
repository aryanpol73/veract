// scripts/verify-phase3-api.ts
// Automated end-to-end verification of the Phase 3 Express Server, CAS State Machine,
// 3-Gate Verifier orchestration, and PayPal Partial Capture integration.
// Run: npx tsx scripts/verify-phase3-api.ts
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { BatchStore } from "../src/server/db/batchStore.js";
import { createVeractApp } from "../src/server/index.js";
import type {
  AuthorizeOrderResult,
  CaptureAuthorizationInput,
  CaptureAuthorizationResult,
  CreateAuthOrderInput,
  CreateAuthOrderResult,
  PayPalClient,
} from "../src/server/paypal/paypalClient.js";
import { buildVeractCustomId } from "../src/server/paypal/paypalClient.js";

async function main(): Promise<void> {
  const testDbPath = resolve(process.cwd(), "data", "batches.test.json");
  rmSync(testDbPath, { force: true });

  const store = new BatchStore(testDbPath);

  // Deterministic Mock PayPal Client to test full Express state machine & CAS locking offline
  const mockPayPal = {
    async createAuthOrder(input: CreateAuthOrderInput): Promise<CreateAuthOrderResult> {
      return {
        orderId: `ORD_${input.batchId}`,
        status: "PAYER_ACTION_REQUIRED",
        approvalUrl: `https://www.sandbox.paypal.com/checkoutnow?token=ORD_${input.batchId}`,
        requestId: `req_create_${input.batchId}`,
        raw: { id: `ORD_${input.batchId}`, status: "PAYER_ACTION_REQUIRED" },
      };
    },
    async authorizeOrder(orderId: string): Promise<AuthorizeOrderResult> {
      return {
        orderId,
        orderStatus: "COMPLETED",
        authorizationId: `AUTH_${orderId}`,
        authorizationStatus: "CREATED",
        authorizedCents: 1000,
        expirationTime: "2026-11-17T00:00:00Z",
        requestId: `req_auth_${orderId}`,
        raw: { id: orderId, status: "COMPLETED" },
      };
    },
    async captureAuthorization(
      input: CaptureAuthorizationInput,
    ): Promise<CaptureAuthorizationResult> {
      return {
        captureId: `CAP_${input.batchId}`,
        status: "COMPLETED",
        capturedCents: input.amountCents,
        customId: buildVeractCustomId(input.batchId, input.auditSha256),
        requestId: `req_cap_${input.batchId}`,
        raw: { id: `CAP_${input.batchId}`, status: "COMPLETED" },
      };
    },
  } as unknown as PayPalClient;

  const app = createVeractApp(store, mockPayPal);
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 4099;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    console.log("==========================================================================");
    console.log("VERACT — Phase 3: Express API & CAS State-Machine Integration Verification");
    console.log("==========================================================================\n");

    // Step 1: Create Order
    const createRes = await fetch(`${baseUrl}/api/batches/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin: "http://localhost:5173" }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { batchId: string; state: string; orderId: string };
    assert.equal(created.state, "CREATED");
    console.log(`[1/4] POST /api/batches/create-order     -> ✔ Batch ${created.batchId} (state=${created.state})`);

    // Step 2: Authorize Order
    const authRes = await fetch(`${baseUrl}/api/batches/${created.batchId}/authorize`, {
      method: "POST",
    });
    assert.equal(authRes.status, 200);
    const authorized = (await authRes.json()) as { state: string; authorizationId: string };
    assert.equal(authorized.state, "AUTHORIZED");
    console.log(`[2/4] POST /api/batches/:id/authorize    -> ✔ Auth ${authorized.authorizationId} (state=${authorized.state})`);

    // Step 3: Execute 5-Task Worker + 3-Gate Verifier + Partial Capture
    const settleRes = await fetch(`${baseUrl}/api/batches/${created.batchId}/execute-and-settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "seeded" }),
    });
    assert.equal(settleRes.status, 200);
    const settled = (await settleRes.json()) as {
      state: string;
      capturedCents: number;
      releasedCents: number;
      captureId: string;
      paypalCustomId: string;
      agentToolkitReceipt: { itemizedLines: unknown[] };
    };
    assert.equal(settled.state, "CAPTURED");
    assert.equal(settled.capturedCents, 600);
    assert.equal(settled.releasedCents, 400);
    assert.equal(settled.agentToolkitReceipt.itemizedLines.length, 5);
    console.log(
      `[3/4] POST /api/batches/:id/settle       -> ✔ Capture ${settled.captureId} ($6.00 captured, $4.00 released)`,
    );
    console.log(`      PayPal custom_id                   -> ${settled.paypalCustomId}`);

    // Step 4: Verify Idempotency on duplicate settle call
    const dupRes = await fetch(`${baseUrl}/api/batches/${created.batchId}/execute-and-settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "seeded" }),
    });
    assert.equal(dupRes.status, 200);
    const dupBody = (await dupRes.json()) as { captureId: string };
    assert.equal(dupBody.captureId, settled.captureId);
    console.log(`[4/4] Idempotent Replay Protection       -> ✔ Duplicate settle returned cached ${dupBody.captureId}`);

    console.log("\n✅ PHASE 3 EXPRESS API & CAS STATE MACHINE PASSED ALL ASSERTIONS.");
  } finally {
    server.close();
    rmSync(testDbPath, { force: true });
  }
}

main();
