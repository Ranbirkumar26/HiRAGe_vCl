"use server";

/**
 * Direct-to-storage upload path.
 *
 * Files used to travel through a Server Action, which is fine on a Node server
 * but fails on serverless hosts: Vercel caps a function's request body at
 * 4.5 MB and Hobby functions at 10 seconds, and neither is configurable. A
 * bulk pool upload exceeds both.
 *
 * Instead the browser hashes the file, asks the server for a signed upload URL,
 * PUTs the bytes straight to Supabase Storage, and then tells the server what
 * landed. Only small JSON payloads cross the Server Action boundary, so upload
 * size stops being the web tier's problem.
 *
 * The client never chooses the storage path. The server derives it from the
 * content hash and signs only that path, so a caller cannot write anywhere else
 * in the bucket.
 */

import { revalidatePath } from "next/cache";

import { requireAdmin, requireCandidate, requireSession } from "../auth/session";
import { MAX_FILE_BYTES, MAX_POOL_SIZE, countPool } from "../ingest";
import { isSupportedResumeFile } from "../rag/parse";
import { createAdminClient } from "../supabase/admin";
import { type ActionState, failure, ok } from "./types";

const HASH_PATTERN = /^[0-9a-f]{64}$/;

export interface UploadRequest {
  name: string;
  type: string;
  size: number;
  /** SHA-256 of the file bytes, hex, computed in the browser. */
  hash: string;
}

export interface UploadTarget {
  hash: string;
  name: string;
  /** `exists` means the bytes are already stored and must not be re-uploaded. */
  status: "exists" | "upload" | "rejected";
  path?: string;
  token?: string;
  reason?: string;
}

function extensionOf(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.(pdf|docx)$/);
  return match ? match[0] : "";
}

function validate(file: UploadRequest): string | null {
  if (!HASH_PATTERN.test(file.hash)) return "Could not fingerprint this file.";
  if (!file.size) return "File is empty.";
  if (file.size > MAX_FILE_BYTES) return "File is larger than 10 MB.";
  if (!isSupportedResumeFile(file.name, file.type)) {
    return "Only PDF and Word (.docx) files are accepted.";
  }
  return null;
}

/**
 * Step one. Returns, per file, either a signed upload URL or a note that the
 * content is already stored. Any signed-in user may call this, because both an
 * admin bulk upload and a candidate application go through it, but the caller
 * can only ever obtain a URL for a hash-derived path.
 */
export async function createUploadTargets(
  jobId: string,
  files: UploadRequest[],
): Promise<{ targets: UploadTarget[]; error?: string }> {
  await requireSession();

  if (!jobId) return { targets: [], error: "Missing job." };
  if (!files.length) return { targets: [], error: "No files selected." };
  if (files.length > MAX_POOL_SIZE) {
    return { targets: [], error: `Select at most ${MAX_POOL_SIZE} files at a time.` };
  }

  const db = createAdminClient();

  const { data: job } = await db
    .from("jobs")
    .select("id, deleted_at")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.deleted_at) {
    return { targets: [], error: "This job is no longer available." };
  }

  const targets: UploadTarget[] = [];

  for (const file of files) {
    const problem = validate(file);
    if (problem) {
      targets.push({ hash: file.hash, name: file.name, status: "rejected", reason: problem });
      continue;
    }

    const { data: existing } = await db
      .from("documents")
      .select("id")
      .eq("content_hash", file.hash)
      .maybeSingle();

    if (existing) {
      targets.push({ hash: file.hash, name: file.name, status: "exists" });
      continue;
    }

    const path = `${file.hash}${extensionOf(file.name)}`;
    const { data: signed, error } = await db.storage
      .from("resumes")
      .createSignedUploadUrl(path, { upsert: true });

    if (error || !signed) {
      targets.push({
        hash: file.hash,
        name: file.name,
        status: "rejected",
        reason: error?.message ?? "Could not prepare the upload.",
      });
      continue;
    }

    targets.push({
      hash: file.hash,
      name: file.name,
      status: "upload",
      path: signed.path,
      token: signed.token,
    });
  }

  return { targets };
}

interface FinalisedUpload {
  hash: string;
  name: string;
  type: string;
  size: number;
}

/**
 * Creates the `documents` row for anything newly uploaded, then links every
 * file to the job's pool. Returns the resume ids in the order given.
 */
async function recordUploads(
  db: ReturnType<typeof createAdminClient>,
  jobId: string,
  uploads: FinalisedUpload[],
  source: "admin_upload" | "application",
  candidateId: string | null,
): Promise<{ resumeIds: string[]; added: number; reused: number; failures: string[] }> {
  const resumeIds: string[] = [];
  const failures: string[] = [];
  let added = 0;
  let reused = 0;

  for (const upload of uploads) {
    if (!HASH_PATTERN.test(upload.hash)) {
      failures.push(`${upload.name}: bad fingerprint.`);
      continue;
    }

    let documentId: string | undefined;

    const { data: existing } = await db
      .from("documents")
      .select("id")
      .eq("content_hash", upload.hash)
      .maybeSingle();

    if (existing) {
      documentId = existing.id as string;
    } else {
      const { data: inserted, error } = await db
        .from("documents")
        .insert({
          content_hash: upload.hash,
          storage_path: `${upload.hash}${extensionOf(upload.name)}`,
          file_name: upload.name,
          mime_type: upload.type || "application/octet-stream",
          byte_size: upload.size,
        })
        .select("id")
        .single();

      if (error || !inserted) {
        // A concurrent upload of identical bytes may have won the unique index.
        const { data: raced } = await db
          .from("documents")
          .select("id")
          .eq("content_hash", upload.hash)
          .maybeSingle();
        if (!raced) {
          failures.push(`${upload.name}: ${error?.message ?? "could not be recorded"}`);
          continue;
        }
        documentId = raced.id as string;
      } else {
        documentId = inserted.id as string;
      }
    }

    // Leave an existing pool row alone. An admin bulk upload must not overwrite
    // the candidate link on a resume that arrived through an application.
    const { data: alreadyInPool } = await db
      .from("resumes")
      .select("id")
      .eq("job_id", jobId)
      .eq("document_id", documentId)
      .maybeSingle();

    if (alreadyInPool) {
      resumeIds.push(alreadyInPool.id as string);
      reused++;
      continue;
    }

    const { data: resume, error: resumeError } = await db
      .from("resumes")
      .insert({ job_id: jobId, document_id: documentId, source, candidate_id: candidateId })
      .select("id")
      .single();

    if (resumeError || !resume) {
      failures.push(`${upload.name}: ${resumeError?.message ?? "could not join the pool"}`);
      continue;
    }

    resumeIds.push(resume.id as string);
    added++;
  }

  return { resumeIds, added, reused, failures };
}

/** Step two for an admin bulk upload. */
export async function finaliseAdminUploads(
  jobId: string,
  uploads: FinalisedUpload[],
): Promise<ActionState> {
  await requireAdmin();

  if (!jobId) return failure("Missing job.");
  if (!uploads.length) return failure("Nothing was uploaded.");

  const db = createAdminClient();

  const existing = await countPool(db, jobId);
  if (existing + uploads.length > MAX_POOL_SIZE) {
    return failure(
      `This job already holds ${existing} resumes. The pool is capped at ${MAX_POOL_SIZE}.`,
    );
  }

  const { added, reused, failures } = await recordUploads(
    db,
    jobId,
    uploads,
    "admin_upload",
    null,
  );

  revalidatePath(`/admin/jobs/${jobId}`);

  const parts = [`${added} added`];
  if (reused) parts.push(`${reused} already in the pool`);
  if (failures.length) parts.push(`${failures.length} rejected`);
  const summary = parts.join(", ") + ".";

  return failures.length
    ? failure(`${summary} ${failures.slice(0, 3).join(" ")}`)
    : ok(summary);
}

/** Step two for a candidate applying to a job. */
export async function finaliseApplication(
  jobId: string,
  upload: FinalisedUpload,
): Promise<ActionState> {
  const session = await requireCandidate();
  if (!jobId) return failure("Missing job.");

  const db = createAdminClient();

  const { data: job } = await db
    .from("jobs")
    .select("id, status, deleted_at")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.deleted_at) return failure("This job is no longer available.");
  if (job.status === "frozen") {
    return failure("This job is frozen and cannot be applied to.");
  }

  const { data: application } = await db
    .from("applications")
    .select("id, status")
    .eq("job_id", jobId)
    .eq("candidate_id", session.userId)
    .maybeSingle();

  if (application?.status === "applied") {
    return failure(
      "You have already applied to this job. Opt out first to replace your resume.",
    );
  }

  if ((await countPool(db, jobId)) >= MAX_POOL_SIZE) {
    return failure("This job is no longer accepting resumes.");
  }

  const { resumeIds, failures } = await recordUploads(
    db,
    jobId,
    [upload],
    "application",
    session.userId,
  );

  if (!resumeIds.length) {
    return failure(failures[0] ?? "Your resume could not be recorded.");
  }

  const { error } = await db.from("applications").upsert(
    {
      job_id: jobId,
      candidate_id: session.userId,
      resume_id: resumeIds[0],
      status: "applied",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "job_id,candidate_id" },
  );
  if (error) return failure(error.message);

  revalidatePath("/candidate");
  revalidatePath(`/candidate/jobs/${jobId}`);
  revalidatePath("/candidate/applications");
  return ok("Application submitted.");
}
