// src/server/verifier/merkleAnchor.ts
// Phase 6: Merkle Tree Engine, Inclusion Proofs & External Checkpoint Anchor Export.

import crypto from "node:crypto";
import { batchStore } from "../store/batchStore.js";

export interface MerkleProofStep {
  position: "left" | "right";
  hash: string;
}

export interface MerkleInclusionProof {
  leaf: string;
  leafIndex: number;
  root: string;
  proof: MerkleProofStep[];
}

export interface MerkleAnchorSnapshot {
  epochTimestamp: string;
  leafCount: number;
  merkleRoot: string;
  receiptIds: string[];
}

export function hashPair(left: string, right: string): string {
  return crypto.createHash("sha256").update(left + right).digest("hex");
}

export function buildMerkleRoot(hashes: string[]): string {
  if (hashes.length === 0) {
    return crypto.createHash("sha256").update("").digest("hex");
  }

  let layer = [...hashes];
  while (layer.length > 1) {
    const nextLayer: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const right = i + 1 < layer.length ? layer[i + 1]! : left;
      nextLayer.push(hashPair(left, right));
    }
    layer = nextLayer;
  }
  return layer[0]!;
}

export function generateAnchorSnapshot(store = batchStore): MerkleAnchorSnapshot {
  const batches = store.getAllBatches();
  const leaves = batches.map((b) => b.receipt.expectedHash);
  return {
    epochTimestamp: new Date().toISOString(),
    leafCount: leaves.length,
    merkleRoot: buildMerkleRoot(leaves),
    receiptIds: batches.map((b) => b.receipt.receiptId),
  };
}

export function generateMerkleProof(
  hashes: string[],
  targetIndex: number,
): MerkleInclusionProof | null {
  if (hashes.length === 0 || targetIndex < 0 || targetIndex >= hashes.length) {
    return null;
  }

  const leaf = hashes[targetIndex]!;
  const proof: MerkleProofStep[] = [];
  let currentIndex = targetIndex;
  let layer = [...hashes];

  while (layer.length > 1) {
    const isEven = currentIndex % 2 === 0;
    const siblingIndex = isEven ? currentIndex + 1 : currentIndex - 1;

    if (siblingIndex < layer.length) {
      proof.push({
        position: isEven ? "right" : "left",
        hash: layer[siblingIndex]!,
      });
    } else {
      proof.push({
        position: "right",
        hash: layer[currentIndex]!,
      });
    }

    const nextLayer: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const right = i + 1 < layer.length ? layer[i + 1]! : left;
      nextLayer.push(hashPair(left, right));
    }
    layer = nextLayer;
    currentIndex = Math.floor(currentIndex / 2);
  }

  return {
    leaf,
    leafIndex: targetIndex,
    root: layer[0]!,
    proof,
  };
}

export function verifyMerkleProof(
  arg1: string,
  arg2: string | MerkleInclusionProof | MerkleProofStep[],
  arg3?: string | MerkleProofStep[],
): boolean {
  let root = "";
  let leaf = "";
  let steps: MerkleProofStep[] = [];

  if (typeof arg2 === "object" && "proof" in arg2 && typeof arg3 === "string") {
    // verifyMerkleProof(leaf, proofObj, root)
    leaf = arg1;
    root = arg3;
    steps = arg2.proof;
  } else if (typeof arg2 === "string" && Array.isArray(arg3)) {
    // verifyMerkleProof(root, leaf, proofSteps)
    root = arg1;
    leaf = arg2;
    steps = arg3;
  } else if (typeof arg1 === "string" && typeof arg2 === "object" && Array.isArray(arg2) && typeof arg3 === "string") {
    // verifyMerkleProof(leaf, proofSteps, root)
    leaf = arg1;
    steps = arg2;
    root = arg3;
  } else if (typeof arg1 === "string" && typeof arg2 === "object" && "proof" in arg2) {
    leaf = arg2.leaf;
    root = arg1;
    steps = arg2.proof;
  }

  if (!root || !leaf || !Array.isArray(steps)) {
    return false;
  }

  let currentHash = leaf;
  for (const step of steps) {
    if (step.position === "right") {
      currentHash = hashPair(currentHash, step.hash);
    } else {
      currentHash = hashPair(step.hash, currentHash);
    }
  }
  return currentHash === root;
}
