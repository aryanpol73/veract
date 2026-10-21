// scripts/verify-ingestion-pipeline.ts
// Automated verification for Directory Ingestion Service and External Agent Webhook Pipeline.
// Run: npx tsx scripts/verify-ingestion-pipeline.ts

import assert from "node:assert/strict";
import { scanLocalInvoices } from "../src/services/ingestion.js";
import { createVeractApp } from "../src/server/index.js";
import { BatchStore } from "../src/server/db/batchStore.js";
import { resolve } from "node:path";
import { rmSync } from "node:fs";

async function main(): Promise<void> {
  console.log("==========================================================================");
  console.log("VERACT — Directory Ingestion & External Agent Webhook Verification");
  console.log("==========================================================================\n");

  // Step 1: Verify scanLocalInvoices()
  console.log("[1/4] Testing scanLocalInvoices() on data/invoices/...");
  const docs = await scanLocalInvoices();
  assert(docs.length > 0, "Expected at least 1 document in data/invoices/");
  const messyOcr = docs.find((d) => d.filename.includes("messy_ocr_01.json"));
  assert(messyOcr, "Expected messy_ocr_01.json to be discovered and parsed");
  assert(messyOcr.extractedPayload, "Expected extractedPayload to be parsed");
  console.log(`      ✔ Discovered ${docs.length} documents (including ${messyOcr.filename})`);

  // Step 2: Test Express App with Ingestion Endpoints
  const testDbPath = resolve(process.cwd(), "data", "batches.ingest-test.json");
  rmSync(testDbPath, { force: true });
  const store = new BatchStore(testDbPath);
  const app = createVeractApp(store);

  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server address failed");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // Step 2A: Test POST /api/batches/scan-local
    console.log("\n[2/4] Testing POST /api/batches/scan-local...");
    const scanRes = await fetch(`${baseUrl}/api/batches/scan-local`, { method: "POST" });
    assert.equal(scanRes.status, 200);
    const scanData = await scanRes.json();
    assert.equal(scanData.batches.length, docs.length);
    const ocrBatch1 = scanData.batches.find((b: any) => b.filename.includes("messy_ocr_01.json"));
    assert(ocrBatch1, "Expected messy_ocr_01 batch in response");
    console.log(`      ✔ messy_ocr_01 status: ${ocrBatch1.status} (G1:${ocrBatch1.verification.gates.gate1_schema}, G2:${ocrBatch1.verification.gates.gate2_grounding}, G3:${ocrBatch1.verification.gates.gate3_semantic})`);

    const ocrBatch2 = scanData.batches.find((b: any) => b.filename.includes("messy_ocr_02_verified.json"));
    assert(ocrBatch2, "Expected messy_ocr_02_verified batch in response");
    assert.equal(ocrBatch2.status, "VERIFIED");
    console.log(`      ✔ messy_ocr_02_verified status: ${ocrBatch2.status} (G1:${ocrBatch2.verification.gates.gate1_schema}, G2:${ocrBatch2.verification.gates.gate2_grounding}, G3:${ocrBatch2.verification.gates.gate3_semantic})`);

    // Step 3: Test POST /api/batches/ingest with messy OCR payload
    console.log("\n[3/4] Testing POST /api/batches/ingest with Messy OCR Fixture...");
    const ingestRes1 = await fetch(`${baseUrl}/api/batches/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "autogen-ocr-agent",
        contractText: messyOcr.rawSourceText,
        workerExtractionPayload: messyOcr.extractedPayload,
        autoSettle: false,
      }),
    });
    assert.equal(ingestRes1.status, 200);
    const ingestData1 = await ingestRes1.json();
    console.log(`      ✔ Ingestion Verification: ${ingestData1.verificationStatus}`);
    console.log(`      ✔ Settlement Status: ${ingestData1.settlementStatus}`);
    assert.equal(ingestData1.verificationStatus, "REJECTED_HALLUCINATION");
    assert.equal(ingestData1.gates.gate3_semantic, "FAIL", "Expected Gate 3 math failure due to omitted tax in line items");

    // Step 4: Test POST /api/batches/ingest with a Valid Extraction Payload
    console.log("\n[4/4] Testing POST /api/batches/ingest with Valid Extracted Contract...");
    const validContractText = `
MASTER SERVICE AGREEMENT #MSA-992
Provider: Horizon Cloud Inc.
Effective Date: 2026-10-10
Services:
1. Server Hosting: $800.00 USD
2. Database Backup: $200.00 USD
Total obligation due upon receipt is $1,000.00 USD payable via PayPal.
`;
    const validExtraction = {
      vendorName: "Horizon Cloud Inc.",
      invoiceDate: "2026-10-10",
      currency: "USD",
      statedTotalCents: 100000,
      lineItems: [
        { description: "Server Hosting", amountCents: 80000 },
        { description: "Database Backup", amountCents: 20000 },
      ],
      evidenceQuote: "Total obligation due upon receipt is $1,000.00 USD payable via PayPal.",
    };

    const ingestRes2 = await fetch(`${baseUrl}/api/batches/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "langchain-finance-agent",
        contractText: validContractText,
        workerExtractionPayload: validExtraction,
        autoSettle: true,
      }),
    });
    assert.equal(ingestRes2.status, 200);
    const ingestData2 = await ingestRes2.json();
    console.log(`      ✔ Ingestion Verification: ${ingestData2.verificationStatus}`);
    console.log(`      ✔ Gate 1: ${ingestData2.gates.gate1_schema}`);
    console.log(`      ✔ Gate 2: ${ingestData2.gates.gate2_grounding}`);
    console.log(`      ✔ Gate 3: ${ingestData2.gates.gate3_semantic}`);
    console.log(`      ✔ Settlement Status: ${ingestData2.settlementStatus}`);
    assert.equal(ingestData2.verificationStatus, "VERIFIED");
    assert.equal(ingestData2.gates.gate1_schema, "PASS");
    assert.equal(ingestData2.gates.gate2_grounding, "PASS");
    assert.equal(ingestData2.gates.gate3_semantic, "PASS");
    assert.equal(ingestData2.settlementStatus, "PAYPAL_PREAUTH_CAPTURED");

    console.log("\n✅ ALL DIRECTORY INGESTION & WEBHOOK PIPELINE ASSERTIONS PASSED!\n");
  } finally {
    server.close();
    rmSync(testDbPath, { force: true });
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
