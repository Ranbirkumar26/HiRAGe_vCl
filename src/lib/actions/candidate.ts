"use server";

import { revalidatePath } from "next/cache";

import { requireCandidate } from "../auth/session";
import { MAX_POOL_SIZE, countPool, ingestResume } from "../ingest";
import { createAdminClient } from "../supabase/admin";
import { type ActionState, failure, ok } from "./types";

export async function applyToJobAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireCandidate();
  const jobId = String(formData.get("job_id") ?? "");
  const file = formData.get("resume");

  if (!jobId) return failure("Missing job.");
  if (!(file instanceof File) || file.size === 0) {
    return failure("Attach your resume as a PDF or Word file.");
  }

  const db = createAdminClient();

  const { data: job } = await db
    .from("jobs")
    .select("id, status, deleted_at")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.deleted_at) return failure("This job is no longer available.");
  if (job.status === "frozen") return failure("This job is frozen and cannot be applied to.");

  const { data: application } = await db
    .from("applications")
    .select("id, status")
    .eq("job_id", jobId)
    .eq("candidate_id", session.userId)
    .maybeSingle();

  if (application?.status === "applied") {
    return failure("You have already applied to this job. Opt out first to replace your resume.");
  }

  if ((await countPool(db, jobId)) >= MAX_POOL_SIZE) {
    return failure("This job is no longer accepting resumes.");
  }

  const result = await ingestResume(db, jobId, file, "application", session.userId);
  if (result.error || !result.resumeId) {
    return failure(result.error ?? "Your resume could not be uploaded.");
  }

  const { error } = await db.from("applications").upsert(
    {
      job_id: jobId,
      candidate_id: session.userId,
      resume_id: result.resumeId,
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

/**
 * Opting out withdraws the application and removes the resume from the job's
 * pool, which bumps the pool version and therefore invalidates the ranking.
 * Cached explanations survive, because they never depended on the pool.
 */
export async function optOutAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireCandidate();
  const jobId = String(formData.get("job_id") ?? "");
  if (!jobId) return failure("Missing job.");

  const db = createAdminClient();

  const { data: job } = await db
    .from("jobs")
    .select("id, status, deleted_at")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.deleted_at) return failure("This job is no longer available.");
  if (job.status === "frozen") {
    return failure("This job is frozen, so the application can no longer be changed.");
  }

  const { data: application } = await db
    .from("applications")
    .select("id, resume_id, status")
    .eq("job_id", jobId)
    .eq("candidate_id", session.userId)
    .maybeSingle();

  if (!application || application.status !== "applied") {
    return failure("You do not have an active application for this job.");
  }

  if (application.resume_id) {
    await db.from("resumes").delete().eq("id", application.resume_id);
  }

  const { error } = await db
    .from("applications")
    .update({
      status: "withdrawn",
      resume_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", application.id);
  if (error) return failure(error.message);

  revalidatePath("/candidate");
  revalidatePath(`/candidate/jobs/${jobId}`);
  revalidatePath("/candidate/applications");
  return ok("You have opted out. You can upload a new resume whenever you like.");
}
