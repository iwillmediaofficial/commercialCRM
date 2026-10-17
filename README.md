# Commercial CRM

A multi-company CRM sold on subscription. The Super Admin adds companies and
plans; each company (workspace) gets its own team, leads, clients, work,
invoicing and ad-fund tracking, kept apart by row-level security.

There is no email anywhere. People sign up with **email + password + a one-time
PIN**: the Super Admin gives company owners a PIN, owners and admins give their
staff PINs, and password resets work the same way.

## Stack

- React 19, TypeScript, Vite, Tailwind CSS, React Router
- Supabase (Postgres, Auth, Row Level Security, Edge Functions, pg_cron), Mumbai region
- Cloudflare Pages for hosting, Cloudflare R2 for files (through the `files` Edge Function)

## Run it

```bash
npm install
cp .env.example .env.local
npm run dev
```

`npm run build` type-checks and builds to `dist/`.

## Deploy to Cloudflare Pages

1. Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git, pick
   `iwillmediaofficial/commercialCRM`.
2. Production branch `main`. Framework preset: None. Build command `npm run build`.
   Output directory `dist`.
3. Environment variables (Production and Preview): `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` (the same values as `.env.local`; both are public).
   Optionally `NODE_VERSION` = `22`.
4. Save and deploy. The site is at `https://<project>.pages.dev`. A custom domain can
   be added later under the project's Custom domains tab.
5. Supabase > Authentication > URL Configuration: set Site URL to the pages.dev address
   (no emails are sent, but it keeps auth redirects correct).

If Cloudflare shows "disconnected from your Git account", reconnect it, then push or merge any change to `main` to start a new build.

`public/_redirects` sends every path to the app so links like `/w/acme/team` work.
`public/_headers` sets security headers (CSP allows only Supabase and R2) and long
caching for hashed build files.

## Running on the free plans

- `.github/workflows/keep-awake.yml` calls Supabase once a day so the free project never pauses.
- `.github/workflows/backup.yml` backs up the database every Sunday, encrypted, to
  `_backups/` in the R2 bucket and keeps the last 8. It needs the repository secrets
  listed at the top of that file. Run it once by hand from the Actions tab to check it.
- `supabase/migrations/20261017100100_cleanup.sql` (run once in the SQL Editor) clears
  activity older than 6 months, read notifications older than 3 months and error
  reports older than 1 month, on the 1st of every month.
- File attachments on tasks, clients, leads and invoices are off until the Super Admin
  turns them on for a company in /admin. Images are shrunk in the browser before upload.

To restore a backup: download it from R2, then
`gpg -d db-YYYY-MM-DD.dump.gpg > db.dump` and
`pg_restore --no-owner --no-privileges -d "<connection string>" db.dump` into a fresh project.

## Launch checklist

- Supabase > Authentication > Leaked password protection: turn on.
- /admin/settings: product name, support contact, and your business and GST details
  for subscription invoices.
- /admin/errors: crashes reported by browsers. Edge Function errors are under
  Supabase > Edge Functions > Logs.

## Layout

| Path | What |
| --- | --- |
| `supabase/migrations/` | Database: platform tables, module tables, functions, security rules |
| `supabase/functions/pin-auth/` | Edge Function for PIN sign-up and password reset |
| `supabase/tests/isolation.sql` | Proves companies can't see or change each other's data |
| `src/pages/admin/` | Super Admin: companies, renewals, plans |
| `src/pages/workspace/` | A company's app at `/w/<company>` |
| `src/pages/PublicForm.tsx` | Public lead form at `/f/<form>` |

## How access works

- **Super Admin** (`platform_admins`): sees every company, creates companies,
  sets plans, approves renewals. Can't edit a company's data without being a member.
- **Owner / Admin**: manage their company's team, data and subscription.
- **Staff**: see only leads and work assigned to them; no invoices or ad funds.
- **Plans** limit staff seats and clients and switch modules on or off.
- **Subscription status** is trial, active, grace (a few days after the end date),
  expired (read-only) or suspended (locked; public forms stop too).

## Tests

Run `supabase/tests/isolation.sql` in the Supabase SQL editor. It seeds two test
companies, checks 79 rules, and rolls everything back. The last line must be
`ALL TESTS PASSED (79 checks)`.

## Regenerate database types

After a schema change, regenerate `src/lib/database.types.ts` with
`supabase gen types typescript --project-id zpotoxpaeqeissxycgrz`.
