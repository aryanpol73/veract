// src/server/verifier/fuzzyMatch.ts
// Character-level Levenshtein edit distance and sliding-window fuzzy grounding for OCR noise.

export interface FuzzyGroundingMatch {
  matched: boolean;
  matchType: "EXACT" | "FUZZY_OCR" | "NONE";
  matchedSpan: string | null;
  similarity: number;
  editDistance: number;
}

/**
 * Computes standard Levenshtein edit distance using two matrix rows (O(min(m,n)) space).
 */
export function levenshteinDistance(a: string, b: string): number {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();

  if (s1 === s2) return 0;
  if (s1.length === 0) return s2.length;
  if (s2.length === 0) return s1.length;

  let prevRow = Array.from({ length: s2.length + 1 }, (_, i) => i);
  const currRow = new Array<number>(s2.length + 1).fill(0);

  for (let i = 1; i <= s1.length; i++) {
    currRow[0] = i;
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        currRow[j - 1] + 1, // Insertion
        prevRow[j] + 1, // Deletion
        prevRow[j - 1] + cost, // Substitution
      );
    }
    prevRow = [...currRow];
  }

  return prevRow[s2.length]!;
}

/**
 * Grounds a target extracted value against raw OCR text.
 * Falls back to a sliding token window if exact substring matching fails.
 */
export function groundSpanWithFuzzyFallback(
  rawText: string,
  extractedValue: string,
  minSimilarityThreshold = 0.82,
): FuzzyGroundingMatch {
  const cleanRaw = rawText.replace(/\s+/g, " ").trim();
  const cleanTarget = extractedValue.replace(/\s+/g, " ").trim();

  if (!cleanTarget || !cleanRaw) {
    return { matched: false, matchType: "NONE", matchedSpan: null, similarity: 0, editDistance: -1 };
  }

  // 1. Fast Path: Case-insensitive exact substring check
  const exactIndex = cleanRaw.toLowerCase().indexOf(cleanTarget.toLowerCase());
  if (exactIndex !== -1) {
    return {
      matched: true,
      matchType: "EXACT",
      matchedSpan: cleanRaw.slice(exactIndex, exactIndex + cleanTarget.length),
      similarity: 1.0,
      editDistance: 0,
    };
  }

  // 2. Fallback Path: Sliding window over words for multi-word strings (e.g., Vendor Names, Line Items)
  const targetWords = cleanTarget.split(" ");
  const rawWords = cleanRaw.split(" ");
  const windowSize = targetWords.length;

  let bestSpan: string | null = null;
  let bestSimilarity = 0;
  let bestDistance = Infinity;

  // Check windows of length [windowSize - 1, windowSize, windowSize + 1]
  const candidateSizes = [Math.max(1, windowSize - 1), windowSize, windowSize + 1];

  for (const size of candidateSizes) {
    if (size > rawWords.length) continue;

    for (let i = 0; i <= rawWords.length - size; i++) {
      const candidateSpan = rawWords.slice(i, i + size).join(" ");
      const distance = levenshteinDistance(cleanTarget, candidateSpan);
      const maxLen = Math.max(cleanTarget.length, candidateSpan.length);
      const similarity = maxLen === 0 ? 1 : (maxLen - distance) / maxLen;

      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestDistance = distance;
        bestSpan = candidateSpan;
      }
    }
  }

  const passed = bestSimilarity >= minSimilarityThreshold;
  return {
    matched: passed,
    matchType: passed ? "FUZZY_OCR" : "NONE",
    matchedSpan: bestSpan,
    similarity: Number(bestSimilarity.toFixed(3)),
    editDistance: bestDistance,
  };
}
