/**
 * Stage 1 of the pipeline: raw PDF or Word bytes to clean text.
 *
 * Both extractors are pure JS so the worker needs no system binaries. Legacy
 * binary .doc is deliberately rejected with a readable error instead of being
 * silently ingested as garbage text, because a garbage parse would poison the
 * embeddings and the ranking downstream.
 */

export interface ParsedDocument {
  text: string;
  email: string | null;
  pageCount: number | null;
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Addresses that show up in resume boilerplate rather than as a contact. */
const NON_CONTACT_DOMAINS = [
  "example.com",
  "email.com",
  "domain.com",
  "yourcompany.com",
];

export function extractEmail(text: string): string | null {
  const matches = text.match(EMAIL_PATTERN);
  if (!matches) return null;

  const cleaned = matches.map((raw) => raw.toLowerCase().replace(/[.,;:]+$/, ""));

  const real = cleaned.find(
    (address) => !NON_CONTACT_DOMAINS.includes(address.split("@")[1] ?? ""),
  );

  // Prefer a genuine contact address, but never discard the only address on the
  // resume: routing decisions downstream already handle an address that has no
  // account behind it, whereas returning null loses the information entirely.
  return real ?? cleaned[0] ?? null;
}

function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isPdf(fileName: string, mimeType: string): boolean {
  return mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
}

function isDocx(fileName: string, mimeType: string): boolean {
  return (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.toLowerCase().endsWith(".docx")
  );
}

async function parsePdf(bytes: Uint8Array): Promise<ParsedDocument> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // unpdf transfers the buffer, so hand it a copy the caller does not still hold.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  const merged = normalise(Array.isArray(text) ? text.join("\n\n") : text);
  return { text: merged, email: extractEmail(merged), pageCount: totalPages };
}

async function parseDocx(bytes: Uint8Array): Promise<ParsedDocument> {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  const text = normalise(value);
  return { text, email: extractEmail(text), pageCount: null };
}

export async function parseDocument(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
): Promise<ParsedDocument> {
  if (isPdf(fileName, mimeType)) return parsePdf(bytes);
  if (isDocx(fileName, mimeType)) return parseDocx(bytes);

  if (fileName.toLowerCase().endsWith(".doc")) {
    throw new Error(
      "Legacy .doc files are not supported. Re-save the resume as .docx or PDF.",
    );
  }
  throw new Error(`Unsupported file type: ${fileName} (${mimeType})`);
}

export function isSupportedResumeFile(fileName: string, mimeType: string): boolean {
  return isPdf(fileName, mimeType) || isDocx(fileName, mimeType);
}
