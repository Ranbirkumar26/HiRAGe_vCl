"use client";

/**
 * Browser half of the direct-to-storage upload.
 *
 * The file is fingerprinted here so the server can answer "already stored"
 * without the bytes ever being sent, which is what makes re-uploading an
 * identical resume free. The bytes then go straight to Supabase Storage using
 * a URL the server signed for one specific path.
 */

import {
  createUploadTargets,
  type UploadRequest,
  type UploadTarget,
} from "./actions/uploads";
import { createClient } from "./supabase/client";

export interface PreparedFile {
  file: File;
  hash: string;
}

export interface UploadOutcome {
  uploaded: { hash: string; name: string; type: string; size: number }[];
  rejected: { name: string; reason: string }[];
}

/** SHA-256 in hex, matching what the server computes with node:crypto. */
export async function fingerprint(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Fingerprints, asks the server for targets, and pushes the bytes for anything
 * not already stored. Returns every file that is now safe to record, including
 * the ones that were already present.
 */
export async function uploadResumeFiles(
  jobId: string,
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<UploadOutcome & { error?: string }> {
  const prepared: PreparedFile[] = [];
  for (const file of files) {
    prepared.push({ file, hash: await fingerprint(file) });
  }

  const requests: UploadRequest[] = prepared.map(({ file, hash }) => ({
    name: file.name,
    type: file.type,
    size: file.size,
    hash,
  }));

  const { targets, error } = await createUploadTargets(jobId, requests);
  if (error) return { uploaded: [], rejected: [], error };

  const byHash = new Map<string, UploadTarget>(targets.map((t) => [t.hash, t]));
  const supabase = createClient();

  const uploaded: UploadOutcome["uploaded"] = [];
  const rejected: UploadOutcome["rejected"] = [];
  let done = 0;

  for (const { file, hash } of prepared) {
    const target = byHash.get(hash);
    done++;

    if (!target || target.status === "rejected") {
      rejected.push({ name: file.name, reason: target?.reason ?? "Rejected." });
      onProgress?.(done, prepared.length);
      continue;
    }

    if (target.status === "upload" && target.path && target.token) {
      const { error: uploadError } = await supabase.storage
        .from("resumes")
        .uploadToSignedUrl(target.path, target.token, file, {
          contentType: file.type || "application/octet-stream",
        });

      if (uploadError) {
        rejected.push({ name: file.name, reason: uploadError.message });
        onProgress?.(done, prepared.length);
        continue;
      }
    }

    uploaded.push({ hash, name: file.name, type: file.type, size: file.size });
    onProgress?.(done, prepared.length);
  }

  return { uploaded, rejected };
}
