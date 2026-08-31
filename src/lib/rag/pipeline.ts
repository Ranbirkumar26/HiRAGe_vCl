/**
 * Pipeline orchestration shared by the worker.
 *
 * Stage boundaries follow spec 1.3: `runParse` covers parse, chunk, embed,
 * store and retrieve; `runShortlist` covers generation only. Both are written
 * to be safely re-runnable, because a worker can die mid-run and the queue will
 * hand the task to the next worker.
 */

import type { Db } from "../supabase/db";
import { chunkText } from "./chunk";
import { explainCandidate } from "./generate";
import { embedDocuments, embedQuery, toVectorLiteral } from "./gemini";
import { parseDocument } from "./parse";
import type { Job } from "../types";

/** Parsing is memory bound rather than network bound, so keep this modest. */
const PARSE_CONCURRENCY = 4;

/**
 * How many documents are parsed before their chunks are embedded together.
 *
 * The Gemini client packs 64 chunks into one request and the free tier counts
 * requests, not chunks. Embedding a document on its own spends a whole request
 * on its handful of chunks, so a 1,200 resume pool would need roughly 1,200
 * requests against a 1,000 per day allowance and could never finish. Grouping
 * fills each request instead, which brings the same pool under 80.
 *
 * A larger group wastes fewer part-filled requests at its boundary; the cost is
 * holding that group's text in memory, which at 200 resumes is a few megabytes.
 */
const EMBED_GROUP_SIZE = 200;

interface Progress {
  done: number;
  total: number;
  message: string;
}

async function reportProgress(
  db: Db,
  pipelineJobId: string,
  progress: Partial<Progress>,
): Promise<void> {
  await db
    .from("pipeline_jobs")
    .update({
      ...(progress.done !== undefined ? { progress_done: progress.done } : {}),
      ...(progress.total !== undefined ? { progress_total: progress.total } : {}),
      ...(progress.message !== undefined ? { message: progress.message } : {}),
    })
    .eq("id", pipelineJobId);
}

async function loadJob(db: Db, jobId: string): Promise<Job> {
  const { data, error } = await db
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (error || !data) throw new Error(`Job ${jobId} not found: ${error?.message}`);
  return data as Job;
}

/** Runs `tasks` with bounded concurrency, preserving nothing but completion. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  handler: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await handler(items[index], index);
    }
  });
  await Promise.all(workers);
}

// --------------------------------------------------------------- parse run ---

interface PendingDocument {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  status: string;
}

/**
 * Parses, chunks, embeds and stores every document in the job's pool that has
 * not been processed already. A document is content addressed, so one that
 * arrived through another job is skipped here rather than parsed twice.
 */
export async function runParse(
  db: Db,
  pipelineJobId: string,
  jobId: string,
): Promise<void> {
  const job = await loadJob(db, jobId);

  const { data: poolRows, error: poolError } = await db
    .from("resumes")
    .select("document_id, documents (id, storage_path, file_name, mime_type, status)")
    .eq("job_id", jobId);
  if (poolError) throw new Error(poolError.message);

  const byId = new Map<string, PendingDocument>();
  for (const row of poolRows ?? []) {
    const doc = (row as unknown as { documents: PendingDocument | null }).documents;
    if (doc && doc.status !== "parsed") byId.set(doc.id, doc);
  }
  const pending = [...byId.values()];

  await reportProgress(db, pipelineJobId, {
    done: 0,
    total: pending.length,
    message: pending.length
      ? `Parsing ${pending.length} resume${pending.length === 1 ? "" : "s"}`
      : "All resumes are already parsed",
  });

  let done = 0;
  let failed = 0;

  const advance = async (count: number) => {
    done += count;
    await reportProgress(db, pipelineJobId, {
      done,
      message: `Parsed ${done} of ${pending.length} resumes`,
    });
  };

  const markFailed = async (doc: PendingDocument, error: unknown) => {
    failed++;
    const message = error instanceof Error ? error.message : String(error);
    await db
      .from("documents")
      .update({ status: "failed", error: message })
      .eq("id", doc.id);
  };

  for (let start = 0; start < pending.length; start += EMBED_GROUP_SIZE) {
    const group = pending.slice(start, start + EMBED_GROUP_SIZE);
    const parsed: ParsedDocument[] = [];

    await mapWithConcurrency(group, PARSE_CONCURRENCY, async (doc) => {
      try {
        parsed.push(await parseOne(db, doc));
      } catch (error) {
        // A document that cannot be read is recorded and skipped. It must not
        // take the rest of its group down with it.
        await markFailed(doc, error);
        await advance(1);
      }
    });

    if (!parsed.length) continue;

    try {
      await embedAndStore(db, parsed);
    } catch (error) {
      // The embedding call is shared by the group, so a failure here belongs to
      // all of them. Other groups still run, and re-running Parse retries these
      // because their status is no longer 'parsed'.
      for (const item of parsed) await markFailed(item.doc, error);
    }
    await advance(parsed.length);
  }

  await reportProgress(db, pipelineJobId, {
    message: "Ranking the resume pool against the job description",
  });
  const ranked = await computeRanking(db, job, { force: true });

  await reportProgress(db, pipelineJobId, {
    message:
      `Parsed ${pending.length - failed} of ${pending.length} resumes` +
      (failed ? ` (${failed} failed)` : "") +
      `. ${ranked} candidate${ranked === 1 ? "" : "s"} ranked and stored.`,
  });
}

interface ParsedDocument {
  doc: PendingDocument;
  text: string;
  email: string | null;
  chunks: string[];
}

/** Download, extract and chunk one document. Embedding happens per group. */
async function parseOne(db: Db, doc: PendingDocument): Promise<ParsedDocument> {
  await db.from("documents").update({ status: "parsing", error: null }).eq("id", doc.id);

  const { data: blob, error: downloadError } = await db.storage
    .from("resumes")
    .download(doc.storage_path);
  if (downloadError || !blob) {
    throw new Error(`Download failed: ${downloadError?.message ?? "no file"}`);
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parsed = await parseDocument(bytes, doc.file_name, doc.mime_type);

  if (!parsed.text.trim()) {
    throw new Error("No extractable text. The file may be a scanned image.");
  }

  return {
    doc,
    text: parsed.text,
    email: parsed.email,
    chunks: chunkText(parsed.text),
  };
}

/**
 * Embeds every chunk in the group with one call, then stores each document
 * against its own slice of the returned vectors.
 */
async function embedAndStore(db: Db, group: ParsedDocument[]): Promise<void> {
  const chunks = group.flatMap((item) => item.chunks);
  if (!chunks.length) return;

  const vectors = await embedDocuments(chunks);
  if (vectors.length !== chunks.length) {
    throw new Error(
      `Expected ${chunks.length} embeddings for the group, received ${vectors.length}`,
    );
  }

  let offset = 0;
  for (const item of group) {
    const slice = vectors.slice(offset, offset + item.chunks.length);
    offset += item.chunks.length;
    await storeDocument(db, item, slice);
  }
}

async function storeDocument(
  db: Db,
  item: ParsedDocument,
  vectors: number[][],
): Promise<void> {
  // Chunks are replaced wholesale so a retried document cannot end up with a
  // mixture of old and new chunk rows.
  await db.from("chunks").delete().eq("document_id", item.doc.id);

  const rows = item.chunks.map((content, index) => ({
    document_id: item.doc.id,
    chunk_index: index,
    content,
    embedding: toVectorLiteral(vectors[index]),
  }));

  for (let start = 0; start < rows.length; start += 100) {
    const { error } = await db.from("chunks").insert(rows.slice(start, start + 100));
    if (error) throw new Error(`Chunk insert failed: ${error.message}`);
  }

  const { error: updateError } = await db
    .from("documents")
    .update({
      parsed_text: item.text,
      extracted_email: item.email,
      status: "parsed",
      error: null,
      parsed_at: new Date().toISOString(),
    })
    .eq("id", item.doc.id);
  if (updateError) throw new Error(updateError.message);
}

// ----------------------------------------------------------- retrieval run ---

/**
 * Stage 5. Ranks the entire pool once and stores the ordered list, so that
 * changing k later only slices a different length out of it.
 */
export async function computeRanking(
  db: Db,
  job: Job,
  options: { force?: boolean } = {},
): Promise<number> {
  const { data: existing } = await db
    .from("rankings")
    .select("id")
    .eq("job_id", job.id)
    .eq("jd_version", job.jd_version)
    .eq("pool_version", job.pool_version)
    .maybeSingle();

  // Parsing changes which documents have embeddings without changing either
  // version key, so a run that follows a parse must rebuild rather than reuse.
  if (existing && options.force) {
    await db.from("rankings").delete().eq("id", existing.id);
  }

  if (existing && !options.force) {
    const { count } = await db
      .from("ranking_items")
      .select("resume_id", { count: "exact", head: true })
      .eq("ranking_id", existing.id);
    return count ?? 0;
  }

  const queryVector = await embedQuery(job.description);

  const { data: ranked, error: rankError } = await db.rpc("rank_job_pool", {
    p_job_id: job.id,
    p_query: toVectorLiteral(queryVector),
  });
  if (rankError) throw new Error(`Ranking failed: ${rankError.message}`);

  const rows = (ranked ?? []) as { resume_id: string; score: number }[];

  const { data: ranking, error: insertError } = await db
    .from("rankings")
    .insert({
      job_id: job.id,
      jd_version: job.jd_version,
      pool_version: job.pool_version,
    })
    .select("id")
    .single();
  if (insertError || !ranking) {
    throw new Error(`Could not store ranking: ${insertError?.message}`);
  }

  const items = rows.map((row, index) => ({
    ranking_id: ranking.id,
    resume_id: row.resume_id,
    rank: index + 1,
    score: row.score,
  }));

  for (let start = 0; start < items.length; start += 500) {
    const { error } = await db
      .from("ranking_items")
      .insert(items.slice(start, start + 500));
    if (error) throw new Error(`Could not store ranking items: ${error.message}`);
  }

  return items.length;
}

// ----------------------------------------------------------- shortlist run ---

/**
 * Stage 6. Generates pros and cons for the top k only, and only for candidates
 * that do not already have an explanation at the current job description
 * version. Lowering k therefore generates nothing at all.
 */
export async function runShortlist(
  db: Db,
  pipelineJobId: string,
  jobId: string,
  k: number,
): Promise<void> {
  const job = await loadJob(db, jobId);

  await reportProgress(db, pipelineJobId, {
    done: 0,
    total: 0,
    message: "Preparing the ranked pool",
  });
  await computeRanking(db, job);

  const { data: ranking } = await db
    .from("rankings")
    .select("id")
    .eq("job_id", job.id)
    .eq("jd_version", job.jd_version)
    .eq("pool_version", job.pool_version)
    .single();
  if (!ranking) throw new Error("Ranking is missing after computation");

  const { data: topItems, error: itemsError } = await db
    .from("ranking_items")
    .select("resume_id, rank")
    .eq("ranking_id", ranking.id)
    .order("rank")
    .limit(k);
  if (itemsError) throw new Error(itemsError.message);

  const resumeIds = (topItems ?? []).map((item) => item.resume_id as string);
  if (!resumeIds.length) {
    await reportProgress(db, pipelineJobId, {
      message: "No parsed resumes are available to shortlist yet",
    });
    return;
  }

  const { data: cached } = await db
    .from("explanations")
    .select("resume_id")
    .eq("jd_version", job.jd_version)
    .in("resume_id", resumeIds);

  const alreadyExplained = new Set((cached ?? []).map((row) => row.resume_id as string));
  const missing = resumeIds.filter((id) => !alreadyExplained.has(id));

  await reportProgress(db, pipelineJobId, {
    done: 0,
    total: missing.length,
    message: missing.length
      ? `Writing explanations for ${missing.length} candidate${missing.length === 1 ? "" : "s"}`
      : "Every candidate in the top k is already explained",
  });

  if (!missing.length) return;

  const { data: resumeRows, error: resumeError } = await db
    .from("resumes")
    .select("id, documents (parsed_text)")
    .in("id", missing);
  if (resumeError) throw new Error(resumeError.message);

  const textById = new Map<string, string>();
  for (const row of resumeRows ?? []) {
    const text = (row as unknown as { documents: { parsed_text: string | null } | null })
      .documents?.parsed_text;
    if (text) textById.set(row.id as string, text);
  }

  let done = 0;

  // Generation is rate limited far more tightly than embedding, so this stays
  // sequential and lets the limiter in the Gemini client set the pace.
  for (const resumeId of missing) {
    const resumeText = textById.get(resumeId);
    if (resumeText) {
      const { pros, cons } = await explainCandidate(job.description, resumeText);
      const { error } = await db.from("explanations").upsert(
        { resume_id: resumeId, jd_version: job.jd_version, pros, cons },
        { onConflict: "resume_id,jd_version" },
      );
      if (error) throw new Error(`Could not store explanation: ${error.message}`);
    }

    done++;
    await reportProgress(db, pipelineJobId, {
      done,
      message: `Explained ${done} of ${missing.length} candidates`,
    });
  }
}
