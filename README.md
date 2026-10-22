# 🛡️ Veract — Zero-Trust AI Settlement & Autonomous Cryptographic Ledger

> **Deterministic Verification, Merkle Inclusion Proofs, and Autonomous Self-Healing for AI Agent Financial Workflows.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](#)
[![Vitest](https://img.shields.io/badge/Tests-38%2F38_Passing-22c55e?logo=vitest&logoColor=white)](#)
[![Cryptographic Standard](https://img.shields.io/badge/RFC_8785-Canonical_JSON-0ea5e9)](#)
[![PWA Ready](https://img.shields.io/badge/PWA-Installable_App-8b5cf6)](#)

---

## 🚨 The Problem

Autonomous AI agents and automated financial pipelines process thousands of invoices, settlements, and B2B transactions per minute. However, enterprise systems suffer from two catastrophic blind spots:
1. **AI Hallucinations & Schema Drift:** Agents extract miscalculated cent totals, hallucinate contract clauses, or suffer from Unicode homograph injection.
2. **Silent Insider Tampering:** Traditional SQL/NoSQL audit logs can be silently mutated by compromised credentials, rogue administrators, or post-settlement database attacks without breaking downstream checksums.

---

## ⚡ The Solution: Veract

**Veract** is a Zero-Trust Verification & Cryptographic Attestation Engine that sits between autonomous AI workflows and payment settlement rails (e.g., PayPal `custom_id` anchoring). Every ingested payload passes through a deterministic 3-Gate Verification Matrix before being bound to a **constant-time HMAC receipt** and anchored into a **balanced SHA-256 Merkle Tree** protected by an **Autonomous Self-Healing Sentinel**.

---

## 🏗️ System Architecture

```text
+-------------------------------------------------------------------------+
|                        1. INGESTION & 3-GATE MATRIX                     |
|  [Gate 1: Zod Schema] -> [Gate 2: NFKC Span Check] -> [Gate 3: Cent Σ]  |
+------------------------------------+------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                   2. CRYPTOGRAPHIC ATTESTATION (PHASE 5)                |
|  • RFC 8785 Canonical JSON Key Sorting                                  |
|  • SHA-256 Payload Digest + Constant-Time HMAC-SHA256 Receipt (rcpt_*)  |
+------------------------------------+------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                    3. MERKLE TREE ANCHORING (PHASE 6)                   |
|  • Pairwise SHA-256 Tree Balancing -> Epoch Merkle Root                 |
|  • O(log N) Cryptographic Inclusion Proofs (.veract.json Certificates)  |
+------------------------------------+------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|               4. AUTONOMOUS SELF-HEALING SENTINEL (PHASE 7)             |
|  • Real-time Tamper Detection (Expected vs. Computed Digest)            |
|  • Sub-5ms Snapshot Recovery & Immutable Incident Trail                 |
+-------------------------------------------------------------------------+
```

---

## 🔥 Core Capabilities

* **3-Gate Deterministic Verification:** Validates structural schemas (Gate 1), enforces exact Unicode NFKC character span grounding against source contracts to block AI hallucinations (Gate 2), and verifies exact integer cent arithmetic (Gate 3).
* **RFC 8785 Canonical Attestation:** Eliminates JSON key-ordering nondeterminism prior to SHA-256 hashing and binds payloads to constant-time `crypto.timingSafeEqual` HMAC signatures.
* **$O(\log N)$ Merkle Inclusion Proofs:** Generates portable `.veract.json` compliance certificates allowing third-party auditors to verify a single transaction offline without exposing the rest of the ledger.
* **Autonomous Watchtower Sentinel:** Continuously scans in-memory and persisted state against signed Merkle roots, automatically isolating and healing mutated payloads in under 5 milliseconds.
* **Installable Native PWA Experience:** Ships with a dedicated mobile application shell with bottom tab navigation for on-the-go SOC auditing, live tamper simulation, and one-tap proof exports.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Test Suite & Verification Pipelines

```bash
# Run all 38 unit tests across 5 cryptographic & state test suites
npm test

# Verify deterministic ingestion & state machine APIs
npm run verify:ingest
npm run verify:api
```

### 3. Launch Development Workbench

```bash
npm run dev
```

---

## 🔌 REST API Reference

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/verifier/audit` | Executes full ledger cryptographic audit (`HEALTHY` vs `COMPROMISED`) |
| `GET` | `/api/verifier/receipt/:receiptId` | Direct attestation lookup by `rcpt_<prefix>` |
| `POST` | `/api/verifier/simulate-tamper/:batchId` | Non-destructively mutates batch state for live attack demos |
| `POST` | `/api/verifier/restore` | Reverts all simulated mutations from cryptographic snapshots |
| `GET` | `/api/verifier/merkle-anchor` | Exports current epoch `merkleRoot` and leaf metadata |
| `GET` | `/api/verifier/batches/:batchId/certificate` | Exports signed `.veract.json` certificate with $O(\log N)$ Merkle proof |
| `POST` | `/api/verifier/sentinel/scan` | Triggers Autonomous Sentinel scan & instant self-healing |
| `GET` | `/api/verifier/sentinel/status` | Returns Sentinel configuration and immutable incident history |

---

## 🛡️ Offline Proof Verification (Air-Gapped CLI)

Auditors can verify any downloaded `.veract.json` certificate without network or database access:

```bash
node verify-proof.js cert_9314ee9bbea7.veract.json
# Output: ✅ CRYPTOGRAPHICALLY VALID (AUTHENTIC)
```

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
