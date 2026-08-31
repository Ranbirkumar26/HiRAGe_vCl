import { createHash } from "node:crypto";

/**
 * Content address for an uploaded file. Two uploads of the same bytes collapse
 * onto one `documents` row, which is what makes re-uploading an identical
 * resume a no-op rather than a second parse and embed (spec 1.5).
 */
export function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
