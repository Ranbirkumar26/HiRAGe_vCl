# HiRAGe

Resume shortlisting portal built on a retrieval augmented generation pipeline,
with an admin portal and a candidate portal on top of it.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Web | Next.js 15, App Router, Server Actions | One deploy target for UI and server logic |
| Data | Supabase Postgres with `pgvector` | Rows, vectors, RLS and storage in one free tier |
| Auth | Supabase Auth | Email confirmation and password reset without hand-rolled mail |
| Models | Gemini `gemini-embedding-001` and `gemini-2.5-flash` | Free tier for both embedding and generation |
| Async | `pipeline_jobs` table plus a Node worker | Parsing 1,200 documents outlives any HTTP request |

## Prerequisites

- Node 20 or newer
- A Supabase project
- A Google AI Studio API key

## Setup

### 1. Install

```bash
npm install
```

### 2. Create the schema

Run `supabase/migrations/0001_init.sql` against your project, either through the
Supabase SQL editor or with the CLI:

```bash
supabase db push
```

It enables `pgvector`, creates every table, the RLS policies, the two storage
buckets and the `rank_job_pool` retrieval function.

### 3. Configure auth

In the Supabase dashboard:

- **Authentication → Providers → Email**: turn **Confirm email** on. Sign in must
  fail until the confirmation link is clicked, and the profile row is only
  created once the address is confirmed.
- **Authentication → URL Configuration**: set the site URL to
  `http://localhost:3000` and add `http://localhost:3000/auth/callback` as a
  redirect URL.
- **Authentication → Emails**: the built-in SMTP is rate limited to a handful of
  messages per hour, which is fine for development. Point it at a real
  transactional provider before using this with more than a few accounts.

### 4. Environment

```bash
cp .env.example .env.local
```

Fill in the Supabase URL, anon key and service role key, and the Gemini API key.
The service role key bypasses RLS and is only ever read on the server.

### 5. Run

Two processes, in separate terminals:

```bash
npm run dev
```

```bash
npm run worker
```

The web app enqueues work. The worker performs it. Nothing is parsed, embedded
or explained without the worker running.

**The worker cannot run on Vercel.** It is a long-lived polling process, and
Vercel's functions are request-scoped. Deploying the web app to Vercel gives you
working auth, job creation, uploads and browsing, but Parse and Shortlist will
sit queued until the worker runs somewhere always-on: your own machine, or a
container host such as Railway or Fly.

## The hosted project

HiRAGe runs in its own Supabase project: **`Hirage_claude`**
(`onmchendtplhthfethvc`), ap-south-1.

It owns everything in that project. Its tables live in a dedicated `hirage`
schema and all four clients are bound to it with `db: { schema: "hirage" }`.
Migration `0005` adds `hirage` to the PostgREST exposed schemas, so a fresh
deploy needs no dashboard step: `supabase db push` is sufficient.

`auth.users` is not shared with anything. `rk26.ftw@gmail.com` receives the
admin role automatically the moment it confirms its email.

## Running against a local Supabase

`supabase/config.toml` is committed and its ports are deliberately shifted into
the 544xx range, so this stack can run beside another Supabase project holding
the standard 543xx ports.

```bash
supabase start
```

`supabase start` applies `supabase/migrations` automatically. Point `.env.local`
at the URL and keys it prints. Confirmation and reset emails are captured by
Mailpit rather than sent, at the inbucket port shown in `supabase status`.

```bash
supabase db reset
```

re-applies the migration from scratch, which is the quickest way to get back to
a known state.

## Roles

Every account is created as a candidate. `rk26.ftw@gmail.com` holds the admin
role from the moment it confirms its email address, and is the only account that
can see the Access section and promote others to admin. Role checks run in
`src/lib/auth/session.ts` on the server and again in the RLS policies; hiding a
link is never the control.

## Pipeline

```
upload -> parse -> chunk -> embed -> store -> retrieve   (admin clicks Parse)
                                                 |
                                                 v
                                            generate      (admin clicks Shortlist)
```

Stages 1 to 5 run on **Parse**. Stage 6 runs on **Shortlist**.

### Caching

| Artefact | Key | Recomputed when |
|---|---|---|
| Parsed text, chunks, embeddings | SHA-256 of the file bytes | Never for an unchanged file |
| Ranked candidate list | job, `jd_version`, `pool_version` | Description edited, or the pool changes |
| Pros and cons | resume, `jd_version` | Description edited |

Consequences, all of which fall out of those keys rather than being special
cased:

- Re-uploading an identical file is a no-op. It maps onto the same `documents`
  row and is neither parsed nor embedded again.
- Retrieval ranks the whole pool once. Changing `k` slices a different length
  out of the stored `ranking_items`, at no model cost.
- Raising `k` from 10 to 20 generates 10 explanations. Lowering it from 20 to 10
  generates none.
- Editing the job description bumps `jd_version`, which drops the stored ranking
  and every cached explanation for that job.
- Adding or removing a resume bumps `pool_version`, which drops the ranking but
  leaves explanations alone, because an explanation never depended on the pool.

### Ranking

`rank_job_pool` scores each resume as `0.6 x best chunk similarity + 0.4 x mean
of its top three chunks`, over cosine distance in `pgvector`. The blend stops a
resume with one lucky paragraph from outranking one that matches broadly.

## Limits

- Pool size is capped at 1,200 resumes per job, the spec's design target.
- Accepted formats are PDF and `.docx`. Legacy binary `.doc` is rejected with a
  message rather than ingested as garbage text, since a bad parse would poison
  the embeddings.
- Scanned image PDFs with no text layer fail the parse and are reported per
  document in the resume pool table. There is no OCR step.
- Gemini free tier rate limits are respected by a limiter in
  `src/lib/rag/gemini.ts`. A large first parse run takes minutes, not seconds.

## Layout

```
src/app          routes: auth pages, admin portal, candidate portal
src/components   UI primitives and the client components for each portal
src/lib/rag      parse, chunk, embed, retrieve, generate, and the orchestration
src/lib/actions  server actions, one module per role
src/lib/auth     server-side role checks
worker           queue consumer that runs the long stages
supabase         schema, policies, storage buckets, retrieval function
```

## Dependencies

Each one earns its place:

- `@supabase/supabase-js`, `@supabase/ssr` — database, auth, storage and cookie
  handling for the App Router.
- `unpdf` — PDF text extraction with no system binaries.
- `mammoth` — `.docx` text extraction.
- `zod` — input validation at the server action boundary.
- `lucide-react` — the eye icon on password fields and the day/night icons.
- `tsx`, `dotenv` — run the TypeScript worker directly.
