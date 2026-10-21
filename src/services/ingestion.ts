// src/services/ingestion.ts
import fs from "node:fs/promises";
import path from "node:path";

export interface IngestedDocument {
  id: string;
  filename: string;
  rawSourceText: string;
  extractedPayload?: Record<string, any>;
  ingestedAt: string;
}

const INVOICES_DIR = path.join(process.cwd(), "data", "invoices");

export async function scanLocalInvoices(customDir?: string): Promise<IngestedDocument[]> {
  const targetDir = customDir ?? INVOICES_DIR;
  try {
    await fs.mkdir(targetDir, { recursive: true });
    const files = await fs.readdir(targetDir);
    const documents: IngestedDocument[] = [];

    for (const file of files) {
      if (!file.endsWith(".txt") && !file.endsWith(".md") && !file.endsWith(".json")) {
        continue;
      }

      const filePath = path.join(targetDir, file);
      const content = await fs.readFile(filePath, "utf-8");
      const id = `doc_${path.basename(file, path.extname(file))}_${Date.now()}`;

      if (file.endsWith(".json")) {
        try {
          const parsed = JSON.parse(content);
          documents.push({
            id,
            filename: file,
            rawSourceText: parsed.rawText || "",
            extractedPayload: parsed.extractedPayload,
            ingestedAt: new Date().toISOString(),
          });
        } catch (jsonErr) {
          console.warn(`Failed to parse JSON file ${file}:`, jsonErr);
        }
      } else {
        documents.push({
          id,
          filename: file,
          rawSourceText: content,
          ingestedAt: new Date().toISOString(),
        });
      }
    }

    return documents;
  } catch (error) {
    console.error("Error scanning local invoices directory:", error);
    return [];
  }
}
