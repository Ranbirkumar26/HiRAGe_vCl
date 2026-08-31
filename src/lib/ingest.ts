/**
 * Shared ingestion path for both routes a resume can take into a pool: a
 * candidate applying, and an admin bulk uploading from the job detail page.
 *
 * Files are stored under their content hash, so the same resume submitted by a
 * candidate and again by an admin occupies one document row, is parsed once and
 * is embedded once.
 */

import type { Db } from "./supabase/db";
import { contentHash } from "./rag/hash";
import { isSupportedResumeFile } from "./rag/parse";
import type { ResumeSource } from "./types";

/** Design target from the spec: 1,000 to 1,200 documents per job. */
export const MAX_POOL_SIZE = 1200;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface IngestResult {
  fileName: string;
  resumeId?: string;
  reused: boolean;
  error?: string;
}

function extensionOf(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.(pdf|docx)$/);
  return match ? match[0] : "";
}

export async function countPool(db: Db, jobId: string): Promise<number> {
  const { count } = await db
    .from("resumes")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  return count ?? 0;
}

export async function ingestResume(
  db: Db,
  jobId: string,
  file: File,
  source: ResumeSource,
  candidateId: string | null,
): Promise<IngestResult> {
  if (!file.size) return { fileName: file.name, reused: false, error: "File is empty." };
  if (file.size > MAX_FILE_BYTES) {
    return { fileName: file.name, reused: false, error: "File is larger than 10 MB." };
  }
  if (!isSupportedResumeFile(file.name, file.type)) {
    return {
      fileName: file.name,
      reused: false,
      error: "Only PDF and Word (.docx) files are accepted.",
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = contentHash(bytes);

  const { data: existing } = await db
    .from("documents")
    .select("id")
    .eq("content_hash", hash)
    .maybeSingle();

  let documentId = existing?.id as string | undefined;
  const reused = Boolean(documentId);

  if (!documentId) {
    const storagePath = `${hash}${extensionOf(file.name)}`;
    const { error: uploadError } = await db.storage
      .from("resumes")
      .upload(storagePath, bytes, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      });
    if (uploadError) {
      return { fileName: file.name, reused: false, error: uploadError.message };
    }

    const { data: inserted, error: insertError } = await db
      .from("documents")
      .insert({
        content_hash: hash,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        byte_size: bytes.byteLength,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      // A concurrent upload of the same bytes may have won the unique index.
      const { data: raced } = await db
        .from("documents")
        .select("id")
        .eq("content_hash", hash)
        .maybeSingle();
      if (!raced) {
        return { fileName: file.name, reused: false, error: insertError?.message };
      }
      documentId = raced.id as string;
    } else {
      documentId = inserted.id as string;
    }
  }

  // If this document is already in the pool, leave the existing row alone. An
  // admin bulk upload must not overwrite the candidate link on a resume that
  // arrived through an application.
  const { data: alreadyInPool } = await db
    .from("resumes")
    .select("id")
    .eq("job_id", jobId)
    .eq("document_id", documentId)
    .maybeSingle();

  if (alreadyInPool) {
    return { fileName: file.name, resumeId: alreadyInPool.id as string, reused: true };
  }

  const { data: resume, error: resumeError } = await db
    .from("resumes")
    .insert({ job_id: jobId, document_id: documentId, source, candidate_id: candidateId })
    .select("id")
    .single();

  if (resumeError || !resume) {
    return { fileName: file.name, reused, error: resumeError?.message };
  }

  return { fileName: file.name, resumeId: resume.id as string, reused };
}
