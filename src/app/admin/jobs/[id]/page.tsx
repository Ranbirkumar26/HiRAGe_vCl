import Link from "next/link";
import { notFound } from "next/navigation";

import { JobControls } from "@/components/admin/job-controls";
import { JobDescriptionEditor } from "@/components/admin/job-description-editor";
import { ParsePanel } from "@/components/admin/parse-panel";
import { ResumeUploader } from "@/components/admin/resume-uploader";
import { ShortlistPanel } from "@/components/admin/shortlist-panel";
import type { PipelineStatus } from "@/components/admin/use-pipeline-status";
import { Badge, Card, EmptyState, SectionTitle } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/session";
import { getJobDetail, getShortlistEntries } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PipelineJob } from "@/lib/types";

export const dynamic = "force-dynamic";

const DEFAULT_K = 10;

function toStatus(task: PipelineJob | null): PipelineStatus | null {
  if (!task) return null;
  return {
    id: task.id,
    status: task.status,
    progressDone: task.progress_done,
    progressTotal: task.progress_total,
    message: task.message,
    error: task.error,
  };
}

export default async function AdminJobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ k?: string }>;
}) {
  await requireAdmin();

  const { id } = await params;
  const { k: rawK } = await searchParams;

  const db = createAdminClient();
  const detail = await getJobDetail(db, id);
  if (!detail || detail.job.deleted_at) notFound();

  const parsedK = Number(rawK);
  const k = Number.isInteger(parsedK) && parsedK > 0 ? Math.min(parsedK, 1200) : DEFAULT_K;

  const entries = await getShortlistEntries(db, detail.job, k);
  const { job } = detail;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-brand-blue hover:underline">
          Back to jobs
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{job.company_name}</h1>
          {job.status === "frozen" ? (
            <Badge tone="neutral">Frozen</Badge>
          ) : (
            <Badge tone="green">Open</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">
          {job.recruiter_name} &middot; {job.recruiter_email}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {job.tags.map((tag) => (
            <Badge key={tag} tone="blue">
              {tag}
            </Badge>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <JobDescriptionEditor
          jobId={job.id}
          description={job.description}
          version={job.jd_version}
        />
        <div className="space-y-6">
          <ResumeUploader jobId={job.id} />
          <ParsePanel
            jobId={job.id}
            poolCount={detail.poolCount}
            parsedCount={detail.parsedCount}
            rankedCount={detail.rankedCount}
            initialTask={toStatus(detail.latestParse)}
          />
        </div>
      </div>

      <ShortlistPanel
        jobId={job.id}
        k={k}
        entries={entries}
        rankedCount={detail.rankedCount}
        initialTask={toStatus(detail.latestShortlist)}
      />

      <Card>
        <SectionTitle
          title="Resume pool"
          description={
            detail.poolCount > detail.pool.length
              ? `Showing the ${detail.pool.length} most recent of ${detail.poolCount} resumes.`
              : `${detail.poolCount} resume${detail.poolCount === 1 ? "" : "s"} uploaded against this job.`
          }
        />
        {detail.pool.length === 0 ? (
          <EmptyState>
            No resumes yet. Upload them above, or wait for candidates to apply.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">File</th>
                  <th className="py-2 pr-4 font-medium">Source</th>
                  <th className="py-2 pr-4 font-medium">Email on resume</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {detail.pool.map((resume) => (
                  <tr key={resume.id} className="border-t border-[var(--border)]">
                    <td className="py-2 pr-4">{resume.fileName}</td>
                    <td className="py-2 pr-4 text-muted">
                      {resume.source === "application" ? "Applied" : "Admin upload"}
                    </td>
                    <td className="py-2 pr-4 text-muted">
                      {resume.extractedEmail ?? "Not found"}
                    </td>
                    <td className="py-2">
                      {resume.status === "parsed" ? (
                        <Badge tone="green">Parsed</Badge>
                      ) : resume.status === "failed" ? (
                        <span title={resume.error ?? undefined}>
                          <Badge tone="neutral">Failed</Badge>
                        </span>
                      ) : (
                        <Badge tone="neutral">{resume.status}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <JobControls jobId={job.id} frozen={job.status === "frozen"} />
    </div>
  );
}
