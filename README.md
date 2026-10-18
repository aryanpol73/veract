# Veract

**Pre-Authorized Outcome-Metered Settlement Gateway for AI Agent Workflows on PayPal**

Veract (*Verified Action / Verified Transaction*) bridges buyers and autonomous AI worker agents using a **two-phase pre-authorization and proportional partial capture** protocol.

---

## The Problem

- **Upfront Token/Subscription Risk:** When AI agents process batches of contracts, invoices, or research documents, buyers pay 100% upfront even if the model hallucinates or outputs invalid data.
- **Micropayment Friction:** Attempting per-document transactions creates unbearable checkout friction and excessive fixed processing fees.

## The Solution: Two-Phase Financial State Machine

1. **Pre-Authorization Hold (PayPal Orders v2):** Veract locks a batch budget ceiling (e.g. $10.00 across 5 tasks) using `intent: "AUTHORIZE"`. No money moves until verification completes.
2. **Deterministic 3-Gate Verification:** AI outputs are evaluated via a pure TypeScript verifier (0 LLM overhead):
   - **Gate 1:** Strict Zod Schema & ISO-8601 Date format.
   - **Gate 2:** Canonical NFKC Span-Offset Grounding (`[startOffset, endOffset]` anchor check).
   - **Gate 3:** Minor-Unit Integer Cent Conservation ($\sum \text{lineItems} \equiv \text{statedTotalCents}$).
3. **Audit Binding & Proportional Partial Capture (Payments v2):** Serializes the verification digest into RFC 8785 Canonical JSON, generates an audit SHA-256 hash, and captures payment strictly for verified tasks (e.g. $6.00 for 3 verified tasks), automatically releasing unearned holds ($4.00) back to the buyer with `final_capture: true`.

---

## Project Structure

```text
veract/
├── scripts/
│   └── verify-paypal-sandbox.ts   # Standalone CLI Day-1 verification test
├── src/
│   ├── shared/
│   │   └── money.ts               # Integer minor-unit (cents) math & conservation
│   └── server/
│       └── paypal/
│           ├── idempotency.ts     # Deterministic PayPal-Request-Id derivation
│           └── paypalClient.ts    # PayPal Orders v2 & Payments v2 client
├── .env.example                   # Environment configuration template
├── package.json
└── tsconfig.json
```

---

## Quick Start

### 1. Prerequisites
- Node.js 20+
- A PayPal Developer Sandbox Account

### 2. Setup
```bash
git clone https://github.com/aryanpol73/veract.git
cd veract
npm install
cp .env.example .env
```

Configure your credentials in `.env`:
```env
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_client_secret
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
```

### 3. Verify Sandbox Pre-Authorization & Partial Capture
```bash
npm run verify:sandbox
```

---

## License

MIT License — see [LICENSE](LICENSE) for details.
