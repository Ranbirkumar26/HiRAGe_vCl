import Link from "next/link";

import { Badge, Card } from "../ui";
import type { Job } from "@/lib/types";

export function JobCard({
  job,
  applied,
  shortlisted,
}: {
  job: Pick<Job, "id" | "company_name" | "tags" | "status" | "created_at" | "recruiter_name">;
  applied?: boolean;
  shortlisted?: boolean;
}) {
  return (
    <Link href={`/candidate/jobs/${job.id}`} className="block">
      <Card className="transition hover:border-[var(--border-strong)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">{job.company_name}</h3>
            <p className="mt-0.5 text-sm text-muted">
              Posted {new Date(job.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {shortlisted ? <Badge tone="green">Shortlisted</Badge> : null}
            {applied && !shortlisted ? <Badge tone="blue">Applied</Badge> : null}
            {job.status === "frozen" ? <Badge tone="neutral">Role frozen</Badge> : null}
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
  );
}
