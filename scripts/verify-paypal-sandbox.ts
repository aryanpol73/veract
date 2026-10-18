// scripts/verify-paypal-sandbox.ts
// Day-1 Kill Gate: $10.00 AUTHORIZE -> buyer approval -> authorize -> $6.00 final partial capture.
// Run: npx tsx scripts/verify-paypal-sandbox.ts
// Env: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, optional PAYPAL_IDEMPOTENCY_SECRET, PAYPAL_RETURN_URL, PAYPAL_CANCEL_URL

import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { createServer, type Server } from "node:http";
import process from "node:process";
import {
  PayPalApiError,
  PayPalClient,
  PAYPAL_SANDBOX_BASE_URL,
} from "../src/server/paypal/paypalClient.js";
import { assertConservation, centsToUsdString, computeSettlement } from "../src/shared/money.js";

const AUTHORIZED_CENTS = 1000; // $10.00
const CENTS_PER_TASK = 200; // $2.00 per verified task
const TOTAL_TASKS = 5;
const PASSED_TASKS = 3; // -> $6.00 capture, $4.00 released
const LOCAL_CALLBACK_PORT = 8888;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`✖ Missing required env var: ${name}`);
    process.exit(2);
  }
  return value;
}

const usd = (cents: number) => `$${centsToUsdString(cents)}`;
const step = (n: number, msg: string) => console.log(`\n[${n}/5] ${msg}`);

function demoAuditSha256(batchId: string): string {
  const payload = JSON.stringify({
    batchId,
    centsPerTask: CENTS_PER_TASK,
    passedTasks: PASSED_TASKS,
    totalTasks: TOTAL_TASKS,
    version: "veract-sandbox-check/v1",
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function startTransientCallbackServer(expectedOrderId: string): {
  server: Server;
  approvalPromise: Promise<{ approved: boolean; payerId?: string }>;
} {
  let resolvePromise: (val: { approved: boolean; payerId?: string }) => void;
  let rejectPromise: (err: Error) => void;

  const approvalPromise = new Promise<{ approved: boolean; payerId?: string }>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${LOCAL_CALLBACK_PORT}`);

    if (url.pathname === "/callback") {
      const token = url.searchParams.get("token");
      const payerId = url.searchParams.get("PayerID") ?? undefined;

      if (!token || token !== expectedOrderId) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h3>400 Bad Request: Token mismatch or missing</h3>");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Veract Sandbox Authorization</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 2rem; max-width: 440px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h2 { color: #38bdf8; margin: 0 0 10px; }
    p { color: #94a3b8; font-size: 15px; line-height: 1.5; }
    .code { font-family: monospace; background: #090d16; padding: 4px 8px; border-radius: 4px; color: #a5f3fc; }
  </style>
</head>
<body>
  <div class="card">
    <h2>✔ Pre-Authorization Approved</h2>
    <p>PayPal Order <span class="code">${token}</span> verified.</p>
    <p>You can close this tab and return to your terminal to watch the settlement complete.</p>
  </div>
</body>
</html>`);

      resolvePromise({ approved: true, payerId });
    } else if (url.pathname === "/cancel") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Veract Order Cancelled</title><style>body { font-family: sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; } .card { background: #1e293b; border-radius: 12px; padding: 2rem; text-align: center; max-width: 440px; }</style></head>
<body>
  <div class="card">
    <h2 style="color: #f87171;">✖ Authorization Cancelled</h2>
    <p>Order was cancelled by buyer. No funds held or captured.</p>
  </div>
</body>
</html>`);

      resolvePromise({ approved: false });
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  server.listen(LOCAL_CALLBACK_PORT);
  return { server, approvalPromise };
}

async function main(): Promise<void> {
  const client = new PayPalClient({
    clientId: requireEnv("PAYPAL_CLIENT_ID"),
    clientSecret: requireEnv("PAYPAL_CLIENT_SECRET"),
    baseUrl: PAYPAL_SANDBOX_BASE_URL,
    idempotency: process.env.PAYPAL_IDEMPOTENCY_SECRET
      ? { secret: process.env.PAYPAL_IDEMPOTENCY_SECRET }
      : {},
  });

  const batchId = randomBytes(9).toString("base64url"); // exactly 12 chars
  const settlement = computeSettlement(AUTHORIZED_CENTS, PASSED_TASKS, CENTS_PER_TASK);
  const auditSha256 = demoAuditSha256(batchId);

  console.log("VERACT — PayPal Sandbox Kill Gate");
  console.log(` batchId : ${batchId}`);
  console.log(` authorize : ${usd(settlement.authorizedCents)}`);
  console.log(` capture : ${usd(settlement.capturedCents)} (${PASSED_TASKS}/${TOTAL_TASKS} verified)`);
  console.log(` release : ${usd(settlement.releasedCents)}`);
  console.log(` audit sha256: ${auditSha256}`);

  step(1, "Fetching OAuth2 access token...");
  await client.getAccessToken();
  console.log(" ✔ token acquired");

  step(2, `Creating AUTHORIZE order for ${usd(AUTHORIZED_CENTS)}...`);
  const returnUrl = process.env.PAYPAL_RETURN_URL ?? `http://localhost:${LOCAL_CALLBACK_PORT}/callback`;
  const cancelUrl = process.env.PAYPAL_CANCEL_URL ?? `http://localhost:${LOCAL_CALLBACK_PORT}/cancel`;

  const order = await client.createAuthOrder({
    batchId,
    amountCents: AUTHORIZED_CENTS,
    returnUrl,
    cancelUrl,
    description: `Veract batch ${batchId} two-phase pre-authorization`,
  });
  console.log(` ✔ order ${order.orderId} (status ${order.status})`);
  console.log(` PayPal-Request-Id: ${order.requestId}`);

  step(3, "Buyer approval required");
  console.log(" Open this URL, log in with a SANDBOX PERSONAL account, and approve:");
  console.log(`\n ${order.approvalUrl}\n`);
  console.log(" (Waiting for local callback or manual Enter key...)");

  const { server, approvalPromise } = startTransientCallbackServer(order.orderId);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const manualEnterPromise = rl.question(" Press Enter once you have approved the order... ").then(() => ({
    approved: true,
  }));

  try {
    const outcome = await Promise.race([approvalPromise, manualEnterPromise]);
    if (!outcome.approved) {
      console.log("\n ✖ Order was cancelled by buyer. Aborting without placing hold.");
      process.exit(0);
    }
    console.log(" ✔ Buyer approval confirmed.");
  } finally {
    rl.close();
    server.close();
  }

  step(4, "Authorizing order (placing hold)...");
  const auth = await client.authorizeOrder(order.orderId);
  console.log(` ✔ authorization ${auth.authorizationId} (status ${auth.authorizationStatus})`);
  console.log(` authorized: ${usd(auth.authorizedCents)}, expires: ${auth.expirationTime ?? "n/a"}`);
  console.log(` PayPal-Request-Id: ${auth.requestId}`);

  if (auth.authorizationStatus !== "CREATED") {
    throw new Error(`Expected authorization status CREATED, got ${auth.authorizationStatus}`);
  }
  if (auth.authorizedCents !== AUTHORIZED_CENTS) {
    throw new Error(`Authorized ${auth.authorizedCents}¢ but expected ${AUTHORIZED_CENTS}¢`);
  }

  step(5, `Capturing ${usd(settlement.capturedCents)} with final_capture=true...`);
  let capture;
  try {
    capture = await client.captureAuthorization({
      authorizationId: auth.authorizationId,
      batchId,
      amountCents: settlement.capturedCents,
      auditSha256,
      finalCapture: true,
    });
  } catch (err) {
    console.error(" ✖ capture failed — attempting void to release the hold...");
    try {
      const voided = await client.voidAuthorization(auth.authorizationId);
      console.error(` ↺ authorization ${voided.authorizationId} ${voided.status}`);
    } catch (voidErr) {
      console.error(` ✖ void also failed: ${(voidErr as Error).message}`);
    }
    throw err;
  }

  if (capture.status !== "COMPLETED" && capture.status !== "PENDING") {
    throw new Error(`Unexpected capture status: ${capture.status}`);
  }

  assertConservation(
    auth.authorizedCents,
    [capture.capturedCents, auth.authorizedCents - capture.capturedCents],
    "sandbox-settlement",
  );

  console.log(` ✔ capture ${capture.captureId} (status ${capture.status})`);
  console.log(` captured : ${usd(capture.capturedCents)}`);
  console.log(` released : ${usd(auth.authorizedCents - capture.capturedCents)} (auto via final_capture)`);
  console.log(` custom_id: ${capture.customId} (${capture.customId.length} chars)`);
  console.log(` PayPal-Request-Id: ${capture.requestId}`);

  console.log("\n KILL GATE PASSED — two-phase pre-authorization & proportional partial capture verified.");
}

main().catch((err: unknown) => {
  console.error("\n KILL GATE FAILED");
  if (err instanceof PayPalApiError) {
    console.error(` ${err.message}`);
    console.error(` status=${err.status} issue=${err.issue ?? "n/a"} debug_id=${err.debugId ?? "n/a"}`);
    console.error(` details=${JSON.stringify(err.details, null, 2)}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
