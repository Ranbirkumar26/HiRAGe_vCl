/**
 * Stage 2: split parsed text into overlapping chunks.
 *
 * Resumes are short and section-structured, so splitting on blank lines keeps
 * a role, its dates and its bullet points together far more often than a fixed
 * character window would. Oversized sections fall back to sentence splitting.
 */

const TARGET_CHARS = 1200;
const OVERLAP_CHARS = 150;
const MIN_CHUNK_CHARS = 60;

function splitOversized(block: string): string[] {
  const sentences = block.match(/[^.!?\n]+[.!?]*\s*/g) ?? [block];
  const out: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > TARGET_CHARS && current) {
      out.push(current.trim());
      current = current.slice(-OVERLAP_CHARS);
    }
    current += sentence;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export function chunkText(text: string): string[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const block of blocks) {
    if (block.length > TARGET_CHARS) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = "";
      }
      chunks.push(...splitOversized(block));
      continue;
    }

    if (current.length + block.length + 2 > TARGET_CHARS && current) {
      chunks.push(current.trim());
      // Carry the tail forward so a fact split across a boundary stays retrievable.
      current = current.slice(-OVERLAP_CHARS) + "\n\n";
    }
    current += block + "\n\n";
  }

  if (current.trim()) chunks.push(current.trim());

  const kept = chunks.filter((c) => c.length >= MIN_CHUNK_CHARS);
  return kept.length ? kept : chunks.slice(0, 1);
}
