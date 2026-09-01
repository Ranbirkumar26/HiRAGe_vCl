"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdmin, requireSuperAdmin } from "../auth/session";
import { MAX_POOL_SIZE, countPool } from "../ingest";
import { parseDocument } from "../rag/parse";
import { createAdminClient } from "../supabase/admin";
import { SUPER_ADMIN_EMAIL } from "../types";
import { type ActionState, failure, messageOf, ok } from "./types";

const jobFields = z.object({
  company_name: z.string().trim().min(1, "Company name is required."),
  recruiter_name: z.string().trim().min(1, "Recruiter name is required."),
  recruiter_email: z.string().trim().toLowerCase().email("Enter a valid recruiter email."),
});

function parseTags(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * The job description may be typed in or uploaded. An uploaded file is parsed
 * immediately, because the description has to exist as text before it can be
 * embedded for retrieval.
 */
async function resolveDescription(
  formData: FormData,
): Promise<{ text: string; storagePath: string | null } | { error: string }> {
  const typed = String(formData.get("description") ?? "").trim();
  const file = formData.get("description_file");

  if (file instanceof File && file.size > 0) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = await parseDocument(bytes, file.name, file.type);
      if (!parsed.text.trim()) {
        return { error: "No text could be extracted from that job description file." };
      }

      const db = createAdminClient();
      const storagePath = `${crypto.randomUUID()}-${file.name}`;
      const { error } = await db.storage
        .from("job-descriptions")
        .upload(storagePath, bytes, {
          contentType: file.type || "application/octet-stream",
        });
      if (error) return { error: error.message };

      return { text: parsed.text, storagePath };
    } catch (error) {
      return { error: messageOf(error) };
    }
  }

  if (!typed) return { error: "Provide a job description, either typed or as a file." };
  return { text: typed, storagePath: null };
}

export async function createJobAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireAdmin();

  const parsed = jobFields.safeParse({
    company_name: formData.get("company_name"),
    recruiter_name: formData.get("recruiter_name"),
    recruiter_email: formData.get("recruiter_email"),
  });
  if (!parsed.success) return failure(parsed.error.issues[0].message);

  const tags = parseTags(formData.get("tags"));
  if (!tags.length) return failure("Add at least one role tag.");

  const description = await resolveDescription(formData);
  if ("error" in description) return failure(description.error);

  const db = createAdminClient();
  const { data, error } = await db
    .from("jobs")
    .insert({
      created_by: session.userId,
      ...parsed.data,
      tags,
      description: description.text,
      description_file_path: description.storagePath,
    })
    .select("id")
    .single();

  if (error || !data) return failure(error?.message ?? "Could not create the job.");

  revalidatePath("/admin");
  redirect(`/admin/jobs/${data.id}`);
}

/**
 * Editing the description bumps `jd_version` and clears the artefacts that were
 * derived from the previous one: the ranking for this job and every cached
 * explanation belonging to its pool (spec 1.5).
 */
export async function updateJobDescriptionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const jobId = String(formData.get("job_id") ?? "");
  if (!jobId) return failure("Missing job.");

  const description = await resolveDescription(formData);
  if ("error" in description) return failure(description.error);

  const db = createAdminClient();
  const { data: job, error: loadError } = await db
    .from("jobs")
    .select("jd_version, description")
    .eq("id", jobId)
    .single();
  if (loadError || !job) return failure("Job not found.");

  if (job.description.trim() === description.text.trim()) {
    return ok("The job description is unchanged.");
  }

  const { error } = await db
    .from("jobs")
    .update({
      description: description.text,
      description_file_path: description.storagePath,
      jd_version: job.jd_version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (error) return failure(error.message);

  await db.from("rankings").delete().eq("job_id", jobId);

  const { data: resumes } = await db.from("resumes").select("id").eq("job_id", jobId);
  const resumeIds = (resumes ?? []).map((row) => row.id as string);
  for (let start = 0; start < resumeIds.length; start += 200) {
    await db
      .from("explanations")
      .delete()
      .in("resume_id", resumeIds.slice(start, start + 200));
  }

  revalidatePath(`/admin/jobs/${jobId}`);
  return ok(
    "Job description updated. The ranking and all explanations for this job were cleared.",
  );
}

export async function freezeJobAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const jobId = String(formData.get("job_id") ?? "");
  if (!jobId) return;

  const db = createAdminClient();
  await db
    .from("jobs")
    .update({ status: "frozen", updated_at: new Date().toISOString() })
    .eq("id", jobId);

  revalidatePath("/admin");
  revalidatePath(`/admin/jobs/${jobId}`);
}

export async function deleteJobAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const jobId = String(formData.get("job_id") ?? "");
  if (!jobId) return;

  const db = createAdminClient();
  await db
    .from("jobs")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", jobId);

  revalidatePath("/admin");
  redirect("/admin");
}

async function enqueue(
  jobId: string,
  kind: "parse" | "shortlist",
  payload: Record<string, unknown>,
): Promise<ActionState> {
  const db = createAdminClient();
  const { error } = await db
    .from("pipeline_jobs")
    .insert({ job_id: jobId, kind, payload });

  if (error) {
    // The partial unique index rejects a second live run of the same kind.
    if (error.code === "23505") {
      return failure(
        kind === "parse"
          ? "Parsing is already running for this job."
          : "A shortlist run is already in progress for this job.",
      );
    }
    return failure(error.message);
  }

  revalidatePath(`/admin/jobs/${jobId}`);
  return ok(kind === "parse" ? "Parsing started." : "Shortlist started.");
}

export async function startParseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const jobId = String(formData.get("job_id") ?? "");
  if (!jobId) return failure("Missing job.");

  const db = createAdminClient();
  if ((await countPool(db, jobId)) === 0) {
    return failure("Upload resumes before running the parse.");
  }

  return enqueue(jobId, "parse", {});
}

export async function startShortlistAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const jobId = String(formData.get("job_id") ?? "");
  const k = Number(formData.get("k") ?? 10);

  if (!jobId) return failure("Missing job.");
  if (!Number.isInteger(k) || k < 1 || k > MAX_POOL_SIZE) {
    return failure(`Choose a k between 1 and ${MAX_POOL_SIZE}.`);
  }

  // Without at least one parsed resume there is nothing to rank, and the run
  // would still spend an embedding request on the job description before
  // discovering that. Refuse it here, the way the parse run refuses an empty
  // pool. A pool that is parsed but not yet ranked is allowed through, because
  // re-ranking after the pool changed is legitimate work.
  const db = createAdminClient();
  const { count } = await db
    .from("resumes")
    .select("id, documents!inner (status)", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("documents.status", "parsed");

  if (!count) {
    return failure("Run the parse first. No resume has been parsed for this job yet.");
  }

  return enqueue(jobId, "shortlist", { k });
}

/**
 * Marks a candidate shortlisted and routes the notification by the address
 * extracted from their resume. No account for that address means no message,
 * while the shortlist itself still stands on the admin side (spec 3.8).
 */
export async function confirmShortlistAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireAdmin();
  const jobId = String(formData.get("job_id") ?? "");
  const resumeId = String(formData.get("resume_id") ?? "");
  if (!jobId || !resumeId) return failure("Missing candidate.");

  const db = createAdminClient();

  const { data: job } = await db
    .from("jobs")
    .select("company_name, recruiter_name, recruiter_email")
    .eq("id", jobId)
    .single();
  if (!job) return failure("Job not found.");

  const { data: resume } = await db
    .from("resumes")
    .select("id, documents (extracted_email)")
    .eq("id", resumeId)
    .eq("job_id", jobId)
    .single();
  if (!resume) return failure("Candidate not found in this job's pool.");

  const candidateEmail =
    (resume as unknown as { documents: { extracted_email: string | null } | null })
      .documents?.extracted_email ?? null;

  const { data: shortlist, error: shortlistError } = await db
    .from("shortlists")
    .upsert(
      {
        job_id: jobId,
        resume_id: resumeId,
        candidate_email: candidateEmail,
        confirmed_by: session.userId,
      },
      { onConflict: "job_id,resume_id" },
    )
    .select("id, notified")
    .single();
  if (shortlistError || !shortlist) {
    return failure(shortlistError?.message ?? "Could not record the shortlist.");
  }

  if (shortlist.notified) {
    revalidatePath(`/admin/jobs/${jobId}`);
    return ok("Candidate was already shortlisted.");
  }

  if (!candidateEmail) {
    revalidatePath(`/admin/jobs/${jobId}`);
    return ok("Candidate shortlisted. No email address was found on the resume.");
  }

  const { data: recipient } = await db
    .from("profiles")
    .select("id")
    .ilike("email", candidateEmail)
    .maybeSingle();

  if (!recipient) {
    revalidatePath(`/admin/jobs/${jobId}`);
    return ok(
      `Candidate shortlisted. No HiRAGe account exists for ${candidateEmail}, so no message was sent.`,
    );
  }

  const { error: notifyError } = await db.from("notifications").insert({
    recipient_id: recipient.id,
    job_id: jobId,
    company_name: job.company_name,
    recruiter_name: job.recruiter_name,
    recruiter_email: job.recruiter_email,
    body: `You have been shortlisted for the next round at ${job.company_name}.`,
  });
  if (notifyError) return failure(notifyError.message);

  await db.from("shortlists").update({ notified: true }).eq("id", shortlist.id);

  revalidatePath(`/admin/jobs/${jobId}`);
  return ok(`Candidate shortlisted and notified at ${candidateEmail}.`);
}

/**
 * Removes the admin role, returning the account to `candidate`.
 *
 * Super admin only, like granting. The fixed super admin address is refused:
 * revoking it would leave nobody able to grant the role back, and the trigger
 * in the schema would hand it straight back on the next confirmation anyway.
 */
export async function revokeAdminAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSuperAdmin();

  const email = z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .safeParse(formData.get("email"));
  if (!email.success) return failure("Enter a valid email address.");

  if (email.data === SUPER_ADMIN_EMAIL) {
    return failure("The super admin cannot have its own admin role removed.");
  }

  const db = createAdminClient();
  const { data: profile } = await db
    .from("profiles")
    .select("id, role")
    .ilike("email", email.data)
    .maybeSingle();

  if (!profile) return failure("No account exists for that address.");
  if (profile.role !== "admin") {
    return ok("That account does not hold the admin role.");
  }

  const { error } = await db
    .from("profiles")
    .update({ role: "candidate", updated_at: new Date().toISOString() })
    .eq("id", profile.id);
  if (error) return failure(error.message);

  revalidatePath("/admin/access");
  return ok(`${email.data} no longer has the admin role.`);
}

export async function grantAdminAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSuperAdmin();

  const email = z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .safeParse(formData.get("email"));
  if (!email.success) return failure("Enter a valid email address.");

  const db = createAdminClient();
  const { data: profile } = await db
    .from("profiles")
    .select("id, role")
    .ilike("email", email.data)
    .maybeSingle();

  if (!profile) {
    return failure(
      "No confirmed account exists for that address. The user must sign up and confirm their email first.",
    );
  }
  if (profile.role === "admin") return ok("That account already holds the admin role.");

  const { error } = await db
    .from("profiles")
    .update({ role: "admin", updated_at: new Date().toISOString() })
    .eq("id", profile.id);
  if (error) return failure(error.message);

  revalidatePath("/admin/access");
  return ok(`${email.data} now has the admin role.`);
}
