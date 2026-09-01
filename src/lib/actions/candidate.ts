"use server";

import { revalidatePath } from "next/cache";

import { requireCandidate } from "../auth/session";

import { createAdminClient } from "../supabase/admin";
import { type ActionState, failure, ok } from "./types";

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
