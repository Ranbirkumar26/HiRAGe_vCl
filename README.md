# HiRAGe

Resume shortlisting portal built on a Retrieval Augmented Generation pipeline,
with an admin portal and a candidate portal on top of it.

Admins create a job, upload a pool of resumes, and run a parse. Resumes are
parsed, chunked, embedded and stored as vectors. The whole pool is then ranked
against the job description by vector similarity. Picking a number `k` and
clicking Shortlist asks a language model to explain, for each of the top `k`,
why that candidate fits and where they fall short, grounded in their own resume.

---

## Read this first if you are an AI coding agent

You have been handed this repository and asked to get it running and produce a
working local URL. Do exactly this:

1. Follow **Setup path A** below, top to bottom, without substituting steps.
2. Path A needs no cloud accounts and no credentials from anyone. It runs the
   entire backend locally in Docker.
3. Two long running processes are required: the web app **and** the worker. The
   app alone will start and look fine, but Parse and Shortlist will hang in a
   queued state forever. This is the single most common mistake.
4. Do not run `npm run build` while `npm run dev` is running. They share the
   `.next` directory and the build deletes the dev server's stylesheet, which
   makes every page render as unstyled HTML. If that happens, see Troubleshooting.
5. When finished, report the URL `http://localhost:3000` and the credentials the
   evaluator should sign in with, which you will have created in step A7.

Verification commands are given at the end of each step. Run them. Do not assume
a step worked.

---

## What you need installed

| Requirement | Why | Check |
|---|---|---|
| Node.js 20 or newer | Runs the app and the worker | `node -v` |
| Docker Desktop, running | Hosts the local Postgres, Auth and Storage | `docker ps` |
| Supabase CLI | Starts the local stack and applies migrations | `supabase -v` |
| A Google AI Studio API key | Embeddings and explanations. Free tier. | see step A4 |

Install the Supabase CLI if it is missing:

```bash
brew install supabase/tap/supabase
```

On Linux or Windows, see https://supabase.com/docs/guides/local-development/cli/getting-started

Everything except the Gemini key is free and requires no signup.

---

## Setup path A: fully local (recommended)

Nothing here touches a hosted service except Gemini. No Supabase account, no
credentials from the project owner, no email provider.

### A1. Install dependencies

```bash
npm install
```

Verify: the command exits 0 and a `node_modules` directory exists.

### A2. Start the local Supabase stack

Docker Desktop must already be running.

```bash
supabase start
```

First run pulls several GB of images and can take five to ten minutes. Later
runs take about thirty seconds.

This automatically applies every migration in `supabase/migrations`, which
creates the whole schema: tables, Row Level Security policies, the retrieval
function, the storage buckets, and the PostgREST schema exposure. There is no
dashboard step to remember.

Analytics is disabled in `supabase/config.toml` on purpose. Nothing in HiRAGe
uses it, and its container is unreliable enough that the CLI would otherwise roll
the whole stack back after Postgres had already come up correctly.

This project deliberately uses non standard ports so it can run alongside
another Supabase project:

| Service | URL |
|---|---|
| API | http://127.0.0.1:54421 |
| Database | postgresql://postgres:postgres@127.0.0.1:54422/postgres |
| Studio (database browser) | http://127.0.0.1:54423 |
| Mail catcher | http://127.0.0.1:54424 |

Verify:

```bash
supabase status
```

You should see the services listed and an API URL on port 54421.

If it fails with `port is already allocated`, another Supabase project is
running. Stop it, or change the ports in `supabase/config.toml`.

### A3. Capture the local keys

```bash
supabase status
```

The output is JSON. You need exactly three fields:

| Field in the output | Goes into |
|---|---|
| `API_URL` | `NEXT_PUBLIC_SUPABASE_URL` |
| `ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` |

Also note `MAILPIT_URL`, which is where confirmation emails land in step A7. It
is normally http://127.0.0.1:54424

These are local development keys, identical on every machine running this stack.
They are not secret and are safe to paste into a local file. Do not confuse them
with the hosted project's keys, which are.

### A4. Get a Gemini API key

Open https://aistudio.google.com/apikey and create a key. It is free.

The key is required. Parse and Shortlist call Gemini for embeddings and for the
pros and cons. The worker refuses to start without it.

### A5. Write the environment file

```bash
cp .env.example .env.local
```

Then edit `.env.local` so it reads like this, substituting the values from A3
and A4:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54421
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon or publishable key from supabase status>
SUPABASE_SERVICE_ROLE_KEY=<service_role or secret key from supabase status>
GEMINI_API_KEY=<your Gemini key>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

`.env.local` is gitignored. Never commit it.

Verify all five are set:

```bash
grep -c '^[A-Z_]*=.\+' .env.local
```

Expected output: `5`

### A6. Start both processes

These are long running. Use two terminals, or run them in the background.

Terminal 1, the web app:

```bash
npm run dev
```

Terminal 2, the worker:

```bash
npm run worker
```

The worker must print `[worker] polling pipeline_jobs`. If it exits immediately,
an environment variable is missing. Read its error, it names the variable.

Verify the app is serving:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/sign-in
```

Expected output: `200`

Verify the stylesheet is being served, which catches the unstyled-page problem
before you see it:

```bash
curl -s http://localhost:3000/sign-in | grep -c 'stylesheet'
```

Expected output: `1` or more.

### A7. Create the admin account

Open http://localhost:3000/sign-up

Sign up with **`rk26.ftw@gmail.com`** and any password of 8 or more characters.

That address is the fixed super admin, defined in `src/lib/types.ts` and in
migration `0001_init.sql`. Any other address becomes a candidate instead, and
will not be able to see the admin portal.

No real email is sent on the local stack. The confirmation message is caught by
the local mail server:

1. Open http://127.0.0.1:54424
2. Open the newest message, "Confirm your signup"
3. Click the confirmation link

You land in the admin portal at `/admin`, signed in.

The account does not exist until that link is clicked. This is deliberate and is
required by the specification: signing in before confirming will fail.

### A8. Create a candidate account, optional but worth doing

Sign out, then sign up again with any other address, for example
`candidate@test.local`. Confirm it through the same mail catcher. That account
lands in the candidate portal and demonstrates the role split.

**The live URL is http://localhost:3000**

---

## Setup path B: against a hosted Supabase project

Use this only if the project owner has given you a `.env.local` with hosted
credentials, or you are deploying your own.

1. `npm install`
2. Put the hosted values in `.env.local`: project URL, publishable key, service
   role key, Gemini key, and `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.
3. Apply the schema, if it is a fresh project:

```bash
supabase link --project-ref <your-project-ref>
```

```bash
supabase db push
```

4. In the Supabase dashboard, under Authentication:
   - Providers, Email: turn **Confirm email** on.
   - URL Configuration: add `http://localhost:3000/auth/callback` to Redirect
     URLs, or confirmation links will not return to the app.
5. Configure SMTP under Authentication, Emails, SMTP Settings. The built in
   sender only delivers to project team member addresses and is rate limited to
   a few messages per hour, so any other candidate address will never receive a
   confirmation email. Brevo, Mailjet and SendGrid all have free tiers that
   allow verifying a single sender address without owning a domain.
6. Start both processes as in step A6.

---

## Demonstrating it

Sample resumes are not committed. Any PDF or `.docx` resumes will do, or ask the
project owner for the three test files used during development.

1. **Create a job.** On `/admin`, use the right hand panel. The description can
   be typed or uploaded as a PDF or Word file. Add role tags such as
   `AI Engineer, ML Engineer`. These drive the candidate feed and the role
   filter.

2. **Upload resumes.** On the job detail page, select several files and upload.
   Then upload the exact same files again. The result reports them as already in
   the pool. Documents are keyed by a hash of their content, so an identical file
   is never parsed or embedded twice.

3. **Parse.** Click "Parse resumes". A popup reports progress driven by the
   worker. This runs parse, chunk, embed, store and rank. It takes roughly twenty
   seconds for three resumes.

4. **Shortlist.** Set `k` to 3 and click Shortlist. Ranked candidates appear,
   best first, each with pros and cons grounded in that resume against that job
   description.

5. **Show the caching, which is the most interesting part.**
   - Set `k` to 1 and Shortlist. Returns instantly, generates nothing.
   - Set `k` back to 3. Also instant, all three are already explained.
   - Edit the job description and save. The UI states that the ranking and all
     explanations were cleared.
   - Parse again, then Shortlist again. It re-ranks and regenerates, because the
     job description version changed.

6. **Confirm a candidate.** Click a candidate. A popup asks "Confirm?" with OK
   and Cancel. OK marks them shortlisted and routes an in-app message to the
   email address extracted from their resume. If no account exists for that
   address, no message is sent and the candidate is still marked shortlisted.

7. **Candidate side.** Sign in as the candidate account: job feed with role,
   company and date filters, apply once with a resume, opt out, applications
   list, and shortlist messages.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Every page is unstyled, plain HTML with blue links | `npm run build` was run while `npm run dev` was running. The build overwrote the dev server's CSS. | Stop dev, `rm -rf .next`, start dev again, then hard refresh the browser with Cmd+Shift+R or Ctrl+Shift+R. |
| Parse or Shortlist never finishes, stuck on "Queued" | The worker is not running. | Start `npm run worker` in a second terminal. Look for `[worker] polling pipeline_jobs`. |
| Worker exits immediately | A missing environment variable. | Read the error, it names the variable. Check `.env.local` has all five. |
| `supabase start` fails: `port is already allocated` | Another Supabase project holds the port. | Stop that project, or edit the ports in `supabase/config.toml`. |
| `supabase start` ends with `analytics container is not ready: unhealthy` and stops everything | The analytics and vector log containers are flaky, and the CLI treats them as fatal even when Postgres started correctly. | Already handled: `supabase/config.toml` ships with `[analytics] enabled = false`. If you re-enabled it, turn it back off. |
| `supabase start` says it is already running but nothing responds | A previous run left a stale lock. | `supabase stop --project-id Hirage_claude --no-backup`, then start again. |
| Sign up says "Error sending confirmation email" | Only on hosted setups, SMTP is misconfigured. | Check the SMTP username. For Brevo it is a generated `...@smtp-brevo.com` login, not your account email. The password is the SMTP key, not the account password. |
| No confirmation email on the local stack | Local mail is never actually sent. | Open the mail catcher at http://127.0.0.1:54424 |
| Signed in but sent to the candidate portal | You signed up with an address other than `rk26.ftw@gmail.com`. | Sign up with that address, or have an existing super admin grant your account the admin role on `/admin/access`. |
| Parse fails with a 429 from Gemini | The free tier daily embedding quota is spent. It is per Google Cloud project and resets at midnight Pacific. | Wait for the reset, or create a key in a different Google Cloud project. A new key in the same project shares the same quota. |
| A `.doc` upload is rejected | Legacy binary Word is deliberately refused, because no reliable pure JavaScript extractor exists and a bad parse would silently corrupt the ranking. | Re-save as `.docx` or PDF. |
| A PDF parses to nothing | It is a scanned image with no text layer. There is no OCR step. | Use a text based PDF. The failure is reported per document in the resume pool table. |
| Port 3000 is taken | Another app is using it. | `PORT=3001 npm run dev`, and set `NEXT_PUBLIC_SITE_URL=http://localhost:3001` to match. |

---

## How it works

### Pipeline

```
upload -> parse -> chunk -> embed -> store -> retrieve     (admin clicks Parse)
                                                  |
                                                  v
                                             generate      (admin clicks Shortlist)
```

Stages 1 to 5 run on Parse. Stage 6 runs on Shortlist.

Retrieval is a SQL function, `hirage.rank_job_pool`, scoring every resume in the
pool by cosine distance in `pgvector`:

```
score = 0.6 * best chunk similarity + 0.4 * mean of that resume's top 3 chunks
```

The blend stops a resume with one lucky paragraph from outranking one that
matches broadly.

### Caching

| Artefact | Key | Recomputed when |
|---|---|---|
| Parsed text, chunks, embeddings | SHA-256 of the file bytes | Never, for an unchanged file |
| Ranked candidate list | job, `jd_version`, `pool_version` | Description edited, or the pool changes |
| Pros and cons | resume, `jd_version` | Description edited |

Every invalidation rule follows from the keys rather than from explicit
cache-busting code. Editing the description increments `jd_version`, which makes
the old ranking and every old explanation unreachable. Adding or removing a
resume increments `pool_version` through a database trigger, which invalidates
the ranking but not the explanations, because an explanation never depended on
the pool.

### Architecture

Three processes: the Next.js app, the worker, and Postgres. The app never does
long work. It writes a row to `hirage.pipeline_jobs` and returns. The worker
claims that row with `FOR UPDATE SKIP LOCKED` and does the work. The UI polls a
status endpoint. A partial unique index prevents a second live run of the same
kind for one job, so double clicking Parse cannot duplicate work.

### Security

Role checks run on the server in `src/lib/auth/session.ts`, and again
independently in Row Level Security. Candidates cannot read `resumes`,
`documents`, `chunks`, `rankings`, `ranking_items`, `explanations` or
`shortlists`. The anonymous role is revoked from every application table. Role
escalation is blocked by a database trigger, so a signed-in user cannot promote
themselves even by calling the API directly.

---

## Layout

```
src/app          routes: auth pages, admin portal, candidate portal
src/components   UI primitives and the client components for each portal
src/lib/rag      parse, chunk, embed, retrieve, generate, orchestration
src/lib/actions  server actions, one module per role
src/lib/auth     server side role checks
worker           queue consumer that runs the long stages
supabase         schema, policies, storage buckets, retrieval function
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Web app on port 3000 |
| `npm run worker` | Queue consumer, restarts on file changes |
| `npm run worker:once` | Queue consumer without file watching |
| `npm run build` | Production build. Stop `dev` first. |
| `npm run typecheck` | TypeScript, no emit |

## Dependencies

Each one earns its place:

- `@supabase/supabase-js`, `@supabase/ssr` for database, auth, storage and
  App Router cookie handling
- `unpdf` for PDF text extraction with no system binaries
- `mammoth` for `.docx` text extraction
- `zod` for validation at the server action boundary
- `lucide-react` for the password eye icon and the day/night icons
- `tsx`, `dotenv` to run the TypeScript worker directly

## Limits

- The resume pool is capped at 1,200 per job, the specification's design target.
- Accepted formats are PDF and `.docx`. Legacy `.doc` is refused.
- Scanned image PDFs with no text layer fail per document. There is no OCR.
- The Gemini free tier allows 1,000 embedding requests per day per Google Cloud
  project. Chunks are batched across documents, so 1,200 resumes cost roughly 80
  requests rather than 1,200.
- The worker is a long lived process. It cannot run on Vercel or on any platform
  that terminates a process when an HTTP response is sent.

## Deploying

The web app runs on Vercel's free tier. Resume uploads go from the browser
straight to Supabase Storage using a server-signed URL, so they are not subject
to Vercel's 4.5 MB request cap or its function timeout, and pool size is not
limited by the web tier.

The worker still needs a host that allows a long lived process. Options, all
free: run it on your own machine while demonstrating, run it on a schedule
through GitHub Actions, or use an always-free VM. Without it the app works for
browsing, sign up, applications and messages, but Parse and Shortlist stay
queued.

To deploy:

1. Import the repository at https://vercel.com/new
2. Add the environment variables from `.env.example`, using your hosted Supabase
   values and your Gemini key.
3. Set `NEXT_PUBLIC_SITE_URL` to the Vercel URL, not localhost.
4. In Supabase, Authentication, URL Configuration: add
   `https://your-app.vercel.app/auth/callback` to Redirect URLs, otherwise
   confirmation links will not return to the deployed app.

One caveat that remains: an uploaded job description file still travels through
a Server Action, so on Vercel it must be under 4.5 MB. Typed and pasted
descriptions are unaffected.
