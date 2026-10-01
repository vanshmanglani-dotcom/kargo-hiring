# Kargo Hiring Dashboard

An internal tool for Arjun. Upload a CV, choose the role, and the system ranks the candidate against the pattern of Kargo's best hires. It writes an interview brief and a draft email. Nothing is sent until Arjun clicks **Send**.

## How it works

Upload CV + role → **extract** (on the server, no AI) → **score** (Gemini, PM + SPM rubrics) → **rank** (top 5 per role = invite) → **brief + email** (Gemini) → Arjun reviews → **Send** (Resend)

- **Privacy:** name, email and phone are pulled out with regex on the server. They go into `candidate_pii`. Gemini only ever sees the redacted CV, with `[NAME]`, `[EMAIL]` and `[PHONE]` in place of the real details. The real name is filled in only when the email is shown or sent.
- **Scoring:** every CV is scored 1–5 on each criterion, with a one-line reason, against both the PM and SPM rubrics. The weighted total is out of 100.
- **The Cut (checks 06 + 09):** nothing is ever rejected or sent automatically. Arjun can switch any invite to a rejection (or the other way round), edit the draft, then click Send.
- **Rubric:** `rubric.txt` was built from the 8 hire profiles, not the JDs. It is loaded into the `rubric_criteria` table.

## Setup (about 10 minutes)

1. **Supabase:** create a project. Open SQL Editor, paste all of `supabase/schema.sql` and click Run. This creates the tables and adds 10 rubric rows.
2. **Keys:** copy `.env.example` to `.env.local` and fill it in:
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API)
   - `GEMINI_API_KEY` (aistudio.google.com). Turn on billing so Google doesn't train on the CVs.
   - `DASHBOARD_PASSWORD` (any password; the browser asks for it)
   - Leave `RESEND_API_KEY` blank until checkpoint B-2.
3. **Run locally (optional):** `npm install && npm run dev` and open http://localhost:3000
4. **GitHub:**
   ```bash
   git remote add origin https://github.com/<you>/kargo-hiring.git
   git push -u origin main
   ```
   `.env.local` is already in `.gitignore`.
5. **Vercel:** Add New → Project → import the repo. Add the same environment variables, then Deploy.
6. **Resend (B-2):** add `RESEND_API_KEY` in Vercel and redeploy. On the free tier without a verified domain, Resend only delivers to your own account email and the sender must be `onboarding@resend.dev`.

## Using it

1. Pick **Applied for: PM** or **SPM**, select one or more CVs (PDF, DOCX or TXT) and click **Score**. Upload the PM files and the SPM files in two separate batches.
2. Once scoring finishes, the app ranks everyone and drafts the briefs and emails automatically. **Refresh drafts** re-runs this step.
3. Open a card to see the brief, the score breakdown and the editable draft. Click **Send** when you're happy with it.

The dashed line marks the shortlist cut-off (top 5). Change it with `SHORTLIST_SIZE`.
