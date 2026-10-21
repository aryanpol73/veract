import { describe, it, expect } from "vitest";
import {
  hashPair,
  buildMerkleRoot,
  generateAnchorSnapshot,
  generateMerkleProof,
  verifyMerkleProof,
} from "../merkleAnchor.js";
import { BatchStore } from "../../store/batchStore.js";

describe("Phase 6: Merkle Tree Engine & Inclusion Proofs", () => {
  it("computes deterministic hashPair for left and right leaves", () => {
    const left = "a".repeat(64);
    const right = "b".repeat(64);
    const pair = hashPair(left, right);

    expect(pair).toMatch(/^[a-f0-9]{64}$/);
    expect(pair).toBe(hashPair(left, right));
  });

  it("builds consistent Merkle root for even and odd leaf counts", () => {
    const leaf1 = "11".repeat(32);
    const leaf2 = "22".repeat(32);
    const leaf3 = "33".repeat(32);

    const rootEven = buildMerkleRoot([leaf1, leaf2]);
    expect(rootEven).toBe(hashPair(leaf1, leaf2));

    const rootOdd = buildMerkleRoot([leaf1, leaf2, leaf3]);
    // Odd leaf pairs with itself at the end of the layer
    const layer1Right = hashPair(leaf3, leaf3);
    const expectedOdd = hashPair(rootEven, layer1Right);
    expect(rootOdd).toBe(expectedOdd);
  });

  it("handles empty leaves gracefully", () => {
    const emptyRoot = buildMerkleRoot([]);
    expect(emptyRoot).toMatch(/^[a-f0-9]{64}$/);
  });

  it("generates and verifies valid Merkle inclusion proofs", () => {
    const leaves = [
      "aa".repeat(32),
      "bb".repeat(32),
      "cc".repeat(32),
      "dd".repeat(32),
      "ee".repeat(32),
    ];
    const root = buildMerkleRoot(leaves);

    // Verify proof for each leaf in the tree
    for (let i = 0; i < leaves.length; i++) {
      const proofObj = generateMerkleProof(leaves, i);
      expect(proofObj).not.toBeNull();
      expect(proofObj!.root).toBe(root);
      expect(proofObj!.leaf).toBe(leaves[i]);

      const isValid = verifyMerkleProof(proofObj!.root, proofObj!.leaf, proofObj!.proof);
      expect(isValid).toBe(true);
    }
  });

  it("rejects forged leaves or corrupted proofs", () => {
    const leaves = ["11".repeat(32), "22".repeat(32), "33".repeat(32), "44".repeat(32)];
    const proofObj = generateMerkleProof(leaves, 1)!;
    const forgedLeaf = "99".repeat(32);

    const isValid = verifyMerkleProof(proofObj.root, forgedLeaf, proofObj.proof);
    expect(isValid).toBe(false);
  });

  it("generates an external anchor snapshot from batchStore", () => {
    const testStore = new BatchStore();
    testStore.addBatch("batch_anchor_1", { amount: 5000 });
    testStore.addBatch("batch_anchor_2", { amount: 12000 });

    const snapshot = generateAnchorSnapshot(testStore);
    expect(snapshot.leafCount).toBe(2);
    expect(snapshot.merkleRoot).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.receiptIds).toHaveLength(2);
  });
});
