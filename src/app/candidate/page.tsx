import { Suspense } from "react";

import { JobCard } from "@/components/candidate/job-card";
import { JobFilters } from "@/components/candidate/job-filters";
import { EmptyState, SectionTitle } from "@/components/ui";
import { requireCandidate } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Job } from "@/lib/types";

export const dynamic = "force-dynamic";

type SortKey = "newest" | "oldest" | "company" | "role";

function sortJobs(jobs: Job[], sort: SortKey): Job[] {
  const sorted = [...jobs];
  switch (sort) {
    case "oldest":
      return sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
    case "company":
      return sorted.sort((a, b) => a.company_name.localeCompare(b.company_name));
    case "role":
      return sorted.sort((a, b) =>
        (a.tags[0] ?? "").localeCompare(b.tags[0] ?? ""),
      );
    default:
      return sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}

export default async function CandidateJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; company?: string; sort?: string }>;
}) {
  const session = await requireCandidate();
  const { role, company, sort } = await searchParams;

  const supabase = await createClient();

  // RLS keeps deleted jobs out of this result, so a deleted job simply is not
  // in the portal any more.
  const { data: jobRows } = await supabase
    .from("jobs")
    .select("id, company_name, recruiter_name, tags, status, created_at")
    .is("deleted_at", null);

  const { data: applications } = await supabase
    .from("applications")
    .select("job_id, status")
    .eq("candidate_id", session.userId);

  const { data: notifications } = await supabase
    .from("notifications")
    .select("job_id")
    .eq("recipient_id", session.userId);

  const appliedJobIds = new Set(
    (applications ?? [])
      .filter((row) => row.status === "applied")
      .map((row) => row.job_id as string),
  );
  const shortlistedJobIds = new Set(
    (notifications ?? []).map((row) => row.job_id as string).filter(Boolean),
  );

  const allJobs = (jobRows ?? []) as unknown as Job[];

  const roleOptions = [...new Set(allJobs.flatMap((job) => job.tags))].sort();

  const filtered = allJobs.filter((job) => {
    const matchesRole = role
      ? job.tags.some((tag) => tag.toLowerCase() === role.toLowerCase())
      : true;
    const matchesCompany = company
      ? job.company_name.toLowerCase().includes(company.toLowerCase())
      : true;
    return matchesRole && matchesCompany;
  });

  const ordered = sortJobs(filtered, (sort as SortKey) ?? "newest");

  // Section 4.5: jobs tagged with a role the candidate listed as an interest.
  const interests = session.profile.roles_of_interest.map((r) => r.toLowerCase());
  const matched = interests.length
    ? ordered.filter((job) =>
        job.tags.some((tag) => interests.includes(tag.toLowerCase())),
      )
    : [];
  const matchedIds = new Set(matched.map((job) => job.id));
  const rest = ordered.filter((job) => !matchedIds.has(job.id));

  return (
    <div>
      <Suspense fallback={null}>
        <JobFilters roleOptions={roleOptions} />
      </Suspense>

      {matched.length > 0 ? (
        <section className="mb-8">
          <SectionTitle
            title="Matches your roles of interest"
            description={`Tagged with ${session.profile.roles_of_interest.join(", ")}.`}
          />
          <ul className="space-y-3">
            {matched.map((job) => (
              <li key={job.id}>
                <JobCard
                  job={job}
                  applied={appliedJobIds.has(job.id)}
                  shortlisted={shortlistedJobIds.has(job.id)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <SectionTitle
          title={matched.length ? "All other openings" : "Open roles"}
          description={
            interests.length
              ? undefined
              : "Add roles of interest in your profile to surface matching jobs first."
          }
        />
        {rest.length === 0 ? (
          <EmptyState>
            {ordered.length === 0
              ? "No jobs match those filters."
              : "Every open role matches your roles of interest."}
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {rest.map((job) => (
              <li key={job.id}>
                <JobCard
                  job={job}
                  applied={appliedJobIds.has(job.id)}
                  shortlisted={shortlistedJobIds.has(job.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
