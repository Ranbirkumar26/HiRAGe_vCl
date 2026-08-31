/**
 * Read models for the admin job detail page. These run with the service key
 * after the caller has already been checked as an admin, so they can join
 * across tables the client is never allowed to read directly.
 */

import type { Db } from "./supabase/db";
import type { Job, PipelineJob, ShortlistEntry } from "./types";

export interface PoolResume {
  id: string;
  fileName: string;
  source: string;
  status: string;
  extractedEmail: string | null;
  error: string | null;
  createdAt: string;
}

export interface JobDetail {
  job: Job;
  pool: PoolResume[];
  poolCount: number;
  parsedCount: number;
  latestParse: PipelineJob | null;
  latestShortlist: PipelineJob | null;
  rankedCount: number;
}

const POOL_PAGE_SIZE = 200;

export async function getJobDetail(
  db: Db,
  jobId: string,
): Promise<JobDetail | null> {
  const { data: job } = await db.from("jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job) return null;

  const [{ data: poolRows }, { count: poolCount }, latestParse, latestShortlist] =
    await Promise.all([
      db
        .from("resumes")
        .select(
          "id, source, created_at, documents (file_name, status, extracted_email, error)",
        )
        .eq("job_id", jobId)
        .order("created_at", { ascending: false })
        .limit(POOL_PAGE_SIZE),
      db.from("resumes").select("id", { count: "exact", head: true }).eq("job_id", jobId),
      latestPipelineJob(db, jobId, "parse"),
      latestPipelineJob(db, jobId, "shortlist"),
    ]);

  type Row = {
    id: string;
    source: string;
    created_at: string;
    documents: {
      file_name: string;
      status: string;
      extracted_email: string | null;
      error: string | null;
    } | null;
  };

  const pool: PoolResume[] = ((poolRows ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    fileName: row.documents?.file_name ?? "Unknown file",
    source: row.source,
    status: row.documents?.status ?? "pending",
    extractedEmail: row.documents?.extracted_email ?? null,
    error: row.documents?.error ?? null,
    createdAt: row.created_at,
  }));

  const { data: ranking } = await db
    .from("rankings")
    .select("id")
    .eq("job_id", jobId)
    .eq("jd_version", job.jd_version)
    .eq("pool_version", job.pool_version)
    .maybeSingle();

  let rankedCount = 0;
  if (ranking) {
    const { count } = await db
      .from("ranking_items")
      .select("resume_id", { count: "exact", head: true })
      .eq("ranking_id", ranking.id);
    rankedCount = count ?? 0;
  }

  const parsedCount = await countParsed(db, jobId);

  return {
    job: job as Job,
    pool,
    poolCount: poolCount ?? 0,
    parsedCount,
    latestParse,
    latestShortlist,
    rankedCount,
  };
}

async function countParsed(db: Db, jobId: string): Promise<number> {
  const { count } = await db
    .from("resumes")
    .select("id, documents!inner (status)", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("documents.status", "parsed");
  return count ?? 0;
}

export async function latestPipelineJob(
  db: Db,
  jobId: string,
  kind: "parse" | "shortlist",
): Promise<PipelineJob | null> {
  const { data } = await db
    .from("pipeline_jobs")
    .select("*")
    .eq("job_id", jobId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as PipelineJob) ?? null;
}

/**
 * Slices the stored ranking to k and attaches whatever explanations exist at
 * the current job description version. Candidates with no explanation yet are
 * still returned, so lowering k never hides a ranked candidate.
 */
export async function getShortlistEntries(
  db: Db,
  job: Job,
  k: number,
): Promise<ShortlistEntry[]> {
  const { data: ranking } = await db
    .from("rankings")
    .select("id")
    .eq("job_id", job.id)
    .eq("jd_version", job.jd_version)
    .eq("pool_version", job.pool_version)
    .maybeSingle();
  if (!ranking) return [];

  const { data: items } = await db
    .from("ranking_items")
    .select("resume_id, rank, score, resumes (document_id, documents (file_name, extracted_email))")
    .eq("ranking_id", ranking.id)
    .order("rank")
    .limit(k);

  const rows = (items ?? []) as unknown as {
    resume_id: string;
    rank: number;
    score: number;
    resumes: {
      document_id: string;
      documents: { file_name: string; extracted_email: string | null } | null;
    } | null;
  }[];

  if (!rows.length) return [];

  const resumeIds = rows.map((row) => row.resume_id);

  const [{ data: explanations }, { data: shortlisted }] = await Promise.all([
    db
      .from("explanations")
      .select("resume_id, pros, cons")
      .eq("jd_version", job.jd_version)
      .in("resume_id", resumeIds),
    db.from("shortlists").select("resume_id").eq("job_id", job.id).in("resume_id", resumeIds),
  ]);

  const explanationById = new Map(
    (explanations ?? []).map((row) => [
      row.resume_id as string,
      { pros: (row.pros ?? []) as string[], cons: (row.cons ?? []) as string[] },
    ]),
  );
  const shortlistedIds = new Set((shortlisted ?? []).map((row) => row.resume_id as string));

  return rows.map((row) => ({
    rank: row.rank,
    score: row.score,
    resumeId: row.resume_id,
    documentId: row.resumes?.document_id ?? "",
    fileName: row.resumes?.documents?.file_name ?? "Unknown file",
    candidateEmail: row.resumes?.documents?.extracted_email ?? null,
    pros: explanationById.get(row.resume_id)?.pros ?? [],
    cons: explanationById.get(row.resume_id)?.cons ?? [],
    shortlisted: shortlistedIds.has(row.resume_id),
  }));
}
