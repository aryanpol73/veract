// src/server/worker/llmWorker.ts
// Dual-mode AI Worker:
//  1) "seeded": Instant deterministic execution (0 tokens, guaranteed 3/5 pass + 2 seeded faults).
//  2) "live_gemini": Calls Gemini 2.5 Flash REST API for extraction with automatic fallback so demo never crashes.
import type { CandidateExtraction, VendorContractFixture } from "../../shared/types.js";
import type { ExecutionMode } from "../db/batchStore.js";

export interface WorkerTaskOutput {
  readonly taskId: string;
  readonly candidate: CandidateExtraction;
  readonly source: "seeded_fixture" | "gemini_2_5_flash" | "fallback_seeded";
  readonly latencyMs: number;
}

const GEMINI_MODEL = "gemini-2.5-flash";

async function callGeminiExtraction(
  fixture: VendorContractFixture,
  apiKey: string,
): Promise<CandidateExtraction> {
  const prompt = [
    "You are an invoice data extraction worker. Extract the contract data into strict JSON matching this exact TypeScript interface:",
    "{ vendorName: string, invoiceDate: string (YYYY-MM-DD), currency: 'USD', lineItems: Array<{ description: string, amountCents: number }>, statedTotalCents: number, evidenceQuote: string }",
    "Rules:",
    "1. Convert all dollar amounts to integer cents (e.g. $500.00 -> 50000).",
    "2. evidenceQuote MUST be an exact, verbatim sentence copied character-for-character from the text that states the total dollar amount.",
    "3. Output ONLY valid JSON with no markdown fences.",
    "",
    "SOURCE DOCUMENT:",
    fixture.sourceDocument,
  ].join("\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Gemini API HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return JSON.parse(rawText.trim()) as CandidateExtraction;
}

/**
 * Executes the 5 extraction tasks.
 * Note: Tasks 103 and 105 preserve their seeded adversarial faults by default so that
 * live demos reliably showcase Gate 2 (hallucinated quote) and Gate 3 (math mismatch) slashing!
 */
export async function runExtractionWorkerBatch(
  fixtures: readonly VendorContractFixture[],
  mode: ExecutionMode = "seeded",
  options: { preserveAdversarialFaults?: boolean } = { preserveAdversarialFaults: true },
): Promise<WorkerTaskOutput[]> {
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const preserveFaults = options.preserveAdversarialFaults ?? true;

  return Promise.all(
    fixtures.map(async (fixture): Promise<WorkerTaskOutput> => {
      const start = Date.now();
      const isSeededFaultTask = fixture.taskId === "TASK-103" || fixture.taskId === "TASK-105";

      if (mode === "seeded" || (preserveFaults && isSeededFaultTask) || !geminiKey) {
        return {
          taskId: fixture.taskId,
          candidate: fixture.seededOutput,
          source: "seeded_fixture",
          latencyMs: Date.now() - start,
        };
      }

      try {
        const extracted = await callGeminiExtraction(fixture, geminiKey);
        return {
          taskId: fixture.taskId,
          candidate: extracted,
          source: "gemini_2_5_flash",
          latencyMs: Date.now() - start,
        };
      } catch {
        // Graceful fallback if free-tier rate limit is hit mid-demo
        return {
          taskId: fixture.taskId,
          candidate: fixture.seededOutput,
          source: "fallback_seeded",
          latencyMs: Date.now() - start,
        };
      }
    }),
  );
}
