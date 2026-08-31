/**
 * Thin Gemini REST client for the two model calls the pipeline makes.
 *
 * The free tier enforces per-minute request limits, and a 1,200 resume job will
 * hit them, so every call goes through a token-bucket limiter plus retry with
 * backoff. Failing a whole parse run because minute 3 was busy would be a poor
 * trade against waiting a few seconds.
 */

const API_ROOT = "https://generativelanguage.googleapis.com/v1beta";

export const EMBEDDING_MODEL = "gemini-embedding-001";
export const GENERATION_MODEL = "gemini-2.5-flash";

/** pgvector column width. Cosine distance is scale invariant, so the shorter
 *  Matryoshka slice does not need re-normalising before it is stored. */
export const EMBEDDING_DIMENSIONS = 768;

const EMBED_BATCH_SIZE = 64;
const MAX_ATTEMPTS = 5;

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sliding-window limiter: at most `limit` calls in any `windowMs` period. */
class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
      if (this.timestamps.length < this.limit) {
        this.timestamps.push(now);
        return;
      }
      await sleep(this.windowMs - (now - this.timestamps[0]) + 50);
    }
  }
}

// Deliberately below the published free-tier ceilings, since the worker may be
// running alongside a developer poking at the same key.
const embedLimiter = new RateLimiter(80, 60_000);
const generateLimiter = new RateLimiter(8, 60_000);

async function post(
  path: string,
  body: unknown,
  limiter: RateLimiter,
): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await limiter.acquire();

    let response: Response;
    try {
      response = await fetch(`${API_ROOT}/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey(),
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      lastError = error;
      await sleep(1000 * 2 ** (attempt - 1));
      continue;
    }

    if (response.ok) return response.json();

    const text = await response.text();
    lastError = new Error(`Gemini ${response.status}: ${text.slice(0, 400)}`);

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) break;

    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 2000 * 2 ** (attempt - 1);
    await sleep(waitMs);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

type EmbedTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

interface BatchEmbedResponse {
  embeddings?: { values: number[] }[];
}

/** Stage 3. Embeds resume chunks; order of the returned vectors matches input. */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  return embedBatched(texts, "RETRIEVAL_DOCUMENT");
}

/** Embeds a job description for stage 5 retrieval. */
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedBatched([text], "RETRIEVAL_QUERY");
  return vector;
}

async function embedBatched(
  texts: string[],
  taskType: EmbedTask,
): Promise<number[][]> {
  const vectors: number[][] = [];

  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const slice = texts.slice(start, start + EMBED_BATCH_SIZE);
    const payload = {
      requests: slice.map((text) => ({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: EMBEDDING_DIMENSIONS,
      })),
    };

    const result = (await post(
      `models/${EMBEDDING_MODEL}:batchEmbedContents`,
      payload,
      embedLimiter,
    )) as BatchEmbedResponse;

    const embeddings = result.embeddings ?? [];
    if (embeddings.length !== slice.length) {
      throw new Error(
        `Gemini returned ${embeddings.length} embeddings for ${slice.length} inputs`,
      );
    }
    for (const embedding of embeddings) vectors.push(embedding.values);
  }

  return vectors;
}

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/**
 * Stage 6. Asks for JSON directly rather than parsing prose, so an explanation
 * that comes back malformed fails loudly instead of half-rendering in the UI.
 */
export async function generateJson<T>(
  prompt: string,
  schema: Record<string, unknown>,
): Promise<T> {
  const result = (await post(
    `models/${GENERATION_MODEL}:generateContent`,
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    },
    generateLimiter,
  )) as GenerateResponse;

  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned an empty response");

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Gemini returned unparseable JSON: ${text.slice(0, 300)}`);
  }
}

/** pgvector accepts its text input form, which avoids a client-side codec. */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
