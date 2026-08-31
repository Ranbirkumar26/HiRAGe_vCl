import Link from "next/link";
import { notFound } from "next/navigation";

import { ApplyPanel } from "@/components/candidate/apply-panel";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { requireCandidate } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CandidateJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireCandidate();
  const { id } = await params;

  const supabase = await createClient();

  // A deleted job is filtered out by RLS, so it 404s here exactly as it
  // disappears from the listing.
  const { data: job } = await supabase
    .from("jobs")
    .select("id, company_name, recruiter_name, tags, status, description, created_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!job) notFound();

  const { data: application } = await supabase
    .from("applications")
    .select("status")
    .eq("job_id", id)
    .eq("candidate_id", session.userId)
    .maybeSingle();

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div>
        <Link href="/candidate" className="text-sm text-brand-blue hover:underline">
          Back to jobs
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{job.company_name}</h1>
          {job.status === "frozen" ? <Badge tone="neutral">Role frozen</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-muted">
          Posted {new Date(job.created_at).toLocaleDateString()} by {job.recruiter_name}
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {(job.tags as string[]).map((tag) => (
            <Badge key={tag} tone="blue">
              {tag}
            </Badge>
          ))}
        </div>

        <Card className="mt-5">
          <SectionTitle title="Job description" />
          <p className="whitespace-pre-wrap text-sm text-muted">{job.description}</p>
        </Card>
      </div>

      <ApplyPanel
        jobId={job.id}
        frozen={job.status === "frozen"}
        applied={application?.status === "applied"}
      />
    </div>
  );
}
