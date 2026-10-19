// scripts/verify-phase2-engine.ts
// Phase 2 Deterministic Verifier & Cryptographic Audit Hash Self-Test (0 API calls, 0 tokens).
// Run: npx tsx scripts/verify-phase2-engine.ts
import assert from "node:assert/strict";
import { centsToUsdString } from "../src/shared/money.js";
import {
  DEFAULT_BATCH_AUTHORIZED_CENTS,
  DEFAULT_CENTS_PER_TASK,
  VERACT_DEMO_FIXTURES,
} from "../src/server/worker/fixtures.js";
import { verifyBatch } from "../src/server/verifier/veractVerifier.js";

const usd = (cents: number) => `$${centsToUsdString(cents)}`;

function main(): void {
  const batchId = "VRCTBATCH001"; // 12 chars matching /^[A-Za-z0-9_-]{12}$/
  const summary = verifyBatch(
    batchId,
    VERACT_DEMO_FIXTURES,
    DEFAULT_BATCH_AUTHORIZED_CENTS,
    DEFAULT_CENTS_PER_TASK,
  );

  console.log("==========================================================================");
  console.log("VERACT — Phase 2: 3-Gate Deterministic Verifier & Audit Hash Verification");
  console.log("==========================================================================\n");

  for (const r of summary.results) {
    const g1 = r.gate1.passed ? "PASS" : `FAIL(${r.gate1.errors.join(";")})`;
    const g2 = r.gate2.passed
      ? `PASS[${r.gate2.startOffset}..${r.gate2.endOffset}]`
      : `FAIL(${r.gate2.failureCode})`;
    const g3 = r.gate3.passed
      ? `PASS(${r.gate3.computedSumCents}¢)`
      : `FAIL(sum=${r.gate3.computedSumCents}¢ != stated=${r.gate3.statedTotalCents}¢, Δ=${r.gate3.deltaCents}¢)`;
    const statusIcon = r.passed ? "✔ PASS" : "✖ SLASHED";

    console.log(
      `${r.taskId} | ${statusIcon.padEnd(9)} | Billed: ${usd(r.billableCents)} | G1: ${g1} | G2: ${g2} | G3: ${g3}`,
    );
  }

  console.log("\n--------------------------------------------------------------------------");
  console.log(`Batch ID         : ${summary.batchId}`);
  console.log(`Tasks Verified   : ${summary.passedTasks}/${summary.totalTasks} Passed (${summary.failedTasks} Rejected)`);
  console.log(`Authorized Hold  : ${usd(summary.authorizedCents)} (${summary.authorizedCents}¢)`);
  console.log(`Final Capture    : ${usd(summary.capturedCents)} (${summary.capturedCents}¢)`);
  console.log(`Auto-Released    : ${usd(summary.releasedCents)} (${summary.releasedCents}¢ saved by buyer)`);
  console.log(`Audit SHA-256    : ${summary.auditSha256}`);
  console.log(`PayPal custom_id : ${summary.paypalCustomId} (${summary.paypalCustomId.length}/127 chars)`);
  console.log("--------------------------------------------------------------------------");

  // Hard deterministic assertions
  assert.equal(summary.passedTasks, 3, "Expected exactly 3 passed tasks");
  assert.equal(summary.failedTasks, 2, "Expected exactly 2 failed tasks");
  assert.equal(summary.capturedCents, 600, "Expected $6.00 (600¢) captured");
  assert.equal(summary.releasedCents, 400, "Expected $4.00 (400¢) released");
  assert.equal(summary.results[2]?.passed, false, "TASK-103 must fail");
  assert.equal(summary.results[2]?.gate2.failureCode, "SUBSTRING_NOT_FOUND", "TASK-103 must fail Gate 2");
  assert.equal(summary.results[4]?.passed, false, "TASK-105 must fail");
  assert.equal(summary.results[4]?.gate3.deltaCents, 30000, "TASK-105 must fail Gate 3 with +30000¢ delta");
  assert.match(summary.auditSha256, /^[a-f0-9]{64}$/, "Audit SHA-256 must be 64 lowercase hex chars");
  assert.ok(summary.paypalCustomId.length <= 127, "PayPal custom_id must be <= 127 chars");

  console.log("\n✅ PHASE 2 VERIFIER ENGINE PASSED ALL ASSERTIONS (0 LLM calls, 0 float math).");
}

main();
