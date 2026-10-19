// src/server/worker/fixtures.ts
// 5 deterministic B2B contract extraction fixtures ($2.00 / 200¢ per verified task; $10.00 / 1000¢ batch ceiling).
// Tasks 101, 102, 104 PASS all 3 gates. Task 103 FAILS Gate 2 (hallucinated quote). Task 105 FAILS Gate 3 (math mismatch).
import type { VendorContractFixture } from "../../shared/types.js";

export const DEFAULT_CENTS_PER_TASK = 200; // $2.00
export const DEFAULT_BATCH_AUTHORIZED_CENTS = 1000; // $10.00 (5 tasks * $2.00)

export const VERACT_DEMO_FIXTURES: readonly VendorContractFixture[] = [
  {
    taskId: "TASK-101",
    title: "Apex Cloud Hosting — Q4 Infrastructure Addendum",
    unitPriceCents: DEFAULT_CENTS_PER_TASK,
    sourceDocument: [
      "MASTER SERVICE ADDENDUM #AC-2026-101",
      "Provider: Apex Cloud Hosting LLC | Effective Date: 2026-10-05",
      "Scope of Services:",
      "1. Dedicated Kubernetes Control Plane Cluster (Oct 2026): $320.00 USD.",
      "2. Managed PostgreSQL High-Availability Replica & Snapshots: $180.00 USD.",
      "Billing Terms: Pursuant to Section 4.1, Client agrees that the combined monthly",
      "settlement due upon invoice issuance is $500.00 USD payable via net-15 electronic capture.",
    ].join("\n"),
    seededOutput: {
      vendorName: "Apex Cloud Hosting LLC",
      invoiceDate: "2026-10-05",
      currency: "USD",
      lineItems: [
        { description: "Dedicated Kubernetes Control Plane Cluster (Oct 2026)", amountCents: 32000 },
        { description: "Managed PostgreSQL High-Availability Replica & Snapshots", amountCents: 18000 },
      ],
      statedTotalCents: 50000,
      evidenceQuote:
        "Pursuant to Section 4.1, Client agrees that the combined monthly settlement due upon invoice issuance is $500.00 USD payable via net-15 electronic capture.",
    },
  },
  {
    taskId: "TASK-102",
    title: "Meridian Freight Logistics — Cold-Chain Dispatch",
    unitPriceCents: DEFAULT_CENTS_PER_TASK,
    sourceDocument: [
      "FREIGHT DISPATCH SETTLEMENT VOUCHER #MF-8841",
      "Carrier: Meridian Freight Logistics Inc. | Dispatch Date: 2026-10-09",
      "Line Charges:",
      "- Refrigerated Linehaul (Pune Hub to Nhava Sheva Port): $1,450.00 USD",
      "- Customs Seal, Port Handling & Telemetry Logger Fee: $350.00 USD",
      "Binding Obligation: Shipper acknowledges receipt of cold-chain manifest and authorizes",
      "total freight settlement of $1,800.00 USD without deduction or set-off.",
    ].join("\n"),
    seededOutput: {
      vendorName: "Meridian Freight Logistics Inc.",
      invoiceDate: "2026-10-09",
      currency: "USD",
      lineItems: [
        { description: "Refrigerated Linehaul (Pune Hub to Nhava Sheva Port)", amountCents: 145000 },
        { description: "Customs Seal, Port Handling & Telemetry Logger Fee", amountCents: 35000 },
      ],
      statedTotalCents: 180000,
      evidenceQuote:
        "Shipper acknowledges receipt of cold-chain manifest and authorizes total freight settlement of $1,800.00 USD without deduction or set-off.",
    },
  },
  {
    taskId: "TASK-103",
    title: "Lumina Cyber Security — Penetration Test SOW [SEEDED GATE 2 FAIL]",
    unitPriceCents: DEFAULT_CENTS_PER_TASK,
    sourceDocument: [
      "STATEMENT OF WORK #LCS-2026-09",
      "Auditor: Lumina Cyber Security Audit Ltd. | Date: 2026-10-11",
      "Deliverables:",
      "1. External API & OAuth2 Token Penetration Assessment: $600.00 USD",
      "2. Automated Dependency & Container Image Hardening Review: $300.00 USD",
      "Payment Clause: The fixed professional fee for this engagement is $900.00 USD,",
      "invoiced in full upon delivery of the signed executive findings report.",
    ].join("\n"),
    seededOutput: {
      vendorName: "Lumina Cyber Security Audit Ltd.",
      invoiceDate: "2026-10-11",
      currency: "USD",
      lineItems: [
        { description: "External API & OAuth2 Token Penetration Assessment", amountCents: 60000 },
        { description: "Automated Dependency & Container Image Hardening Review", amountCents: 30000 },
      ],
      statedTotalCents: 90000,
      // SEEDED HALLUCINATION: The LLM fabricated an early-settlement discount clause not in sourceDocument.
      evidenceQuote:
        "The fixed professional fee for this engagement is $900.00 USD, subject to a 10% early settlement rebate if settled within 5 business days.",
    },
  },
  {
    taskId: "TASK-104",
    title: "Cobalt Data Systems — Vector Index Migration",
    unitPriceCents: DEFAULT_CENTS_PER_TASK,
    sourceDocument: [
      "WORK ORDER #CDS-4410",
      "Contractor: Cobalt Data Systems Corp | Invoice Date: 2026-10-14",
      "Itemized Breakdown:",
      "* HNSW Embedding Index Re-Sharding & Quantization: $600.00 USD",
      "* Zero-Downtime Snapshot Verification & Cutover: $150.00 USD",
      "Total Authorization: Client confirms acceptance of migration benchmarks and approves",
      "final work-order payment of $750.00 USD.",
    ].join("\n"),
    seededOutput: {
      vendorName: "Cobalt Data Systems Corp",
      invoiceDate: "2026-10-14",
      currency: "USD",
      lineItems: [
        { description: "HNSW Embedding Index Re-Sharding & Quantization", amountCents: 60000 },
        { description: "Zero-Downtime Snapshot Verification & Cutover", amountCents: 15000 },
      ],
      statedTotalCents: 75000,
      evidenceQuote:
        "Client confirms acceptance of migration benchmarks and approves final work-order payment of $750.00 USD.",
    },
  },
  {
    taskId: "TASK-105",
    title: "Vanguard Legal Partners — Cross-Border IP Filing [SEEDED GATE 3 FAIL]",
    unitPriceCents: DEFAULT_CENTS_PER_TASK,
    sourceDocument: [
      "ENGAGEMENT LETTER & FEE SCHEDULE #VLP-902",
      "Counsel: Vanguard Legal Partners LLP | Date: 2026-10-16",
      "Scheduled Matters:",
      "1. Delaware & India Cross-Border SaaS Licensing Opinion: $800.00 USD",
      "2. Trademark & Open-Source Compliance Audit: $450.00 USD",
      "Less Courtesy Prior-Retainer Credit Applied: -$300.00 USD",
      "Summary: The net retainer payable upon execution is $950.00 USD.",
    ].join("\n"),
    seededOutput: {
      vendorName: "Vanguard Legal Partners LLP",
      invoiceDate: "2026-10-16",
      currency: "USD",
      // SEEDED ARITHMETIC FAULT: Worker omitted the -$300 credit item, so lineItems sum to 125000¢ ($1,250.00) != statedTotalCents 95000¢ ($950.00).
      lineItems: [
        { description: "Delaware & India Cross-Border SaaS Licensing Opinion", amountCents: 80000 },
        { description: "Trademark & Open-Source Compliance Audit", amountCents: 45000 },
      ],
      statedTotalCents: 95000,
      evidenceQuote: "Summary: The net retainer payable upon execution is $950.00 USD.",
    },
  },
];
