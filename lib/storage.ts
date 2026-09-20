import { mkdir, copyFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { put } from "@vercel/blob";

/**
 * Storage abstraction so the worker doesn't care where generated decks
 * end up. The worker runs on a separate host from the Vercel-hosted API
 * (see ARCHITECTURE.md), so they don't share a filesystem — generated
 * decks go to Vercel Blob, and `saveDeck` returns its public URL, which
 * is what gets persisted in `jobs.file_path`.
 *
 * Falls back to local filesystem when BLOB_READ_WRITE_TOKEN isn't set
 * (e.g. local dev without a linked Vercel Blob store).
 */

const GENERATED_DIR = resolve(process.env.GENERATED_DIR || "./generated");
const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export async function saveDeck(jobId: string, sourcePath: string): Promise<string> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const buffer = await readFile(sourcePath);
    const blob = await put(`decks/${jobId}.pptx`, buffer, {
      access: "public",
      contentType: PPTX_CONTENT_TYPE,
      addRandomSuffix: false,
    });
    return blob.url;
  }

  await mkdir(GENERATED_DIR, { recursive: true });
  const destPath = join(GENERATED_DIR, `${jobId}.pptx`);
  await copyFile(sourcePath, destPath);
  return destPath;
}

export function deckPathForJob(jobId: string): string {
  return join(GENERATED_DIR, `${jobId}.pptx`);
}
