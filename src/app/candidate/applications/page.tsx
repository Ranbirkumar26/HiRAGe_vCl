import Link from "next/link";

import { Badge, Card, EmptyState, SectionTitle } from "@/components/ui";
import { requireCandidate } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface ApplicationRow {
  job_id: string;
  created_at: string;
  jobs: {
    id: string;
    company_name: string;
    tags: string[];
    status: string;
  } | null;
}

export default async function ApplicationsPage() {
  const session = await requireCandidate();
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("applications")
    .select("job_id, created_at, jobs (id, company_name, tags, status)")
    .eq("candidate_id", session.userId)
    .eq("status", "applied")
    .order("created_at", { ascending: false });

  // The join yields null for a deleted job because RLS hides it, which is what
  // drops deleted jobs out of this list.
  const applications = ((rows ?? []) as unknown as ApplicationRow[]).filter(
    (row) => row.jobs !== null,
  );

  const { data: notifications } = await supabase
    .from("notifications")
    .select("job_id")
    .eq("recipient_id", session.userId);
  const shortlistedJobIds = new Set(
    (notifications ?? []).map((row) => row.job_id as string).filter(Boolean),
  );

  return (
    <div className="mx-auto max-w-3xl">
      <SectionTitle
        title="Your applications"
        description="Every job opening you have an active application for."
      />

      {applications.length === 0 ? (
        <EmptyState>
          You have not applied to any jobs yet.{" "}
          <Link href="/candidate" className="text-brand-blue hover:underline">
            Browse open roles
          </Link>
          .
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {applications.map((row) => {
            const job = row.jobs!;
            return (
              <li key={row.job_id}>
                <Link href={`/candidate/jobs/${job.id}`} className="block">
                  <Card className="transition hover:border-[var(--border-strong)]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">{job.company_name}</h3>
                        <p className="mt-0.5 text-sm text-muted">
                          Applied {new Date(row.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {shortlistedJobIds.has(job.id) ? (
                          <Badge tone="green">Shortlisted</Badge>
                        ) : null}
                        {job.status === "frozen" ? (
                          <Badge tone="neutral">Role frozen</Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {job.tags.map((tag) => (
                        <Badge key={tag} tone="blue">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
