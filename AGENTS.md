# VERACT — Master Architecture, System Design & Implementation Context

## 1. Project Identity & Core Objective
- **Name:** Veract (Verified Action / Verified Transaction)
- **One-Line Summary:** A two-phase outcome-metered settlement gateway that locks a batch budget via PayPal Orders v2 (`intent: "AUTHORIZE"`), evaluates AI worker outputs through a 3-gate deterministic verifier, binds the SHA-256 verification digest to the transaction metadata, and executes a proportional partial capture (`final_capture: true`) for verified tasks only.
- **Terminology Rule:** NEVER describe PayPal `AUTHORIZE` as "escrow" in UI copy or docs. Always call it **"Two-Phase Pre-Authorization & Proportional Partial Capture"** (3-day honor period, 29-day maximum validity).

## 2. System Architecture & Data Flow

```text
[Buyer / Client UI (React 19 + PayPal JS SDK + AG Grid Community)]
│
├─ 1. POST /api/batches/create-order ────────► [PayPal Orders v2 API]
│     (Creates $10.00 / 1000¢ AUTHORIZE order)   POST /v2/checkout/orders
│
├─ 2. Buyer Approves in PayPal Sandbox Popup
│
├─ 3. POST /api/batches/:batchId/authorize ──► [PayPal Orders v2 API]
│     (Locks $10.00 hold -> status: CREATED)     POST /v2/checkout/orders/{id}/authorize
│
└─ 4. POST /api/batches/:batchId/execute-and-settle
│
├──► [SQLite CAS Lock: AUTHORIZED -> VERIFYING]
│
├──► [AI Worker Engine (Seeded Demo Mode OR Live Gemini 2.5 Flash / OpenRouter)]
│     Processes 5 unstructured vendor contracts -> emits raw candidate JSONs
│
├──► [Veract 3-Gate Deterministic Verifier (Pure TypeScript, 0 LLM Calls)]
│     ├─ Gate 1: Zod Schema & ISO Date Check
│     ├─ Gate 2: NFKC Span-Offset Grounding Check ([startOffset, endOffset] + Dollar Anchor)
│     └─ Gate 3: Minor-Unit Integer Cent Conservation (sum(lineItems) === statedTotalCents)
│
├──► [RFC 8785 Canonical JSON Serializer & SHA-256 Hasher]
│     Computes `audit_sha256` + `captured_cents = passed_count * 200`
│
└──► [PayPal Payments v2 API + @paypal/agent-toolkit]
├─ Branch A (passed_count > 0):
│   POST /v2/payments/authorizations/{auth_id}/capture
│   (amount: "6.00", final_capture: true, custom_id: "VERACT::")
│   + @paypal/agent-toolkit `create_invoice` for itemized audit receipt
└─ Branch B (passed_count === 0):
POST /v2/payments/authorizations/{auth_id}/void
```

## 3. Complete Repository Directory & File Structure

Maintain this exact directory layout. Frontend Agents only touch `src/client/`; Backend Agents only touch `src/server/`, `src/shared/`, and `scripts/`.

```text
veract/
├── GEMINI.md                          # Always-on master context for Antigravity IDE
├── AGENTS.md                          # Symlink/copy of GEMINI.md for cross-agent compatibility
├── LICENSE                            # MIT License (Mandatory in root for GitHub About badge)
├── README.md                          # Architecture, setup, and 1-click testing guide
├── package.json                       # Unified scripts: dev, build, test, verify:paypal
├── tsconfig.json                      # Strict TypeScript configuration
├── vite.config.ts                     # Vite config proxying /api to localhost:4000
├── .env.example                       # Template environment variables (NEVER commit .env)
├── .agents/
│   └── workflows/
│       └── verify-slice.md            # Antigravity workflow for running vitest + sandbox check
├── scripts/
│   └── verify-paypal-sandbox.ts       # Phase 1 standalone CLI script for Day-1 Kill Gate
├── src/
│   ├── shared/
│   │   ├── types.ts                   # Shared TypeScript interfaces (Batch, TaskResult, GateReport)
│   │   ├── money.ts                   # Integer minor-unit (cents) conversion & conservation helpers
│   │   └── canonicalHash.ts           # RFC 8785 Canonical JSON serializer & SHA-256 generator
│   ├── server/
│   │   ├── index.ts                   # Express 5 entry point & route registration
│   │   ├── db/
│   │   │   ├── sqlite.ts              # better-sqlite3 connection & Compare-And-Swap (CAS) queries
│   │   │   └── schema.sql             # DDL for `batches` and `task_verifications` tables
│   │   ├── paypal/
│   │   │   ├── paypalClient.ts        # OAuth2 token cache, Orders v2, Authorizations v2 (Capture/Void)
│   │   │   ├── idempotency.ts         # Deterministic PayPal-Request-Id generator (HMAC-SHA256)
│   │   │   └── agentToolkitBridge.ts  # @paypal/agent-toolkit wrapper for itemized audit invoicing
│   │   ├── worker/
│   │   │   ├── fixtures.ts            # 5 realistic vendor contracts + seeded deterministic outputs
│   │   │   └── llmWorker.ts           # Live Gemini 2.5 Flash worker + OpenRouter fallback
│   │   └── verifier/
│   │       ├── veractVerifier.ts      # The 3-Gate Deterministic Verifier (Zod + Span + Cent Math)
│   │       └── veractVerifier.test.ts # Vitest unit & property tests for all 3 gates
│   └── client/
│       ├── main.tsx                   # React 19 entry point
│       ├── App.tsx                    # Single-screen Veract Workbench layout
│       ├── components/
│       │   ├── KpiSummaryBar.tsx      # 4 top cards: Authorized ($10), Verified (3/5), Captured ($6), Released ($4)
│       │   ├── PayPalAuthControl.tsx  # @paypal/react-paypal-js button (intent="authorize") + Mode Toggle
│       │   ├── VerificationGrid.tsx   # AG Grid Community table with custom Gate Badge renderers
│       │   └── ForensicDrawer.tsx     # Side panel showing highlighted source span, math diff & CLI SHA-256 check
│       └── styles/
│           └── index.css              # Tailwind CSS directives
```

## 4. Core Engineering Invariants & Guardrails (Mandatory)

1. **Integer Minor-Unit Arithmetic (`src/shared/money.ts`):**
* NEVER use floating-point numbers (`10.00`) for math. Store and calculate all currency values in integer cents (`1000`).
* Convert cents to USD string ONLY when building PayPal JSON bodies:
  `export const centsToUsdString = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;`
* Enforce conservation invariant before calling PayPal Capture:
  `if (capturedCents + releasedCents !== authorizedCents) throw new Error("CONSERVATION_VIOLATION");`

2. **Deterministic Idempotency (`src/server/paypal/idempotency.ts`):**
* Every `POST` request to PayPal MUST include `PayPal-Request-Id`.
* Derive it deterministically: `crypto.createHash("sha256").update(`${batchId}:${step}:${auditSha256}`).digest("hex").slice(0, 36)`.

3. **PayPal Wire Field Length Limits (`Orders v2` & `Payments v2`):**
* `purchase_units[].custom_id` / `capture.custom_id`: Max **127 chars** (Payments v2 limit is stricter than Orders v2's 255). Format strictly as:
  `VERACT:${batchId.slice(0, 12)}:${auditSha256}` (Total length: `7 + 12 + 1 + 64 = 84` chars).
* `invoice_id`: Max **127 chars**. Format as `VRCT-INV-${batchId.slice(0, 12)}`.
* `description`: Max **127 chars**.

4. **AG Grid Community Strictness (`src/client/components/VerificationGrid.tsx`):**
* Use ONLY `ag-grid-community` and `ag-grid-react`.
* DO NOT import `ag-grid-enterprise` or use Enterprise-only props (`rowGroup`, `masterDetail`, `statusBar`, `sparkline`). Build custom cell renderers for Gate 1/2/3 badges and open `ForensicDrawer.tsx` via normal React `onRowClicked` state.

## 5. Exact PayPal Sandbox REST API Payloads

* **Base URL:** `https://api-m.sandbox.paypal.com`
* **Step 1 — OAuth2 Token:** `POST /v1/oauth2/token` (`grant_type=client_credentials` with Basic Auth `CLIENT_ID:CLIENT_SECRET`).
* **Step 2 — Create Order:** `POST /v2/checkout/orders`
```json
{
  "intent": "AUTHORIZE",
  "purchase_units": [{
    "reference_id": "VERACT_BATCH_01",
    "custom_id": "VERACT:BATCH_01:INIT",
    "description": "Veract Metered Batch: 5 AI Extraction Tasks (@ $2.00/verified task)",
    "amount": { "currency_code": "USD", "value": "10.00" }
  }]
}
```

* **Step 3 — Authorize Order (After Buyer Approval):** `POST /v2/checkout/orders/{order_id}/authorize` with body `{}`.
* Extract `authorization_id = data.purchase_units[0].payments.authorizations[0].id`.

* **Step 4A — Proportional Partial Capture (`passedCount > 0`):**
`POST /v2/payments/authorizations/{authorization_id}/capture`
```json
{
  "invoice_id": "VRCT-INV-BATCH01",
  "custom_id": "VERACT:BATCH01:<64_char_audit_sha256>",
  "final_capture": true,
  "amount": { "currency_code": "USD", "value": "6.00" },
  "note_to_payer": "Veract Settlement: 3/5 tasks passed verification ($6.00 captured, $4.00 hold released). Audit SHA256: <64_char_audit_sha256>"
}
```

* **Step 4B — Full Void (`passedCount === 0`):**
`POST /v2/payments/authorizations/{authorization_id}/void`

## 6. The 5 Seeded Demo Fixtures (`src/server/worker/fixtures.ts`)

Each task costs `200` cents (`$2.00`). Total Batch Authorization = `1000` cents (`$10.00`).

1. **Task 1 (`TASK-101` — Apex Cloud Hosting):** Valid schema, verbatim quote found at `[112, 198]`, line items `32000¢ + 18000¢ === 50000¢` (`$500.00`). -> **PASS (`+200¢`)**
2. **Task 2 (`TASK-102` — Meridian Freight Logistics):** Valid schema, verbatim quote found at `[84, 165]`, line items `145000¢ + 35000¢ === 180000¢` (`$1,800.00`). -> **PASS (`+200¢`)**
3. **Task 3 (`TASK-103` — Lumina Security Audit — SEEDED GATE 2 FAILURE):** Worker hallucinates an `evidenceQuote` (`"Total payable is $900.00 with a 10% early settlement discount"`) that does NOT exist in the raw contract text. Gate 2 returns `SUBSTRING_NOT_FOUND`. -> **FAIL (`0¢` — Buyer saves $2.00)**
4. **Task 4 (`TASK-104` — Cobalt Data Systems):** Valid schema, verbatim quote found at `[140, 225]`, line items `60000¢ + 15000¢ === 75000¢` (`$750.00`). -> **PASS (`+200¢`)**
5. **Task 5 (`TASK-105` — Vanguard Legal Partners — SEEDED GATE 3 FAILURE):** Source text has a discount line or OCR ambiguity; Worker extracts line items `80000¢ + 45000¢ = 125000¢` (`$1,250.00`) but states `statedTotalCents: 95000` (`$950.00`). Gate 3 detects `deltaCents: 30000`. -> **FAIL (`0¢` — Buyer saves $2.00)**

* **Batch Settlement Result:** `3/5 Passed` -> `captured_cents = 600` (`$6.00`), `released_cents = 400` (`$4.00`).
