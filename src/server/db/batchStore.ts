// src/server/db/batchStore.ts
// Atomic JSON-backed state machine with Compare-And-Swap (CAS) locking.
// Zero native C++ dependencies (works cleanly on Windows, Linux, and Render).
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { BatchVerificationSummary } from "../../shared/types.js";

export type BatchState =
  | "CREATED"
  | "AUTHORIZED"
  | "VERIFYING"
  | "CAPTURED"
  | "VOIDED"
  | "FAILED";

export type ExecutionMode = "seeded" | "live_gemini";

export interface BatchRecord {
  batchId: string; // 12-char ID matching /^[A-Za-z0-9_-]{12}$/
  state: BatchState;
  orderId: string;
  approvalUrl: string;
  authorizationId?: string;
  authorizationStatus?: string;
  expirationTime?: string;
  authorizedCents: number;
  capturedCents?: number;
  releasedCents?: number;
  captureId?: string;
  captureStatus?: string;
  paypalCustomId?: string;
  paypalRequestId?: string;
  executionMode?: ExecutionMode;
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
  createdAt: string;
  updatedAt: string;
  settledAt?: string;
}

export class StateTransitionError extends Error {
  override readonly name = "StateTransitionError";
  constructor(
    message: string,
    readonly currentState: BatchState,
    readonly expectedState: BatchState,
  ) {
    super(message);
  }
}

export class BatchStore {
  private readonly filePath: string;
  private records = new Map<string, BatchRecord>();

  constructor(filePath = resolve(process.cwd(), "data", "batches.json")) {
    this.filePath = filePath;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.filePath)) {
        mkdirSync(dirname(this.filePath), { recursive: true });
        this.flushToDisk();
        return;
      }
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as BatchRecord[];
      if (Array.isArray(parsed)) {
        for (const rec of parsed) {
          this.records.set(rec.batchId, rec);
        }
      }
    } catch {
      this.records = new Map();
    }
  }

  private flushToDisk(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    const serialized = JSON.stringify(Array.from(this.records.values()), null, 2);
    writeFileSync(tmpPath, serialized, "utf8");
    renameSync(tmpPath, this.filePath);
  }

  create(record: BatchRecord): BatchRecord {
    if (this.records.has(record.batchId)) {
      throw new Error(`Batch ${record.batchId} already exists`);
    }
    this.records.set(record.batchId, record);
    this.flushToDisk();
    return record;
  }

  get(batchId: string): BatchRecord | undefined {
    return this.records.get(batchId);
  }

  listAll(): BatchRecord[] {
    return Array.from(this.records.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  /**
   * Atomic Compare-And-Swap (CAS) state transition.
   * Prevents concurrent requests from double-executing or double-capturing the same batch.
   */
  transitionState(
    batchId: string,
    expectedCurrent: BatchState,
    nextState: BatchState,
    patch: Partial<BatchRecord> = {},
  ): BatchRecord {
    const existing = this.records.get(batchId);
    if (!existing) {
      throw new Error(`Batch not found: ${batchId}`);
    }
    if (existing.state !== expectedCurrent) {
      throw new StateTransitionError(
        `CAS conflict on batch ${batchId}: expected state ${expectedCurrent}, found ${existing.state}`,
        existing.state,
        expectedCurrent,
      );
    }
    const updated: BatchRecord = {
      ...existing,
      ...patch,
      batchId: existing.batchId,
      state: nextState,
      updatedAt: new Date().toISOString(),
    };
    this.records.set(batchId, updated);
    this.flushToDisk();
    return updated;
  }
}
