import Link from "next/link";

import { CreateJobForm } from "@/components/admin/create-job-form";
import { Badge, Card, EmptyState, SectionTitle } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Job } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminJobsPage() {
  await requireAdmin();
  const db = createAdminClient();

  const { data: jobs } = await db
    .from("jobs")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const { data: poolRows } = await db.from("resumes").select("job_id");
  const poolSize = new Map<string, number>();
  for (const row of poolRows ?? []) {
    const jobId = row.job_id as string;
    poolSize.set(jobId, (poolSize.get(jobId) ?? 0) + 1);
  }

  const list = (jobs ?? []) as Job[];

  return (
    <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
      <section>
        <SectionTitle
          title="Jobs"
          description="Open a job to manage its resume pool, run the pipeline and shortlist."
        />
        {list.length === 0 ? (
          <EmptyState>No jobs yet. Create one to get started.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {list.map((job) => (
              <li key={job.id}>
                <Link href={`/admin/jobs/${job.id}`} className="block">
                  <Card className="transition hover:border-[var(--border-strong)]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">{job.company_name}</h3>
                        <p className="mt-0.5 text-sm text-muted">
                          {job.recruiter_name} &middot; {job.recruiter_email}
                        </p>
                      </div>
                      {job.status === "frozen" ? (
                        <Badge tone="neutral">Frozen</Badge>
                      ) : (
                        <Badge tone="green">Open</Badge>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {job.tags.map((tag) => (
                        <Badge key={tag} tone="blue">
                          {tag}
                        </Badge>
                      ))}
                    </div>

                    <p className="mt-3 text-sm text-muted">
                      {poolSize.get(job.id) ?? 0} resume
                      {(poolSize.get(job.id) ?? 0) === 1 ? "" : "s"} in the pool
                      {" · "}
                      created {new Date(job.created_at).toLocaleDateString()}
                    </p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <CreateJobForm />
      </section>
    </div>
  );
}
