import { generateJson } from "./gemini";

export interface ProsCons {
  pros: string[];
  cons: string[];
}

const PROS_CONS_SCHEMA = {
  type: "object",
  properties: {
    pros: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5 },
    cons: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
  },
  required: ["pros", "cons"],
} as const;

// Gemini is generous with context, but a resume beyond this length is almost
// always a parsing artefact rather than genuine content.
const MAX_RESUME_CHARS = 24_000;
const MAX_JD_CHARS = 12_000;

function buildPrompt(jobDescription: string, resumeText: string): string {
  return `You are screening one candidate against one job description for a recruiter.

Rules you must follow:
- Every point must be grounded in text that actually appears in the resume and in a requirement that actually appears in the job description.
- Never invent employers, tools, degrees, dates or numbers. If the resume does not mention something the job asks for, that is a con, not an assumption.
- Each bullet is one crisp sentence. Name the specific requirement it speaks to.
- Pros explain why this candidate fits this job. Cons are gaps or weaknesses against this same job, not generic advice.
- Do not manufacture a pro. A job title that merely sounds senior, or a strength in an unrelated field, is not evidence of fit. If the resume meets none of the requirements, return an empty list of pros and say why in the cons.
- Write plain professional English. No emoji, no markdown, no leading dashes.

<job_description>
${jobDescription.slice(0, MAX_JD_CHARS)}
</job_description>

<resume>
${resumeText.slice(0, MAX_RESUME_CHARS)}
</resume>

Return up to 5 pros, only as many as the resume genuinely supports, and 1 to 4 cons.`;
}

/** Stage 6 for a single candidate. Cached by (resume, jd_version) upstream. */
export async function explainCandidate(
  jobDescription: string,
  resumeText: string,
): Promise<ProsCons> {
  const result = await generateJson<ProsCons>(
    buildPrompt(jobDescription, resumeText),
    PROS_CONS_SCHEMA as unknown as Record<string, unknown>,
  );

  return {
    pros: (result.pros ?? []).map((s) => s.trim()).filter(Boolean),
    cons: (result.cons ?? []).map((s) => s.trim()).filter(Boolean),
  };
}
