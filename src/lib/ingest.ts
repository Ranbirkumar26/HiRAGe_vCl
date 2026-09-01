/**
 * Pool limits shared by both routes a resume takes into a job: a candidate
 * applying, and an admin bulk uploading from the job detail page.
 *
 * The upload itself lives in `actions/uploads.ts`, which sends bytes straight
 * from the browser to storage under a path derived from the file's content
 * hash. That is what makes an identical re-upload free.
 */

import type { Db } from "./supabase/db";

/** Design target from the spec: 1,000 to 1,200 documents per job. */
export const MAX_POOL_SIZE = 1200;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;


export async function countPool(db: Db, jobId: string): Promise<number> {
  const { count } = await db
    .from("resumes")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  return count ?? 0;
}
